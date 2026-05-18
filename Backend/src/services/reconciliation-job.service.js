import { ReconciliationJob } from "../models/ReconciliationJob.js";
import {
  findProposalByScope,
  markScopeProcessing,
  upsertScopeProposal,
} from "./reconciliation-proposal.store.js";
import { buildReconciliationSourceHash } from "./reconciliation-hash.service.js";
import { ReconciliationProposal } from "../models/ReconciliationProposal.js";
import {
  isProposalProcessingStuck,
  isProposalScopeStale,
  isStoredProposalCacheHit,
  PROPOSAL_PROCESSING_STALE_MS,
  proposalDataHasContent,
} from "./reconciliation-proposal-content.js";
import { RECONCILIATION_ENGINE_VERSION } from "./reconciliation-engine.service.js";
import { buildCandidateInvoicesForTransaction } from "./reconciliation-candidates.service.js";
import { computeReconciliationForTransaction } from "./reconciliation-engine.service.js";
import {
  computeEngineReconciliationForTransaction,
  mergeAiSuggestionsIfCoherent,
} from "./reconciliation-engine-deterministic.service.js";
import { listAllInvoicesForReconciliation } from "./reconciliation-invoices.service.js";
import {
  findImpactedBankTransactions,
  isTransactionLockedForAutoRecalc,
} from "./reconciliation-impact.service.js";
import { broadcastReconciliationEvent } from "./reconciliation-sse.service.js";
import {
  buildReconciliationScopeContext,
  resolveScopeToTransaction,
} from "./reconciliation-sepa-scope.service.js";

const pendingQueue = [];
let processing = false;
const MAX_ATTEMPTS = 3;

function scopeTypeForTransaction(transaction = {}) {
  const id = String(transaction?.id || "");
  if (id.includes("::")) return "sepa_line";
  return "bank_transaction";
}

export async function enqueueBankTransactionReconciliation(transaction, options = {}) {
  const scopeType = scopeTypeForTransaction(transaction);
  const scopeId = String(transaction?.id || "");
  if (!scopeId) return null;

  const invoices = options.invoices || (await listAllInvoicesForReconciliation());
  if (isTransactionLockedForAutoRecalc(transaction) && !options.force) {
    return { skipped: true, reason: "reconciled_locked", scopeId: String(transaction?.id || "") };
  }

  const candidateInvoices = buildCandidateInvoicesForTransaction(transaction, invoices);
  const sourceHash = buildReconciliationSourceHash(
    transaction,
    candidateInvoices,
    RECONCILIATION_ENGINE_VERSION
  );

  const existing = await findProposalByScope(scopeType, scopeId);
  const processingStuck =
    existing?.processingStatus === "processing" &&
    isProposalProcessingStuck({
      processingStatus: existing.processingStatus,
      updatedAt: existing.updatedAt,
    });

  if (!options.force && !processingStuck) {
    if (
      isStoredProposalCacheHit(existing, {
        sourceHash,
        engineVersion: RECONCILIATION_ENGINE_VERSION,
      })
    ) {
      return { skipped: true, reason: "cache_hit", scopeId, proposal: existing };
    }
    if (existing?.processingStatus === "processing") {
      return { skipped: true, reason: "already_processing", scopeId };
    }
  }

  await markScopeProcessing(scopeType, scopeId, sourceHash);

  const job = await ReconciliationJob.create({
    entityType: "bank_transaction",
    entityId: scopeId,
    scopeId,
    payload: { transaction, force: Boolean(options.force) },
    sourceHash,
    status: "not_processed",
  });

  pendingQueue.push({
    jobId: job._id.toString(),
    scopeType,
    scopeId,
    transaction,
    invoices,
    sourceHash,
    force: Boolean(options.force),
  });
  void drainQueue();
  return { enqueued: true, jobId: job._id.toString(), scopeId };
}

export async function enqueueInvoiceReconciliation(invoiceId) {
  const invoices = await listAllInvoicesForReconciliation();
  const target = invoices.find((inv) => String(inv.id) === String(invoiceId));
  if (!target) return { enqueued: 0, impacted: 0, invoiceId: String(invoiceId) };

  const impacted = await findImpactedBankTransactions(target, {
    allInvoices: invoices,
  });

  let enqueued = 0;
  let skipped = 0;

  for (const txn of impacted) {
    const result = await enqueueBankTransactionReconciliation(txn, {
      invoices,
      force: false,
    });
    if (result?.enqueued) enqueued += 1;
    else skipped += 1;
  }

  return {
    enqueued,
    skipped,
    impacted: impacted.length,
    invoiceId: String(invoiceId),
    impactedTransactionIds: impacted.map((t) => t.id),
  };
}

