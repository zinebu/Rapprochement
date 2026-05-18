import crypto from "crypto";

function stableStringify(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${k}:${stableStringify(value[k])}`).join(",")}}`;
}

export function hashPayload(payload) {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function buildTransactionFingerprint(transaction = {}) {
  const meta = transaction?.bankMeta || {};
  return hashPayload({
    amount: Number(transaction?.amount || 0),
    currency: String(transaction?.currency || "EUR").toUpperCase(),
    txnDate: String(transaction?.txnDate || ""),
    label: String(transaction?.label || ""),
    reference: String(transaction?.reference || ""),
    counterpartyName: String(transaction?.counterpartyName || ""),
    paymentMethod: String(transaction?.paymentMethod || ""),
    operationType: String(transaction?.operationType || ""),
    beneficiary: String(meta?.beneficiary || ""),
    debtor: String(meta?.debtor || ""),
    remittanceRef: String(meta?.remittanceRef || ""),
    sepaContext: Boolean(transaction?.sepaContext),
    sepaInvoiceRef: String(transaction?.sepaOperation?.remittanceInfo || ""),
    sepaEndToEndId: String(transaction?.sepaOperation?.endToEndId || ""),
    sepaCreditorName: String(transaction?.sepaOperation?.creditorName || ""),
  });
}

export function buildInvoiceFingerprint(invoice = {}) {
  return hashPayload({
    id: String(invoice?.id || invoice?._id || ""),
    invoiceNumber: String(invoice?.invoiceNumber || ""),
    invoiceDate: String(invoice?.invoiceDate || ""),
    dueDate: String(invoice?.dueDate || ""),
    amountGross: Number(invoice?.amountGross || invoice?.amount || 0),
    amountNet: Number(invoice?.amountNet || 0),
    vatAmount: Number(invoice?.vatAmount || 0),
    currency: String(invoice?.currency || "EUR").toUpperCase(),
    vendorCustomer: String(invoice?.vendorCustomer || ""),
    type: String(invoice?.type || ""),
    status: String(invoice?.status || ""),
  });
}

/**
 * Empreinte du catalogue de factures candidates pour une opération.
 * Toute nouvelle facture candidate (id, montant, date, référence, statut…) invalide l'ancien hash.
 */
export function buildInvoicesCatalogFingerprint(invoices = []) {
  const rows = invoices
    .map((inv) => ({
      id: String(inv?.id || inv?._id || ""),
      invoiceNumber: String(inv?.invoiceNumber || ""),
      invoiceDate: String(inv?.invoiceDate || ""),
      dueDate: String(inv?.dueDate || ""),
      amountGross: Number(inv?.amountGross || inv?.amount || 0),
      amountNet: Number(inv?.amountNet || 0),
      vatAmount: Number(inv?.vatAmount || 0),
      currency: String(inv?.currency || "EUR").toUpperCase(),
      vendorCustomer: String(inv?.vendorCustomer || ""),
      type: String(inv?.type || ""),
      status: String(inv?.status || ""),
      fp: buildInvoiceFingerprint(inv),
    }))
    .filter((r) => r.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  return hashPayload(rows);
}

export function buildReconciliationSourceHash(
  transaction,
  candidateInvoices = [],
  engineVersion = ""
) {
  return hashPayload({
    transaction: buildTransactionFingerprint(transaction),
    candidateInvoiceIds: candidateInvoices
      .map((inv) => String(inv?.id || inv?._id || ""))
      .filter(Boolean)
      .sort(),
    invoicesCatalog: buildInvoicesCatalogFingerprint(candidateInvoices),
    engineVersion: String(engineVersion || ""),
  });
}
