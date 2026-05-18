import { listImportedDocuments } from "../storage/import.store.js";

function normalizeAmount(op) {
  const opType = String(op.operationType || "").toLowerCase();
  const hay = `${op.label || ""} ${op.reference || ""} ${op.bankOperationType || ""}`.toLowerCase();
  const absAmount = Math.abs(Number(op.amount || 0));
  let normalizedAmount = Number(op.amount || 0);
  if (normalizedAmount >= 0) {
    if (opType === "decaissement") normalizedAmount = -absAmount;
    else if (opType === "encaissement") normalizedAmount = absAmount;
    else if (/\bvir\.?\s*re[çc]u\b|\bencaissement\b|\bversement\b|\bcr[eé]dit\b/.test(hay)) {
      normalizedAmount = absAmount;
    } else {
      normalizedAmount = -absAmount;
    }
  }
  return normalizedAmount;
}

export async function listBankTransactionsFromImports() {
  const docs = await listImportedDocuments();
  const transactions = [];

  for (const doc of docs) {
    const docId = String(doc._id?.toString?.() || doc.id || "");
    const structured = doc.structuredData || {};
    const docType = structured.documentType || doc.documentType;
    if (docType !== "bank_statement" || !Array.isArray(structured.operations)) continue;

    const accountCurrency = structured?.account?.currency || "EUR";
    structured.operations.forEach((op, index) => {
      if (!op?.txnDate || typeof op.amount !== "number") return;
      const opId = String(op.id || `${docId}-op-${index + 1}`);
      const amount = normalizeAmount(op);
      const persisted = structured?.reconciliation?.operations?.[opId] || {};
      transactions.push({
        id: opId,
        sourceDocumentId: docId,
        txnDate: op.txnDate,
        label: op.label || "Opération",
        reference: op.reference || `${docId}-${index + 1}`,
        amount,
        currency: op.currency || accountCurrency || "EUR",
        operationType: op.operationType || (amount >= 0 ? "encaissement" : "decaissement"),
        paymentMethod: op.paymentMethod || "AUTRE",
        counterpartyName: op.counterpartyName || null,
        bankMeta: op.bankMeta || null,
        reconciledStatus: persisted.reconciledStatus || "non_rapproché",
        matchedInvoiceIds: persisted.matchedInvoiceIds || [],
      });
    });
  }

  return transactions;
}
