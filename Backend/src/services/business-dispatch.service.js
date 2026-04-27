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

/**
 * Determine invoice nature (purchase / sales) using SIRET matching against
 * the company's own SIRET from env (COMPANY_SIRET).
 *
 * Rules (in priority order):
 *   1. If recipient SIRET === company SIRET → purchase (we received the invoice) — high confidence
 *   2. If issuer SIRET === company SIRET:
 *        - OCR often picks up the company letterhead/stamp as issuer even on
 *          purchase invoices. We therefore trust DEFAULT_INVOICE_NATURE here.
 *        - Only return "sales" when DEFAULT_INVOICE_NATURE is explicitly "sales".
 *   3. No SIRET match → fall back to DEFAULT_INVOICE_NATURE, then aiNature.
 *
 * DEFAULT_INVOICE_NATURE (env) lets operators configure the expected default
 * for their workflow (e.g. "purchase" when all imports are supplier invoices).
 */
function resolveInvoiceNature(merged, local, aiNature) {
  const companySiret = String(process.env.COMPANY_SIRET || "").trim().replace(/\s/g, "");
  const defaultNature = String(process.env.DEFAULT_INVOICE_NATURE || "").trim().toLowerCase();
  const fallback = defaultNature === "sales" || defaultNature === "purchase"
    ? defaultNature
    : (aiNature || "purchase");

  if (companySiret) {
    const issuerSiret    = String(merged.issuerSiret    || local?.issuer?.siret    || "").trim().replace(/\s/g, "");
    const recipientSiret = String(merged.recipientSiret || local?.recipient?.siret || "").trim().replace(/\s/g, "");

    const issuerIsCompany    = Boolean(issuerSiret    && issuerSiret    === companySiret);
    const recipientIsCompany = Boolean(recipientSiret && recipientSiret === companySiret);

    // High-confidence: recipient SIRET matches → we are the buyer
    if (recipientIsCompany && !issuerIsCompany) return "purchase";

    // Issuer SIRET matches company: OCR often confuses our letterhead/stamp
    // with the issuer on received invoices — trust the configured default.
    if (issuerIsCompany && !recipientIsCompany) return fallback;

    // Both match (intra-group invoice): trust default
    if (issuerIsCompany && recipientIsCompany) return fallback;
  }

  return fallback;
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

  const localNature =
    local.invoiceNature && local.invoiceNature !== "unknown"
      ? local.invoiceNature
      : null;

  const aiNature = invoiceNature && invoiceNature !== "unknown" ? invoiceNature : null;

  const effectiveNature = resolveInvoiceNature(merged, local, localNature || aiNature);

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
    // When OCR confuses our own company name as the issuer, the real supplier
    // is the OTHER party. Detect this by comparing extracted names against
    // COMPANY_NAME (env). If issuerName looks like our own company, use the
    // recipientName as the supplier instead (or vice-versa with SIRETs).
    const companyName = String(process.env.COMPANY_NAME || "").trim().toLowerCase();
    const companySiretEnv = String(process.env.COMPANY_SIRET || "").trim().replace(/\s/g, "");

    const rawIssuerName   = String(merged.issuerName    || local?.issuer?.name    || "").trim();
    const rawIssuerSiret  = String(merged.issuerSiret   || local?.issuer?.siret   || "").trim().replace(/\s/g, "");
    const rawRecipName    = String(merged.recipientName || local?.recipient?.name || "").trim();
    const rawRecipSiret   = String(merged.recipientSiret || local?.recipient?.siret || "").trim().replace(/\s/g, "");

    const issuerLooksLikeOurCompany =
      (companyName && rawIssuerName.toLowerCase() === companyName) ||
      (companySiretEnv && rawIssuerSiret === companySiretEnv);

    const recipLooksLikeOurCompany =
      (companyName && rawRecipName.toLowerCase() === companyName) ||
      (companySiretEnv && rawRecipSiret === companySiretEnv);

    // If issuer is our company but recipient is not → the parser swapped them.
    // The real supplier is the "recipient" in the parsed data.
    const resolvedSupplierName = issuerLooksLikeOurCompany && !recipLooksLikeOurCompany
      ? rawRecipName || rawIssuerName || "Fournisseur inconnu"
      : rawIssuerName || rawRecipName || "Fournisseur inconnu";

    const resolvedSupplierSiret = issuerLooksLikeOurCompany && !recipLooksLikeOurCompany
      ? (rawRecipSiret || rawIssuerSiret || null)
      : (rawIssuerSiret || rawRecipSiret || null);

    const payload = {
      ...invoicePayload,
      supplierName: resolvedSupplierName,
      supplierSiret: resolvedSupplierSiret || null,
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