import { scoreReconciliationWithAgent } from "./openai-agents.service.js";

import { filterEligibleInvoices } from "./reconciliation-scoring.service.js";

import { buildReconciliationSourceHash } from "./reconciliation-hash.service.js";

import { buildCandidateInvoicesForTransaction } from "./reconciliation-candidates.service.js";

import {
  applyStrictProposalGates,
  mergeStrongMatchesIntoSuggestions,
  resolveAiMissingInvoices,
} from "./reconciliation-proposal-guards.js";

export const RECONCILIATION_ENGINE_VERSION = "reco-v8.2-resolve-missing";



function isSepaTransaction(transaction = {}) {

  return (

    Boolean(transaction?.sepaContext) ||

    String(transaction?.paymentMethod || "").toUpperCase() === "SEPA" ||

    /\bsepa\b/i.test(String(transaction?.label || "")) ||

    /\bsepa\b/i.test(String(transaction?.reference || "")) ||

    String(transaction?.id || "").startsWith("batch::") ||

    String(transaction?.id || "").includes("::")

  );

}



function assertOpenAiConfigured() {

  if (process.env.OPENAI_ENABLED !== "true") {

    throw new Error(

      "Rapprochement IA désactivé : définir OPENAI_ENABLED=true dans le .env"

    );

  }

  if (!process.env.OPENAI_API_KEY) {

    throw new Error("OPENAI_API_KEY manquante dans le .env");

  }

}



function extractInvoiceIdsFromAiRow(ai = {}) {

  if (Array.isArray(ai.invoiceIds) && ai.invoiceIds.length > 0) {

    return [...new Set(ai.invoiceIds.map((id) => String(id)).filter(Boolean))];

  }

  const single = String(ai.invoiceId || "").trim();

  return single ? [single] : [];

}



function invoiceRowSummary(inv) {

  return {

    id: String(inv.id || inv._id || ""),

    invoiceNumber: inv.invoiceNumber || "",

    vendorCustomer: inv.vendorCustomer || "",

    amountGross: Number(inv.amountGross || 0),

  };

}



function mapAiSuggestionsToProposal(aiSuggestions, transaction, candidateInvoices) {

  const validInvoiceIds = new Set(

    candidateInvoices.map((inv) => String(inv.id || inv._id || "")).filter(Boolean)

  );

  const invoiceById = new Map(

    candidateInvoices.map((inv) => [String(inv.id || inv._id || ""), inv])

  );

  const txnAbs = Math.abs(Number(transaction?.amount || 0));



  const suggestions = [];

  const combinations = [];

  const seenSuggestionIds = new Set();

  const seenComboKeys = new Set();



  for (const ai of aiSuggestions || []) {

    const ids = extractInvoiceIdsFromAiRow(ai).filter((id) => validInvoiceIds.has(id));

    if (!ids.length) continue;



    const score = Math.round(Math.min(100, Math.max(0, Number(ai.score || 0))));

    const reason = String(ai.reason || "").trim();

    const signals = Array.isArray(ai.signals)

      ? ai.signals.map((s) => String(s)).filter(Boolean)

      : [];

    const matchTypeRaw = String(ai.matchType || "").toLowerCase();

    const matchType = matchTypeRaw.includes("supplier") ? "supplier" : "amount";



    if (ids.length === 1) {

      const invoiceId = ids[0];

      if (seenSuggestionIds.has(invoiceId)) continue;

      seenSuggestionIds.add(invoiceId);

      const inv = invoiceById.get(invoiceId);

      suggestions.push({

        invoiceId,

        score,

        reason,

        signals,

        invoice: inv ? invoiceRowSummary(inv) : undefined,

      });

      continue;

    }



    const key = ids.slice().sort().join("|");

    if (seenComboKeys.has(key)) continue;

    seenComboKeys.add(key);



    const invs = ids.map((id) => invoiceById.get(id)).filter(Boolean);

    const totalAmount =

      Math.round(invs.reduce((s, inv) => s + Math.abs(Number(inv.amountGross || 0)), 0) * 100) /

      100;

    const diff = Math.round(Math.abs(totalAmount - txnAbs) * 100) / 100;



    combinations.push({

      invoiceIds: ids,

      invoices: invs.map(invoiceRowSummary),

      totalAmount,

      diff,

      matchType,

      score,

      reason: reason || `Combinaison de ${ids.length} factures · Total ${totalAmount.toFixed(2)} €`,

    });

  }



  suggestions.sort((a, b) => b.score - a.score);

  combinations.sort((a, b) => b.score - a.score);



  return {

    suggestions: suggestions.slice(0, 8),

    combinations: combinations.slice(0, 8),

  };

}