async function drainQueue() {
  if (processing) return;
  processing = true;
  while (pendingQueue.length > 0) {
    const item = pendingQueue.shift();
    await processQueueItem(item);
  }
  processing = false;
}

async function processQueueItem(item) {
  const { jobId, scopeType, scopeId, transaction, invoices, sourceHash } = item;
  try {
    await ReconciliationJob.findByIdAndUpdate(jobId, {
      $set: { status: "processing", attempts: 1 },
    });

    const engineComputed = computeEngineReconciliationForTransaction(transaction, invoices);
    let computed = engineComputed;

    const openAiReady =
      process.env.OPENAI_ENABLED === "true" && Boolean(process.env.OPENAI_API_KEY);

    if (openAiReady) {
      try {
        const aiComputed = await computeReconciliationForTransaction(transaction, invoices);
        const invoiceLookup = new Map(
          invoices
            .map((inv) => [String(inv?.id || inv?._id || ""), inv])
            .filter(([id]) => id)
        );
        const mergedSuggestions = mergeAiSuggestionsIfCoherent(
          transaction,
          engineComputed.suggestions || [],
          aiComputed.suggestions || [],
          invoiceLookup
        );
        const scoring =
          mergedSuggestions.length > (engineComputed.suggestions || []).length
            ? "engine+ai"
            : engineComputed.scoring;
        computed = {
          ...aiComputed,
          suggestions: mergedSuggestions,
          scoring,
          topScore: Number(mergedSuggestions[0]?.score || engineComputed.topScore || 0),
          topExplanation: String(
            mergedSuggestions[0]?.reason || engineComputed.topExplanation || ""
          ),
          proposalData: {
            ...aiComputed.proposalData,
            suggestions: mergedSuggestions,
            scoring,
            engineVersion: engineComputed.engineVersion,
          },
        };
      } catch (aiError) {
        console.warn(
          "[reconciliation] IA indisponible, moteur déterministe seul:",
          aiError?.message || aiError
        );
      }
    }

    const saved = await upsertScopeProposal({
      scopeType,
      scopeId,
      bankTransactionId: scopeId,
      sourceHash: computed.sourceHash || sourceHash,
      processingStatus: "processed",
      proposalData: computed.proposalData,
      score: computed.topScore,
      explanation: computed.topExplanation,
      scoring: computed.scoring,
      engineVersion: computed.engineVersion,
    });

    await ReconciliationJob.findByIdAndUpdate(jobId, { $set: { status: "processed", error: null } });

    const parentTxnId = scopeId.includes("::") ? scopeId.split("::")[0] : scopeId;

    broadcastReconciliationEvent({
      type: "RECONCILIATION_PROCESSED",
      entity_type: scopeType === "sepa_line" ? "sepa_line" : "bank_transaction",
      entity_id: scopeId,
      bank_transaction_id: scopeId,
      parent_bank_transaction_id: parentTxnId,
      processing_status: "processed",
      proposals: saved?.proposalData || computed.proposalData,
      source_hash: saved?.sourceHash || sourceHash,
    });
  } catch (error) {
    const message = String(error?.message || error);
    await ReconciliationJob.findByIdAndUpdate(jobId, {
      $set: { status: "failed", error: message },
    });
    await upsertScopeProposal({
      scopeType,
      scopeId,
      bankTransactionId: scopeId,
      sourceHash,
      processingStatus: "failed",
      processingError: message,
      proposalData: null,
      score: 0,
      explanation: "",
    });
    const parentTxnId = scopeId.includes("::") ? scopeId.split("::")[0] : scopeId;

    broadcastReconciliationEvent({
      type: "RECONCILIATION_FAILED",
      entity_type: scopeType === "sepa_line" ? "sepa_line" : "bank_transaction",
      entity_id: scopeId,
      bank_transaction_id: scopeId,
      parent_bank_transaction_id: parentTxnId,
      processing_status: "failed",
      error: message,
    });
  }
}

