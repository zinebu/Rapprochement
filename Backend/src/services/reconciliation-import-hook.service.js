import {
  enqueueManyBankTransactions,
  enqueueBankTransactionReconciliation,
  enqueueInvoiceReconciliation,
} from "./reconciliation-job.service.js";
import { findProposalsReferencingInvoiceId } from "./reconciliation-proposal.store.js";
import { listAllInvoicesForReconciliation } from "./reconciliation-invoices.service.js";
import { listBankTransactionsFromImports } from "./reconciliation-bank-transactions.service.js";
import { isTransactionLockedForAutoRecalc } from "./reconciliation-impact.service.js";

function buildTransactionsFromBankDocument(document) {
  const docId = String(document?._id?.toString?.() || document?.id || "");
  const structured = document?.structuredData || {};
  if (structured?.documentType !== "bank_statement" || !Array.isArray(structured.operations)) {
    return [];
  }
  const accountCurrency = structured?.account?.currency || "EUR";
  const txs = [];
  structured.operations.forEach((op, index) => {
    if (!op?.txnDate || typeof op.amount !== "number") return;
    const opId = String(op.id || `${docId}-op-${index + 1}`);
    const amount = Number(op.amount || 0);
    txs.push({
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
      reconciledStatus: "non_rapproché",
    });
  });
  return txs;
}

export async function onBankStatementDocumentDispatched(document) {
  const transactions = buildTransactionsFromBankDocument(document);
  if (!transactions.length) return { enqueued: 0 };
  return enqueueManyBankTransactions(transactions, { force: false });
}

export async function onInvoiceCreatedOrUpdated(invoiceId) {
  if (!invoiceId) return { enqueued: 0, impacted: 0 };
  return enqueueInvoiceReconciliation(String(invoiceId));
}

export { findImpactedBankTransactions } from "./reconciliation-impact.service.js";

/** Recalcule les opérations dont les propositions référencent une facture supprimée. */
export async function onInvoiceRemoved(invoiceId) {
  if (!invoiceId) return { enqueued: 0 };

  const rows = await findProposalsReferencingInvoiceId(invoiceId);
  const parentTxnIds = new Set();
  for (const row of rows) {
    const scopeId = String(row.scopeId || "");
    if (!scopeId) continue;
    parentTxnIds.add(scopeId.includes("::") ? scopeId.split("::")[0] : scopeId);
  }

  if (!parentTxnIds.size) return { enqueued: 0, invoiceId: String(invoiceId) };

  const transactions = await listBankTransactionsFromImports();
  const byId = new Map(transactions.map((t) => [String(t.id), t]));
  const invoices = await listAllInvoicesForReconciliation();
  let enqueued = 0;

  for (const txnId of parentTxnIds) {
    const txn = byId.get(txnId);
    if (!txn || isTransactionLockedForAutoRecalc(txn)) continue;
    const result = await enqueueBankTransactionReconciliation(txn, {
      invoices,
      force: true,
    });
    if (result?.enqueued) enqueued += 1;
  }

  return { enqueued, invoiceId: String(invoiceId), transactionIds: [...parentTxnIds] };
}
