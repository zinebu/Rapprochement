import { createPurchaseInvoice } from "../modules/invoices/purchase.store.js";
import { createSalesInvoice } from "../modules/invoices/sales.store.js";
import { addToReviewQueue } from "../modules/review/review.store.js";

function parseMoneyToNumber(value) {
  if (typeof value === "number") {
    return Number.isNaN(value) ? null : value;
  }

  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .replace(/\u00A0/g, " ")
    .replace(/\s/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function pickField(primary, fallback = null, defaultValue = null) {
  if (primary !== undefined && primary !== null && primary !== "") {
    return primary;
  }

  if (fallback !== undefined && fallback !== null && fallback !== "") {
    return fallback;
  }

  return defaultValue;
}

function mergeExtractionData(local = {}, ai = {}) {
  return {
    invoiceNumber: pickField(ai.invoiceNumber, local.invoiceNumber),
    invoiceDate: pickField(ai.invoiceDate, local.invoiceDate),
    dueDate: pickField(ai.dueDate, local.dueDate),
    amountNet: pickField(ai.amountNet, local.amountNet),
    vatAmount: pickField(ai.vatAmount, local.vatAmount),
    amountInclVat: pickField(ai.amountInclVat, local.amountInclVat),
    currency: pickField(ai.currency, local.currency),
    iban: pickField(ai.iban, local.iban),
    swift: pickField(ai.swift, local.swift),
    issuerName: pickField(ai.issuerName, local?.issuer?.name),
    issuerSiret: pickField(ai.issuerSiret, local?.issuer?.siret),
    recipientName: pickField(ai.recipientName, local?.recipient?.name),
    recipientSiret: pickField(ai.recipientSiret, local?.recipient?.siret),
    counterpartyRole: pickField(ai.counterpartyRole, local.counterpartyRole),
  };
}

async function sendToReview(documentId, reason, extra = {}) {
  const reviewItem = await addToReviewQueue({
    documentId,
    reason,
    ...extra,
  });

  return {
    target: "review",
    duplicated: false,
    reviewItem,
  };
}

export async function dispatchBusinessDocument(document) {
  const {
    detectedType,
    invoiceNature,
    structuredData,
    extractedFields,
    id,
    _id,
    fileUrl,
  } = document;

  const documentId = id || _id?.toString();
  const local = structuredData || {};
  const ai = extractedFields || {};
  const merged = mergeExtractionData(local, ai);

  if (detectedType !== "invoice") {
    return await sendToReview(documentId, "Document non reconnu comme facture");
  }

  const effectiveNature =
    local.invoiceNature && local.invoiceNature !== "unknown"
      ? local.invoiceNature
      : invoiceNature;

  const resolvedCurrency = pickField(merged.currency, null, null);

  if (!resolvedCurrency) {
    return await sendToReview(documentId, "Devise non identifiée");
  }

  const invoicePayload = {
    sourceDocumentId: documentId,
    invoiceNumber: pickField(merged.invoiceNumber, null),
    invoiceDate: pickField(merged.invoiceDate, null),
    dueDate: pickField(merged.dueDate, null),
    amountNet: parseMoneyToNumber(merged.amountNet) ?? 0,
    vatAmount: parseMoneyToNumber(merged.vatAmount) ?? 0,
    amount: parseMoneyToNumber(merged.amountInclVat) ?? 0,
    currency: resolvedCurrency,
    iban: pickField(merged.iban, null),
    swift: pickField(merged.swift, null),
    pdfUrl: fileUrl || null,
    issuerName: pickField(merged.issuerName, null),
    issuerSiret: pickField(merged.issuerSiret, null),
    recipientName: pickField(merged.recipientName, null),
    recipientSiret: pickField(merged.recipientSiret, null),
    counterpartyRole: pickField(merged.counterpartyRole, null),
  };

  if (effectiveNature === "sales") {
    const payload = {
      ...invoicePayload,
      clientName: pickField(
        merged.recipientName,
        local?.recipient?.name,
        "Client inconnu"
      ),
      clientSiret: pickField(
        merged.recipientSiret,
        local?.recipient?.siret,
        null
      ),
    };

    try {
      const invoice = await createSalesInvoice(payload);

      return {
        target: "sales",
        duplicated: false,
        invoice,
      };
    } catch (error) {
      if (error?.code === 11000 || error?.message?.includes("E11000")) {
        console.log("Doublon vente détecté");

        return {
          target: "sales",
          duplicated: true,
          message: "Facture de vente déjà existante",
        };
      }

      throw error;
    }
  }

  if (effectiveNature === "purchase") {
    const payload = {
      ...invoicePayload,
      supplierName: pickField(
        merged.issuerName,
        local?.issuer?.name,
        "Fournisseur inconnu"
      ),
      supplierSiret: pickField(
        merged.issuerSiret,
        local?.issuer?.siret,
        null
      ),
    };

    try {
      const invoice = await createPurchaseInvoice(payload);

      return {
        target: "purchase",
        duplicated: false,
        invoice,
      };
    } catch (error) {
      if (error?.code === 11000 || error?.message?.includes("E11000")) {
        console.log("Doublon achat détecté");

        return {
          target: "purchase",
          duplicated: true,
          message: "Facture d'achat déjà existante",
        };
      }

      throw error;
    }
  }

  return await sendToReview(documentId, "Nature de facture inconnue ou ambiguë");
}