/**
 * Planifie les jobs manquants pour des opérations visibles (sans OpenAI synchrone).
 * Utilisé au GET /proposals quand la base est vide (ex. après migration).
 */
export async function ensureProposalsQueuedForBankTransactionIds(
  transactionIds = [],
  options = {}
) {
  const ids = Array.from(new Set(transactionIds.map((x) => String(x)).filter(Boolean)));
  if (!ids.length) return { enqueued: 0, skipped: 0, missing: 0, stale: 0 };

  const ctx = await buildReconciliationScopeContext();
  const invoices = await listAllInvoicesForReconciliation();

  let enqueued = 0;
  let skipped = 0;
  let missing = 0;
  let staleRecalc = 0;

  for (const id of ids.slice(0, 50)) {
    const txn = resolveScopeToTransaction(id, ctx);
    if (!txn) {
      missing += 1;
      continue;
    }
    const scopeType = scopeTypeForTransaction(txn);
    const existing = await findProposalByScope(scopeType, id);
    const apiRow = existing
      ? {
          engineVersion: existing.engineVersion || existing.proposalData?.engineVersion,
          scoring: existing.proposalData?.scoring || existing.scoring,
          processingStatus: existing.processingStatus,
        }
      : null;
    const scopeStale = isProposalScopeStale(apiRow, RECONCILIATION_ENGINE_VERSION);
    const rowScoring = String(
      existing?.proposalData?.scoring || existing?.scoring || ""
    );
    const emptyProcessed =
      existing?.processingStatus === "processed" &&
      !proposalDataHasContent(existing?.proposalData) &&
      rowScoring !== "ai-empty";
    const processingStuck =
      existing?.processingStatus === "processing" &&
      isProposalProcessingStuck({
        processingStatus: existing.processingStatus,
        updatedAt: existing.updatedAt,
      });
    const forceRecalc =
      Boolean(options.forceRecalc) || scopeStale || processingStuck || emptyProcessed;
    if (scopeStale || processingStuck) staleRecalc += 1;

    const result = await enqueueBankTransactionReconciliation(txn, {
      invoices,
      force: forceRecalc,
    });
    if (result?.enqueued) enqueued += 1;
    else skipped += 1;
  }

  return { enqueued, skipped, missing, stale: staleRecalc };
}

export async function enqueueManyBankTransactions(transactions = [], options = {}) {
  const invoices = options.invoices || (await listAllInvoicesForReconciliation());
  let enqueued = 0;
  let skipped = 0;
  for (const txn of transactions) {
    if (isTransactionLockedForAutoRecalc(txn) && !options.force) {
      skipped += 1;
      continue;
    }
    const result = await enqueueBankTransactionReconciliation(txn, {
      invoices,
      force: Boolean(options.force),
    });
    if (result?.enqueued) enqueued += 1;
    else skipped += 1;
  }
  return { enqueued, skipped };
}

/**
 * Relance les scopes bloqués en « processing » (file mémoire perdue au redémarrage).
 */
export async function recoverStuckReconciliationJobs(options = {}) {
  const maxAgeMs = Number(options.maxAgeMs) || PROPOSAL_PROCESSING_STALE_MS;
  const limit = Number(options.limit) || 40;
  const cutoff = new Date(Date.now() - maxAgeMs);

  const stuckRows = await ReconciliationProposal.find({
    processingStatus: "processing",
    updatedAt: { $lt: cutoff },
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  if (!stuckRows.length) {
    return { recovered: 0, enqueued: 0, skipped: 0 };
  }

  const ctx = await buildReconciliationScopeContext();
  const invoices = await listAllInvoicesForReconciliation();
  let enqueued = 0;
  let skipped = 0;

  for (const row of stuckRows) {
    const scopeId = String(row.scopeId || row.bankTransactionId || "");
    if (!scopeId) continue;
    const txn = resolveScopeToTransaction(scopeId, ctx);
    if (!txn) {
      skipped += 1;
      continue;
    }
    const result = await enqueueBankTransactionReconciliation(txn, {
      invoices,
      force: true,
    });
    if (result?.enqueued) enqueued += 1;
    else skipped += 1;
  }

  return { recovered: stuckRows.length, enqueued, skipped };
}
