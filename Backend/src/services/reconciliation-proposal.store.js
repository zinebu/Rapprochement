import { ReconciliationProposal } from "../models/ReconciliationProposal.js";

export async function findProposalByScope(scopeType, scopeId) {
  return ReconciliationProposal.findOne({ scopeType, scopeId }).lean();
}

export async function findProposalsByScopeIds(scopeType, scopeIds = []) {
  const ids = Array.from(new Set(scopeIds.map((x) => String(x)).filter(Boolean)));
  if (!ids.length) return [];
  return ReconciliationProposal.find({ scopeType, scopeId: { $in: ids } }).lean();
}

export async function findProposalsByBankTransactionIds(bankTransactionIds = []) {
  const ids = Array.from(new Set(bankTransactionIds.map((x) => String(x)).filter(Boolean)));
  if (!ids.length) return [];
  return ReconciliationProposal.find({
    $or: [{ bankTransactionId: { $in: ids } }, { scopeId: { $in: ids } }],
  }).lean();
}

export async function upsertScopeProposal({
  scopeType,
  scopeId,
  bankTransactionId,
  sourceHash,
  processingStatus,
  processingError,
  proposalData,
  score,
  explanation,
  scoring,
  engineVersion,
  status = "pending",
}) {
  return ReconciliationProposal.findOneAndUpdate(
    { scopeType, scopeId },
    {
      $set: {
        scopeType,
        scopeId,
        bankTransactionId: bankTransactionId || scopeId,
        invoiceId: null,
        sourceHash,
        processingStatus,
        processingError: processingError || null,
        proposalData,
        score: Number(score || 0),
        explanation: String(explanation || ""),
        status,
        scoring: scoring || null,
        engineVersion: engineVersion || null,
      },
    },
    { upsert: true, new: true }
  ).lean();
}

export async function markScopeProcessing(scopeType, scopeId, sourceHash) {
  return upsertScopeProposal({
    scopeType,
    scopeId,
    bankTransactionId: scopeId,
    sourceHash,
    processingStatus: "processing",
    proposalData: null,
    score: 0,
    explanation: "",
    scoring: null,
    engineVersion: null,
  });
}

export async function findProposalsReferencingInvoiceId(invoiceId) {
  const id = String(invoiceId || "");
  if (!id) return [];
  return ReconciliationProposal.find({
    $or: [
      { "proposalData.suggestions.invoiceId": id },
      { "proposalData.combinations.invoiceIds": id },
    ],
  }).lean();
}

export async function deleteProposalsForScopeIds(scopeType, scopeIds = []) {
  const ids = Array.from(new Set(scopeIds.map((x) => String(x)).filter(Boolean)));
  if (!ids.length) return { deletedCount: 0 };
  const result = await ReconciliationProposal.deleteMany({ scopeType, scopeId: { $in: ids } });
  return { deletedCount: result.deletedCount || 0 };
}
