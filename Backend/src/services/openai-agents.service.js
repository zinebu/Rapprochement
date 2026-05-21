import OpenAI from "openai";
import { COMPANY_IDENTITY } from "../config/company-identity.js";

function getClient() {
  if (process.env.OPENAI_ENABLED !== "true") return null;
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function runJsonSchemaAgent({ name, schema, systemPrompt, userPrompt }) {
  const client = getClient();
  if (!client) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
      { role: "user", content: [{ type: "input_text", text: userPrompt }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name,
        schema,
        strict: true,
      },
    },
  });

  if (!response.output_text) return null;
  return JSON.parse(response.output_text);
}

export async function classifyImportDocumentAgent({ fileName, mimeType, extractedText }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      documentType: {
        type: "string",
        enum: ["invoice", "bank_statement", "sepa_xml", "receipt", "payroll_bulk", "unknown"],
      },
      confidence: { type: "number" },
      reason: { type: "string" },
    },
    required: ["documentType", "confidence", "reason"],
  };

  const parsed = await runJsonSchemaAgent({
    name: "import_classifier_agent",
    schema,
    systemPrompt: `Tu es l'Agent Import.
Classement STRICT et conservateur:
- sepa_xml UNIQUEMENT si XML pain.001/pain.008 ou balises SEPA explicites.
- bank_statement UNIQUEMENT si relevé/extrait de compte avec lignes d'opérations bancaires.
- invoice UNIQUEMENT si facture (numéro facture, HT/TVA/TTC, émetteur/destinataire).
- receipt UNIQUEMENT si ticket/reçu caisse.
- Sinon unknown.
Ne force jamais une classe "au feeling".
Confidence:
- >=0.9 seulement si preuves explicites.
- <=0.6 si incertitude.
Réponds uniquement selon le schéma.`,
    userPrompt: `
Entreprise: ${COMPANY_IDENTITY.canonicalName}
Fichier: ${fileName}
Mime: ${mimeType}
Texte:
${extractedText || ""}
`.trim(),
  });

  return parsed
    ? {
        label: parsed.documentType,
        confidence: Number(parsed.confidence || 0),
        reason: parsed.reason || "",
        provider: "openai-import-agent",
      }
    : null;
}

export async function parseSepaWithAgent({ extractedText, structuredXml }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      documentType: { type: "string", enum: ["sepa_xml"] },
      sepaBatch: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["invoice", "payroll"] },
          label: { type: "string" },
          executionDate: { type: ["string", "null"] },
          totalAmount: { type: "number" },
          numberOfTransactions: { type: "number" },
          debtorName: { type: ["string", "null"] },
          debtorIban: { type: ["string", "null"] },
          debtorCurrency: { type: "string" },
          operations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                creditorName: { type: "string" },
                creditorIban: { type: "string" },
                creditorBic: { type: ["string", "null"] },
                amount: { type: "number" },
                currency: { type: "string" },
                endToEndId: { type: "string" },
                remittanceInfo: { type: "string" },
              },
              required: [
                "id",
                "creditorName",
                "creditorIban",
                "creditorBic",
                "amount",
                "currency",
                "endToEndId",
                "remittanceInfo",
              ],
            },
          },
        },
        required: [
          "id",
          "type",
          "label",
          "executionDate",
          "totalAmount",
          "numberOfTransactions",
          "debtorName",
          "debtorIban",
          "debtorCurrency",
          "operations",
        ],
      },
    },
    required: ["documentType", "sepaBatch"],
  };

  const parsed = await runJsonSchemaAgent({
    name: "sepa_parser_agent",
    schema,
    systemPrompt:
      "Tu es l'Agent SEPA. Extrait strictement le lot SEPA et ses opérations depuis XML/texte. Le totalAmount doit lire CtrlSum du lot (ou GrpHdr), pas seulement la somme calculée.",
    userPrompt: `
XML parsé:
${JSON.stringify(structuredXml || {}, null, 2)}

Texte:
${extractedText || ""}
`.trim(),
  });
  return parsed || null;
}

