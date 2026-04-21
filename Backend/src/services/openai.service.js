import fs from "fs";
import OpenAI from "openai";
import { COMPANY_IDENTITY } from "../config/company-identity.js";

console.log("LOADED openai.service.js VERSION VISION");

function fileToDataUrl(filePath, mimeType = "image/png") {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

export async function classifyWithOpenAI({
  fileName,
  mimeType,
  extractedText,
  structuredData,
  natureHints,
  filePath,
  pageImages = [],
}) {
  const enabled = process.env.OPENAI_ENABLED === "true";

  if (!enabled) {
    return {
      label: "unknown",
      confidence: 0,
      invoiceNature: "unknown",
      fields: {},
      provider: "disabled",
      raw: null,
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY manquante dans le .env");
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      documentType: {
        type: "string",
        enum: ["invoice", "bank_statement", "sepa_xml", "receipt", "unknown"],
      },
      invoiceNature: {
        type: "string",
        enum: ["sales", "purchase", "unknown"],
      },
      confidence: { type: "number" },
      fields: {
        type: "object",
        additionalProperties: false,
        properties: {
          issuerName: { type: ["string", "null"] },
          issuerSiret: { type: ["string", "null"] },
          recipientName: { type: ["string", "null"] },
          recipientSiret: { type: ["string", "null"] },
          counterpartyRole: { type: ["string", "null"] },
          invoiceNumber: { type: ["string", "null"] },
          invoiceDate: { type: ["string", "null"] },
          dueDate: { type: ["string", "null"] },
          vatNumber: { type: ["string", "null"] },
          iban: { type: ["string", "null"] },
          swift: { type: ["string", "null"] },
          reasonOfPayment: { type: ["string", "null"] },
          amountNet: { type: ["string", "null"] },
          vatAmount: { type: ["string", "null"] },
          amountInclVat: { type: ["string", "null"] },
          vendorCustomer: { type: ["string", "null"] },
          currency: { type: ["string", "null"] },
        },
        required: [
          "issuerName",
          "issuerSiret",
          "recipientName",
          "recipientSiret",
          "counterpartyRole",
          "invoiceNumber",
          "invoiceDate",
          "dueDate",
          "vatNumber",
          "iban",
          "swift",
          "reasonOfPayment",
          "amountNet",
          "vatAmount",
          "amountInclVat",
          "vendorCustomer",
          "currency",
        ],
      },
    },
    required: ["documentType", "invoiceNature", "confidence", "fields"],
  };

  const systemPrompt = `
Tu es un extracteur comptable rigoureux.
Tu dois renvoyer uniquement un JSON conforme au schéma demandé.

Entreprise de référence :
- Nom canonique : ${COMPANY_IDENTITY.canonicalName}
- Alias : ${COMPANY_IDENTITY.aliases.join(", ")}
- SIRET : ${COMPANY_IDENTITY.siret}

Règles de classification :
- "sales" si notre société est l'émetteur.
- "purchase" si notre société est le destinataire/client.
- Identifier séparément issuer et recipient.
- Si doute sur la nature : "unknown".
- Ne rien inventer.

Règles d'extraction :
- Extraire uniquement les informations réellement visibles ou fortement déductibles du document.
- Si une information n'est pas trouvable, retourner null.
- Ne pas inventer de numéro de facture, de montant, de devise ou de nom.

Règle devise :
- Si une devise est explicitement écrite dans le document, utilise-la.
- Sinon, essaie de la déduire uniquement à partir d'indices solides et cohérents réellement visibles dans le document.
- Exemples d'indices possibles : pays, adresse complète, ville, numéro fiscal, IBAN, contexte commercial explicite.
- Si les indices visibles pointent clairement vers le Maroc, retourne "MAD".
- Si les indices visibles pointent clairement vers la zone euro, retourne "EUR".
- Si les indices visibles pointent clairement vers les États-Unis, retourne "USD".
- Si la devise n'est pas explicitement visible et qu'aucun indice fort ne permet une déduction fiable, retourne null.
- Ne retourne jamais une devise par défaut.
- N'invente jamais la devise.

Règles montants :
- amountInclVat = montant total TTC / total payé si identifiable.
- amountNet = montant HT ou montant principal si identifiable.
- Si le document est un ticket de caisse et qu'un total payé est visible, privilégier ce total dans amountInclVat.

Règle de prudence :
- En cas de doute, préfère null plutôt qu'une valeur inventée.
`;

  const input = [
    {
      role: "system",
      content: [{ type: "input_text", text: systemPrompt }],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: `
Nom du fichier : ${fileName}
MIME type : ${mimeType}

Texte OCR / extrait :
${extractedText || ""}

Champs locaux :
${JSON.stringify(structuredData ?? {}, null, 2)}

Indices locaux :
${JSON.stringify(natureHints ?? {}, null, 2)}

Consigne complémentaire :
Déduis la devise du document seulement si elle est explicitement visible
ou si des indices forts et cohérents permettent une déduction fiable.
- Si elle est écrite, utilise-la.
- Maroc clairement identifiable => MAD.
- Zone euro clairement identifiable => EUR.
- États-Unis clairement identifiables => USD.
- Si rien n'est suffisamment fiable => null.
- Ne retourne jamais EUR par défaut.
          `.trim(),
        },
      ],
    },
  ];

  const imagesToSend = [];

  if (mimeType?.startsWith("image/") && filePath) {
    imagesToSend.push({ path: filePath, mimeType });
  }

  for (const pageImage of pageImages.slice(0, 3)) {
    imagesToSend.push({ path: pageImage, mimeType: "image/png" });
  }

  for (const img of imagesToSend) {
    input[1].content.push({
      type: "input_image",
      image_url: fileToDataUrl(img.path, img.mimeType),
    });
  }

  const response = await client.responses.create({
    model,
    input,
    text: {
      format: {
        type: "json_schema",
        name: "document_classification",
        schema,
        strict: true,
      },
    },
  });

  const content = response.output_text;
  if (!content) {
    throw new Error("Réponse OpenAI vide");
  }

  const parsed = JSON.parse(content);

  return {
    label: parsed.documentType ?? "unknown",
    confidence: parsed.confidence ?? 0,
    invoiceNature: parsed.invoiceNature ?? "unknown",
    fields: parsed.fields ?? {},
    provider: "openai",
    raw: parsed,
  };
}