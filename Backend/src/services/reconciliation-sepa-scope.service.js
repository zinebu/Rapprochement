import { listImportedDocuments } from "../storage/import.store.js";
import { listBankTransactionsFromImports } from "./reconciliation-bank-transactions.service.js";

function normalizeSepaRef(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s\-_./]+/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function listSepaBatchesByReference() {
  const docs = await listImportedDocuments();
  const batchesByReference = {};

  for (const doc of docs) {
    const docId = String(doc._id?.toString?.() || doc.id || "");
    const structured = doc.structuredData || {};
    const docType = structured.documentType || doc.documentType;
    if (!structured.sepaBatch) continue;
    if (docType !== "sepa_xml" && !String(docType || "").includes("sepa")) continue;

    const batch = structured.sepaBatch;
    const seenIds = new Set();
    const normalizedOperations = (batch.operations || []).map((op, index) => {
      const baseId = String(op?.id || op?.endToEndId || `sepa-op-${index + 1}`);
      let uniqueId = baseId;
      if (seenIds.has(uniqueId)) uniqueId = `${baseId}-${index + 1}`;
      seenIds.add(uniqueId);
      return { ...op, id: uniqueId };
    });

    const key = String(batch.id || docId);
    batchesByReference[key] = {
      ...batch,
      operations: normalizedOperations,
      sourceDocumentId: docId,
    };
  }

  return batchesByReference;
}

export function findSepaBatchByReference(reference, batchesByReference) {
  if (!reference) return null;
  const wanted = normalizeSepaRef(reference);
  for (const [key, batch] of Object.entries(batchesByReference)) {
    const keyNorm = normalizeSepaRef(key);
    const idNorm = normalizeSepaRef(batch?.id || "");
    const opRefs = Array.isArray(batch?.operations)
      ? batch.operations.flatMap((op) => [
          normalizeSepaRef(op?.instrId || ""),
          normalizeSepaRef(op?.endToEndId || ""),
          normalizeSepaRef(op?.remittanceInfo || ""),
          normalizeSepaRef(op?.id || ""),
        ])
      : [];
    const strict = keyNorm === wanted || idNorm === wanted || opRefs.includes(wanted);
    const loose =
      wanted.length >= 8 &&
      (keyNorm.includes(wanted) ||
        wanted.includes(keyNorm) ||
        idNorm.includes(wanted) ||
        wanted.includes(idNorm) ||
        opRefs.some((r) => r && (r.includes(wanted) || wanted.includes(r))));
    if (strict || loose) return batch;
  }
  return null;
}

function txnLooksSepaRelated(txn) {
  const hay = `${txn.label || ""} ${txn.reference || ""} ${txn.bankOperationType || ""}`.toLowerCase();
  return (
    String(txn.paymentMethod || "").toUpperCase() === "SEPA" ||
    /\bsepa\b|\brem\s+vir\s+sepa\b|\bvir\.?\s*[eé]mis\b|\bpain\.001\b/i.test(hay)
  );
}

function counterpartyForTxn(txn) {
  const meta = txn.bankMeta || {};
  const beneficiary = meta.beneficiary || null;
  const debtor = meta.debtor || null;
  if (Number(txn.amount || 0) < 0) {
    return beneficiary || meta.ultimateCreditor || debtor || txn.counterpartyName || "";
  }
  return debtor || meta.ultimateCreditor || beneficiary || txn.counterpartyName || "";
}

export function findSepaBatchForTransaction(txn, batchesByReference) {
  if (!txn) return null;

  const refCandidates = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s && !refCandidates.includes(s)) refCandidates.push(s);
  };
  push(txn.reference);
  const m = txn.bankMeta || {};
  push(m.reference);
  push(m.remittanceRef);
  push(m.mandate);
  push(m.orgId);
  push(m.info);

  for (const s of refCandidates) {
    const hit = findSepaBatchByReference(s, batchesByReference);
    if (hit) return hit;
  }
  const viaLabel = findSepaBatchByReference(txn.label || "", batchesByReference);
  if (viaLabel) return viaLabel;

  if (!txnLooksSepaRelated(txn)) return null;

  const amt = Math.round(Math.abs(Number(txn.amount || 0)) * 100) / 100;
  if (!amt) return null;

  const amountMatchesBatch = (batch) => {
    const batchTotal = Math.round(Math.abs(Number(batch.totalAmount || 0)) * 100) / 100;
    const sumOps = Math.round(
      Math.abs((batch.operations || []).reduce((s, op) => s + Number(op.amount || 0), 0)) * 100
    ) / 100;
    return Math.abs(batchTotal - amt) <= 0.02 || Math.abs(sumOps - amt) <= 0.02;
  };

  const candidates = Object.values(batchesByReference).filter((batch) => {
    if (!amountMatchesBatch(batch)) return false;
    const ex = batch.executionDate ? Date.parse(String(batch.executionDate).slice(0, 10)) : NaN;
    const txd = txn.txnDate ? Date.parse(String(txn.txnDate).slice(0, 10)) : NaN;
    if (Number.isFinite(ex) && Number.isFinite(txd) && Math.abs(ex - txd) > 14 * 86400000) {
      return false;
    }
    return true;
  });

  if (candidates.length === 1) return candidates[0];

  if (candidates.length > 1) {
    const cp = normalizeText(counterpartyForTxn(txn));
    if (cp.length >= 3) {
      const narrowed = candidates.filter((batch) => {
        const names = (batch.operations || [])
          .map((op) => normalizeText(op.creditorName || ""))
          .filter(Boolean)
          .join(" ");
        return names && (names.includes(cp) || cp.includes(names.slice(0, 48)));
      });
      if (narrowed.length === 1) return narrowed[0];
    }
  }

  return null;
}