export async function parseBankStatementWithAgent({ extractedText, fileName }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      documentType: { type: "string", enum: ["bank_statement"] },
      account: {
        type: "object",
        additionalProperties: false,
        properties: {
          bankName: { type: ["string", "null"] },
          companyName: { type: ["string", "null"] },
          iban: { type: ["string", "null"] },
          bic: { type: ["string", "null"] },
          currency: { type: "string" },
          statementFrom: { type: ["string", "null"] },
          statementTo: { type: ["string", "null"] },
          sourceName: { type: ["string", "null"] },
        },
        required: [
          "bankName",
          "companyName",
          "iban",
          "bic",
          "currency",
          "statementFrom",
          "statementTo",
          "sourceName",
        ],
      },
      operations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            txnDate: { type: "string" },
            valueDate: { type: ["string", "null"] },
            label: { type: "string" },
            reference: { type: "string" },
            amount: { type: "number" },
            currency: { type: "string" },
            operationType: { type: "string", enum: ["encaissement", "decaissement"] },
            paymentMethod: { type: "string", enum: ["SEPA", "VIREMENT", "CARTE", "CHEQUE", "PRELEVEMENT", "AUTRE"] },
            counterpartyName: { type: ["string", "null"] },
          },
          required: [
            "id",
            "txnDate",
            "valueDate",
            "label",
            "reference",
            "amount",
            "currency",
            "operationType",
            "paymentMethod",
            "counterpartyName",
          ],
        },
      },
    },
    required: ["documentType", "account", "operations"],
  };

  const parsed = await runJsonSchemaAgent({
    name: "bank_statement_parser_agent",
    schema,
    systemPrompt: `Tu es l'Agent Relevé bancaire.
Extrait chaque ligne d'opération en un item distinct.
Ne jamais retourner ${COMPANY_IDENTITY.canonicalName} comme contrepartie.`,
    userPrompt: `
Fichier: ${fileName}
Texte relevé:
${extractedText || ""}
`.trim(),
  });
  return parsed || null;
}