function normalizeMissingInvoices(rows = [], transaction = {}) {

  const lineAmount = Math.abs(Number(transaction?.amount || 0));

  const currency = String(transaction?.currency || "EUR");

  const defaultCreditor =

    transaction?.sepaOperation?.creditorName ||

    transaction?.counterpartyName ||

    null;



  return rows

    .map((row) => ({

      invoiceReference: String(row?.invoiceReference || "").trim() || null,

      creditorName: String(row?.creditorName || "").trim() || defaultCreditor || null,

      amount: lineAmount > 0 ? lineAmount : undefined,

      currency,

      reason: String(row?.reason || "Facture absente du catalogue").trim(),

      hint: String(row?.hint || "").trim() || undefined,

    }))

    .filter((row) => row.invoiceReference || row.reason);

}



/**

 * Propositions de rapprochement via l'agent OpenAI uniquement.

 */

export async function computeReconciliationForTransaction(transaction, invoices = []) {

  assertOpenAiConfigured();



  const isSepaTxn = isSepaTransaction(transaction);

  const eligible = filterEligibleInvoices(transaction, invoices);

  const candidateInvoices = eligible.length > 0 ? eligible : invoices;



  let aiResult;

  try {

    aiResult = await scoreReconciliationWithAgent({

      transaction,

      invoices: candidateInvoices,

    });

  } catch (error) {

    throw new Error(

      `Échec appel OpenAI (rapprochement): ${String(error?.message || error)}`

    );

  }



  if (aiResult === null) {

    throw new Error(

      "OpenAI indisponible : vérifiez OPENAI_ENABLED=true et OPENAI_API_KEY"

    );

  }



  const aiSuggestions = Array.isArray(aiResult)

    ? aiResult

    : Array.isArray(aiResult?.suggestions)

      ? aiResult.suggestions

      : null;



  if (!Array.isArray(aiSuggestions)) {

    throw new Error("Réponse OpenAI invalide pour le rapprochement");

  }



  const aiMissingInvoices = normalizeMissingInvoices(

    Array.isArray(aiResult?.missingInvoices) ? aiResult.missingInvoices : [],

    transaction

  );



  const mapped = mapAiSuggestionsToProposal(aiSuggestions, transaction, candidateInvoices);

  const gated = applyStrictProposalGates(transaction, mapped, candidateInvoices);

  let suggestions = mergeStrongMatchesIntoSuggestions(
    transaction,
    gated.suggestions,
    invoices
  );

  const resolvedMissing = resolveAiMissingInvoices(
    transaction,
    aiMissingInvoices,
    suggestions,
    invoices
  );
  if (resolvedMissing.suggestions.length > 0) {
    suggestions = mergeStrongMatchesIntoSuggestions(
      transaction,
      [...suggestions, ...resolvedMissing.suggestions],
      invoices
    );
  }
  const finalMissingInvoices = resolvedMissing.missingInvoices;

  const combinations = gated.combinations;



  const scoring =

    suggestions.length > 0 || combinations.length > 0

      ? isSepaTxn

        ? combinations.length > 0

          ? "ai+combinations+supplier-gate"

          : "ai-only+supplier-gate"

        : "ai-only+supplier-gate"

      : finalMissingInvoices.length > 0

        ? "ai-missing-invoice"

        : "ai-empty";



  const top =

    suggestions[0] ||

    (combinations[0]

      ? {

          score: combinations[0].score,

          reason: combinations[0].reason,

        }

      : aiMissingInvoices[0]

        ? {

            score: 0,

            reason: aiMissingInvoices[0].reason,

          }

        : null);



  const candidatesForHash = buildCandidateInvoicesForTransaction(transaction, invoices);

  const sourceHash = buildReconciliationSourceHash(

    transaction,

    candidatesForHash,

    RECONCILIATION_ENGINE_VERSION

  );



  return {

    success: true,

    sourceHash,

    suggestions,

    combinations: isSepaTxn ? combinations : [],

    missingInvoices: finalMissingInvoices,

    scoring,

    engineVersion: RECONCILIATION_ENGINE_VERSION,

    topScore: Number(top?.score || 0),

    topExplanation: String(top?.reason || ""),

    proposalData: {

      suggestions,

      combinations: isSepaTxn ? combinations : [],

      missingInvoices: finalMissingInvoices,

      scoring,

      engineVersion: RECONCILIATION_ENGINE_VERSION,

    },

  };

}