export function buildSepaLineTransaction(parentTxn, sepaOp) {
  const opAmountAbs = Math.abs(Number(sepaOp.amount || 0));
  const remittance = String(sepaOp.remittanceInfo || "").trim();
  const endToEnd = String(sepaOp.endToEndId || "").trim();
  return {
    ...parentTxn,
    id: `${parentTxn.id}::${sepaOp.id}`,
    label: `${sepaOp.creditorName || ""} ${remittance}`.trim() || parentTxn.label,
    reference: remittance || endToEnd || parentTxn.reference,
    amount: -opAmountAbs,
    currency: sepaOp.currency || parentTxn.currency,
    operationType: "decaissement",
    paymentMethod: "SEPA",
    sepaContext: true,
    counterpartyName: sepaOp.creditorName || parentTxn.counterpartyName,
    sepaOperation: {
      id: String(sepaOp.id || ""),
      creditorName: sepaOp.creditorName || null,
      creditorIban: sepaOp.creditorIban || null,
      remittanceInfo: remittance || null,
      endToEndId: endToEnd || null,
      instrId: sepaOp.instrId || null,
      amount: Number(sepaOp.amount || 0),
      currency: sepaOp.currency || parentTxn.currency,
    },
    reconciledStatus: "non_rapproché",
    matchedInvoiceIds: [],
    pendingInvoiceIds: [],
  };
}

export function buildBatchLevelTransaction(parentTxn, batch) {
  const batchTotalAbs =
    Math.abs(Number(batch.totalAmount || 0)) ||
    (batch.operations || []).reduce((s, op) => s + Math.abs(Number(op.amount || 0)), 0);
  return {
    ...parentTxn,
    id: `batch::${parentTxn.id}`,
    label: `Lot SEPA ${batch.label || batch.id || ""}`.trim(),
    amount: -Math.abs(batchTotalAbs),
    paymentMethod: "SEPA",
    sepaContext: true,
    reconciledStatus: parentTxn.reconciledStatus,
    matchedInvoiceIds: parentTxn.matchedInvoiceIds || [],
  };
}

export async function buildReconciliationScopeContext() {
  const [allTxns, sepaBatchesByReference] = await Promise.all([
    listBankTransactionsFromImports(),
    listSepaBatchesByReference(),
  ]);
  return {
    allTxns,
    byId: new Map(allTxns.map((t) => [String(t.id), t])),
    sepaBatchesByReference,
  };
}

/**
 * Résout un scopeId (opération relevé, ligne SEPA `parent::op`, lot `batch::parent`).
 */
export function resolveScopeToTransaction(scopeId, ctx) {
  const id = String(scopeId || "");
  if (!id) return null;

  const { byId, sepaBatchesByReference } = ctx;

  if (id.startsWith("batch::")) {
    const parentId = id.slice("batch::".length);
    const parent = byId.get(parentId);
    if (!parent) return null;
    const batch = findSepaBatchForTransaction(parent, sepaBatchesByReference);
    if (!batch) return null;
    return buildBatchLevelTransaction(parent, batch);
  }

  const sepIdx = id.indexOf("::");
  if (sepIdx > 0) {
    const parentId = id.slice(0, sepIdx);
    const opId = id.slice(sepIdx + 2);
    const parent = byId.get(parentId);
    if (!parent) return null;
    const batch = findSepaBatchForTransaction(parent, sepaBatchesByReference);
    const op = batch?.operations?.find((o) => String(o.id) === String(opId));
    if (!op) return null;
    return buildSepaLineTransaction(parent, op);
  }

  return byId.get(id) || null;
}