export async function scoreReconciliationWithAgent({ transaction, invoices }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            invoiceId: { type: "string" },
            invoiceIds: {
              type: "array",
              items: { type: "string" },
            },
            matchType: {
              type: "string",
              enum: ["1:1", "1:N", "simple", "multiple", "rapprochement global (SEPA)"],
            },
            score: { type: "number" },
            reason: { type: "string" },
            signals: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["invoiceId", "invoiceIds", "matchType", "score", "reason", "signals"],
        },
      },
      missingInvoices: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            invoiceReference: { type: "string" },
            creditorName: { type: "string" },
            reason: { type: "string" },
            hint: { type: "string" },
          },
          required: ["invoiceReference", "creditorName", "reason", "hint"],
        },
      },
    },
    required: ["suggestions", "missingInvoices"],
  };

  const parsed = await runJsonSchemaAgent({
    name: "reconciliation_scoring_agent_v2",
    schema,
    systemPrompt: `Tu es un agent intelligent spécialisé en rapprochement bancaire et comptable.
Ton objectif est de proposer des suggestions de rapprochement entre des opérations bancaires et des factures, en respectant strictement les règles métier suivantes :

1. CRITÈRES PRINCIPAUX DE RAPPROCHEMENT
Chaque opération doit être comparée aux factures selon 3 critères fondamentaux :
- NOM (fournisseur / bénéficiaire)
- DATE : tolérer un intervalle de ± 3 mois entre la date de l’opération et la date de facture
- MONTANT : correspondance exacte ou quasi exacte (tolérance configurable si nécessaire)
Ces 3 critères sont prioritaires et doivent être utilisés ensemble pour valider une correspondance.

RÈGLE DE PROPOSITION vs RAPPROCHEMENT DIRECT :
- Si fournisseur + montant + date (±3 mois) sont cohérents : PROPOSER la facture même si le n° dans le SEPA diffère.
- Si en plus le n° facture (invoiceNumber) apparaît dans remittanceInfo/reference/endToEndId : score 100, matchType "simple", signal "Rapprochement direct".

2. GESTION DES CAS SEPA

Les fichiers SEPA contiennent souvent la référence facture dans remittanceInfo / endToEndId / instrId.
- PRIORITÉ ABSOLUE : rapprocher via cette référence avec invoiceNumber des factures candidates.
- Si la référence SEPA ne correspond à aucune facture candidate, ajouter une entrée dans missingInvoices
  (invoiceReference, creditorName, reason, hint) — ne pas inventer de facture.

Cas 1 : SEPA avec plusieurs sous-opérations
- Une opération SEPA peut contenir plusieurs sous-opérations
- Chaque sous-opération doit être rapprochée individuellement avec une facture
- L’agent doit identifier chaque sous-opération et rechercher une facture correspondante

Cas 2 : SEPA globale (montant unique élevé)
- Une seule opération SEPA avec un montant global
- Cette opération contient généralement un NOM de fournisseur
- L’agent doit :
  - identifier toutes les factures ayant le même fournisseur
  - calculer la somme de ces factures
  - comparer cette somme avec le montant de la SEPA
- Si les montants correspondent, proposer :
  -> "Rapprochement global"

3. EXCLUSION DES FACTURES DÉJÀ RAPPROCHÉES
- Une facture déjà rapprochée ne doit JAMAIS être réutilisée
- Elle doit être exclue de toutes les suggestions futures

4. LOGIQUE DE SUGGESTION
Pour chaque opération :
- proposer les meilleures correspondances possibles
- classer les suggestions par pertinence (score basé sur nom + date + montant)
- éviter les doublons
- être explicite dans la justification (ex: correspondance nom + montant exact + date proche)

5. SORTIE ATTENDUE
L’agent doit retourner des suggestions structurées contenant :
- id de l’opération
- id(s) des facture(s) proposées
- type de rapprochement :
  - "simple"
  - "multiple"
  - "rapprochement global (SEPA)"
- score de confiance
- justification claire

6. CONTRAINTES IMPORTANTES
- Ne jamais proposer une facture déjà utilisée
- Ne jamais proposer des rapprochements incohérents
- Prioriser la précision plutôt que la quantité de suggestions
- Gérer les cas ambigus avec prudence (score faible ou pas de suggestion)

Objectif final : produire des suggestions de rapprochement fiables, explicables et exploitables en production.

Règles techniques obligatoires:
- Tu ne dois JAMAIS inventer un invoiceId: chaque invoiceId doit être EXACTEMENT l'un des id fournis.
- Maximum 8 suggestions, triées par score décroissant.
- Si aucune facture n'est plausible, retourne suggestions: [].
- INTERDIT de proposer une facture dont vendorCustomer ne correspond PAS au nom du tiers de l'opération (counterpartyName / créancier SEPA).
- INTERDIT de regrouper plusieurs factures de fournisseurs différents dans invoiceIds.
- INTERDIT d'attribuer un score >= 90 sans correspondance de nom fournisseur ET montant quasi exact (≤ 1,50 € d'écart).
- Ne jamais combiner des factures uniquement pour atteindre un montant : le nom fournisseur prime toujours.`,
    userPrompt: `
Transaction:
${JSON.stringify(transaction || {}, null, 2)}

Factures candidates (utiliser uniquement le champ id comme invoiceId):
${JSON.stringify(invoices || [], null, 2)}

Critères OBLIGATOIRES dans l'ordre: (1) nom fournisseur identique au tiers bancaire, (2) montant, (3) date, (4) référence.
Si le nom ne correspond pas, ne propose PAS la facture (même si le montant colle).
Pour une ligne SEPA (sepaContext / paymentMethod SEPA) : si remittanceInfo ou reference contient un n° facture
absent du catalogue, remplis missingInvoices (creditorName vide "" si inconnu) au lieu de deviner.
Ne mets PAS dans missingInvoices si une facture candidate a le même fournisseur, le même montant (±1,50€) et une date dans ±3 mois.
Évite les doublons et propose des justifications explicables.
`.trim(),
  });

  if (!parsed) return null;
  return {
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    missingInvoices: Array.isArray(parsed.missingInvoices) ? parsed.missingInvoices : [],
  };
}

export async function scoreSepaReconciliationWithAgent({ sepaBatch, invoices }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      operationMatches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            operationId: { type: "string" },
            suggestions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  invoiceId: { type: "string" },
                  score: { type: "number" },
                  reason: { type: "string" },
                  signals: { type: "array", items: { type: "string" } },
                },
                required: ["invoiceId", "score", "reason", "signals"],
              },
            },
          },
          required: ["operationId", "suggestions"],
        },
      },
      combinationSuggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            invoiceIds: { type: "array", items: { type: "string" } },
            score: { type: "number" },
            reason: { type: "string" },
          },
          required: ["invoiceIds", "score", "reason"],
        },
      },
      unmatchedOperationIds: { type: "array", items: { type: "string" } },
    },
    required: ["operationMatches", "combinationSuggestions", "unmatchedOperationIds"],
  };

  const parsed = await runJsonSchemaAgent({
    name: "sepa_reconciliation_agent",
    schema,
    systemPrompt: `Tu es l'Agent IA de rapprochement SEPA.
Tu dois rapprocher chaque sous-opération SEPA avec des factures ouvertes.
Règles:
- PRIORITÉ: référence facture dans remittanceInfo / endToEndId / instrId de chaque ligne SEPA,
  comparée au champ invoiceNumber des factures (correspondance exacte ou normalisée).
- Si une référence SEPA ne matche aucune facture: lister l'operationId dans unmatchedOperationIds.
- Ensuite: montant, date, nom créancier (creditorName).
- Gérer 1:1, 1:N, paiements partiels, trop-perçu, écarts de centimes.
- Pour les lots/groupes: proposer aussi des combinaisons de factures dont la somme approche le montant global.
- Ne jamais inventer d'IDs.`,
    userPrompt: `
SEPA batch:
${JSON.stringify(sepaBatch || {}, null, 2)}

Factures candidates:
${JSON.stringify(invoices || [], null, 2)}
`.trim(),
  });

  return parsed || null;
}

export async function runGlobalReconciliationAgent({ operations, invoices, sepaBatches }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      reconciliations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            matchType: { type: "string", enum: ["1:1", "1:N", "N:1"] },
            operationIds: { type: "array", items: { type: "string" } },
            invoiceIds: { type: "array", items: { type: "string" } },
            score: { type: "number" },
            explanation: { type: "string" },
          },
          required: ["matchType", "operationIds", "invoiceIds", "score", "explanation"],
        },
      },
      unmatchedOperationIds: { type: "array", items: { type: "string" } },
      unmatchedInvoiceIds: { type: "array", items: { type: "string" } },
    },
    required: ["reconciliations", "unmatchedOperationIds", "unmatchedInvoiceIds"],
  };

  const parsed = await runJsonSchemaAgent({
    name: "global_reconciliation_agent",
    schema,
    systemPrompt: `Tu es un agent de rapprochement bancaire expert, fiable et explicable.
Tu dois produire des rapprochements réalistes selon les pratiques comptables:
- priorité: référence exacte, puis montant, date, libellé.
- gérer 1:1, 1:N, N:1.
- éviter les doublons (une même écriture/facture rapprochée deux fois sauf cas justifié).
- attribuer un score de confiance et une explication claire.
- traiter les opérations SEPA groupées et sous-opérations.`,
    userPrompt: `
Operations bancaires:
${JSON.stringify(operations || [], null, 2)}

Factures:
${JSON.stringify(invoices || [], null, 2)}

Lots SEPA:
${JSON.stringify(sepaBatches || [], null, 2)}
`.trim(),
  });

  return parsed || null;
}
