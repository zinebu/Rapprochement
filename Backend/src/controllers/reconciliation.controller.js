import { scoreSepaReconciliationWithAgent } from "../services/openai-agents.service.js";
import { computeReconciliationForTransaction } from "../services/reconciliation-engine.service.js";
import { computeEngineReconciliationForTransaction } from "../services/reconciliation-engine-deterministic.service.js";
import {
  findProposalByScope,
  findProposalsByBankTransactionIds,
  upsertScopeProposal,
} from "../services/reconciliation-proposal.store.js";
import { buildReconciliationSourceHash } from "../services/reconciliation-hash.service.js";
import {
  isProposalProcessingStuck,
  isProposalScopeSatisfied,
  isProposalScopeStale,
  isStoredProposalCacheHit,
} from "../services/reconciliation-proposal-content.js";
import { RECONCILIATION_ENGINE_VERSION } from "../services/reconciliation-engine.service.js";
import { buildCandidateInvoicesForTransaction } from "../services/reconciliation-candidates.service.js";
import {
  enqueueBankTransactionReconciliation,
  enqueueInvoiceReconciliation,
  ensureProposalsQueuedForBankTransactionIds,
} from "../services/reconciliation-job.service.js";
import {
  listAllInvoicesForReconciliation,
  listOpenInvoices,
} from "../services/reconciliation-invoices.service.js";
import { registerSseClient } from "../services/reconciliation-sse.service.js";
import {
  listPurchaseInvoices as listPurchaseInvoicesFromStore,
  updatePurchaseInvoicesStatusByIds,
} from "../modules/invoices/purchase.store.js";
import {
  listSalesInvoices as listSalesInvoicesFromStore,
  updateSalesInvoicesStatusByIds,
} from "../modules/invoices/sales.store.js";

function scopeTypeForTransaction(transaction = {}) {
  const id = String(transaction?.id || "");
  if (id.includes("::")) return "sepa_line";
  return "bank_transaction";
}

function proposalToApiResponse(row) {
  if (!row) return null;
  const data = row.proposalData || {};
  return {
    scopeId: row.scopeId,
    bankTransactionId: row.bankTransactionId || row.scopeId,
    processingStatus: row.processingStatus,
    processingError: row.processingError || null,
    sourceHash: row.sourceHash,
    status: row.status,
    score: row.score,
    explanation: row.explanation,
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    combinations: Array.isArray(data.combinations) ? data.combinations : [],
    missingInvoices: Array.isArray(data.missingInvoices) ? data.missingInvoices : [],
    scoring: data.scoring || row.scoring || null,
    engineVersion: data.engineVersion || row.engineVersion || null,
    updatedAt: row.updatedAt,
  };
}

/**
 * GET /api/reconciliation/proposals?bankTransactionIds=a,b,c
 * Lecture DB immédiate. Si ensure=1 (défaut), planifie en arrière-plan les jobs manquants
 * (pas d'OpenAI dans la réponse HTTP).
 */
export async function getReconciliationProposals(req, res) {
  try {
    const raw = String(req.query.bankTransactionIds || req.query.ids || "");
    const ids = raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const rows = await findProposalsByBankTransactionIds(ids);
    const byId = Object.fromEntries(
      rows.map((row) => {
        const apiRow = proposalToApiResponse(row);
        const key = String(row.scopeId || row.bankTransactionId);
        if (
          isProposalScopeStale(apiRow, RECONCILIATION_ENGINE_VERSION) ||
          isProposalProcessingStuck(apiRow)
        ) {
          return [
            key,
            {
              ...apiRow,
              processingStatus: "processing",
              suggestions: [],
              combinations: [],
              stale: true,
            },
          ];
        }
        return [key, apiRow];
      })
    );

    const shouldEnsure = String(req.query.ensure ?? "1") !== "0";
    let ensureMeta = null;
    if (shouldEnsure && ids.length) {
      const missingIds = ids.filter((id) => {
        const dbRow = rows.find(
          (r) => String(r.scopeId || r.bankTransactionId) === String(id)
        );
        const apiRow = dbRow ? proposalToApiResponse(dbRow) : null;
        if (!apiRow) return true;
        if (isProposalScopeStale(apiRow, RECONCILIATION_ENGINE_VERSION)) return true;
        if (apiRow.processingStatus === "processing") {
          return isProposalProcessingStuck(apiRow);
        }
        if (isProposalScopeSatisfied(apiRow, RECONCILIATION_ENGINE_VERSION)) return false;
        if (apiRow.processingStatus === "processed") {
          return String(apiRow.engineVersion || "") !== RECONCILIATION_ENGINE_VERSION;
        }
        return (
          apiRow.processingStatus === "not_processed" || apiRow.processingStatus === "failed"
        );
      });
      if (missingIds.length) {
        ensureMeta = await ensureProposalsQueuedForBankTransactionIds(missingIds, {
          forceRecalc: false,
        });
      }
    }

    return res.json({
      success: true,
      proposals: byId,
      items: rows.map(proposalToApiResponse).filter(Boolean),
      ensure: ensureMeta,
    });
  } catch (error) {
    console.error("getReconciliationProposals error:", error);
    return res.status(500).json({
      error: "Erreur lecture propositions",
      details: String(error),
    });
  }
}

/**
 * GET /api/reconciliation/events — SSE
 */
export function streamReconciliationEvents(req, res) {
  registerSseClient(res);
}

/**
 * POST /api/reconciliation/engine-match
 * Moteur serveur synchrone (montant, dates, références, sens) — sans OpenAI.
 */
export async function engineMatchReconciliation(req, res) {
  try {
    const { transaction, invoices: bodyInvoices } = req.body || {};
    if (!transaction?.id) {
      return res.status(400).json({ error: "transaction.id requis" });
    }
    const allInvoices =
      Array.isArray(bodyInvoices) && bodyInvoices.length > 0
        ? bodyInvoices
        : await listAllInvoicesForReconciliation();
    const result = computeEngineReconciliationForTransaction(transaction, allInvoices);
    return res.json({
      success: true,
      cached: false,
      processingStatus: "processed",
      ...result,
    });
  } catch (error) {
    console.error("engineMatchReconciliation error:", error);
    return res.status(500).json({
      error: "Erreur moteur rapprochement",
      details: String(error),
    });
  }
}

/**
 * POST /api/reconciliation/recalculate
 * Recalcul explicite pour une opération (job async).
 */
export async function recalculateReconciliation(req, res) {
  try {
    const { transaction, invoices: bodyInvoices } = req.body || {};
    if (!transaction?.id) {
      return res.status(400).json({ error: "transaction.id requis" });
    }
    const allInvoices =
      Array.isArray(bodyInvoices) && bodyInvoices.length > 0
        ? bodyInvoices
        : await listAllInvoicesForReconciliation();

    const result = await enqueueBankTransactionReconciliation(transaction, {
      invoices: allInvoices,
      force: true,
    });

    return res.json({
      success: true,
      message: "Recalcul planifié",
      ...result,
      processingStatus: "processing",
    });
  } catch (error) {
    console.error("recalculateReconciliation error:", error);
    return res.status(500).json({
      error: "Erreur recalcul",
      details: String(error),
    });
  }
}

/**
 * POST /api/reconciliation/score
 * Ne lance plus OpenAI de façon synchrone au chargement de page.
 * - Retourne le cache si source_hash identique.
 * - Sinon enqueue un job et répond processing (sauf ?sync=true pour debug).
 */
export async function scoreReconciliation(req, res) {
  try {
    const { transaction, invoices: bodyInvoices, force } = req.body || {};
    if (!transaction || !Array.isArray(bodyInvoices)) {
      return res.status(400).json({ error: "transaction et invoices requis" });
    }

    const scopeType = scopeTypeForTransaction(transaction);
    const scopeId = String(transaction.id);
    const allInvoices =
      Array.isArray(bodyInvoices) && bodyInvoices.length > 0
        ? bodyInvoices
        : await listAllInvoicesForReconciliation();
    const openInvoices = listOpenInvoices(allInvoices);
    const candidates = buildCandidateInvoicesForTransaction(transaction, allInvoices);
    const sourceHash = buildReconciliationSourceHash(
      transaction,
      candidates,
      RECONCILIATION_ENGINE_VERSION
    );

    const existing = await findProposalByScope(scopeType, scopeId);
    const cacheValid =
      !force &&
      isStoredProposalCacheHit(existing, {
        sourceHash,
        engineVersion: RECONCILIATION_ENGINE_VERSION,
      });

    if (cacheValid) {
      const cached = proposalToApiResponse(existing);
      return res.json({
        success: true,
        cached: true,
        processingStatus: "processed",
        ...cached,
      });
    }

    if (existing?.processingStatus === "processing" && !force) {
      return res.json({
        success: true,
        cached: false,
        processingStatus: "processing",
        scopeId,
        suggestions: [],
        combinations: [],
      });
    }

    const sync = String(req.query.sync || "") === "true" || Boolean(req.body?.sync);
    if (sync && force) {
      const computed = await computeReconciliationForTransaction(transaction, openInvoices);
      await upsertScopeProposal({
        scopeType,
        scopeId,
        bankTransactionId: scopeId,
        sourceHash: computed.sourceHash,
        processingStatus: "processed",
        proposalData: computed.proposalData,
        score: computed.topScore,
        explanation: computed.topExplanation,
        scoring: computed.scoring,
        engineVersion: computed.engineVersion,
      });
      return res.json({
        success: true,
        cached: false,
        processingStatus: "processed",
        ...computed,
      });
    }

    await enqueueBankTransactionReconciliation(transaction, {
      invoices: allInvoices,
      force: Boolean(force),
    });

    return res.json({
      success: true,
      cached: false,
      processingStatus: "processing",
      scopeId,
      sourceHash,
      suggestions: [],
      combinations: [],
      message: "Calcul IA en file d'attente. Les propositions seront poussées via SSE.",
    });
  } catch (error) {
    console.error("scoreReconciliation error:", error);
    return res.status(500).json({
      error: "Erreur scoring rapprochement",
      details: String(error),
    });
  }
}

export async function scoreSepaReconciliation(req, res) {
  try {
    const { sepaBatch, invoices } = req.body || {};
    if (!sepaBatch || !Array.isArray(invoices)) {
      return res.status(400).json({ error: "sepaBatch et invoices requis" });
    }
    const ai = await scoreSepaReconciliationWithAgent({ sepaBatch, invoices });
    if (!ai) {
      return res.status(503).json({
        error: "Agent IA indisponible pour le rapprochement SEPA",
      });
    }
    return res.json({ success: true, ...ai, scoring: "ai-only" });
  } catch (error) {
    console.error("scoreSepaReconciliation error:", error);
    return res.status(500).json({
      error: "Erreur scoring rapprochement SEPA",
      details: String(error),
    });
  }
}

export async function runGlobalReconciliation(req, res) {
  return res.status(410).json({
    error: "Endpoint déprécié. Utiliser GET /reconciliation/proposals et POST /reconciliation/recalculate.",
  });
}

export async function syncReconciliationInvoiceStatus(req, res) {
  try {
    const { toReconciled = [], toUnreconciled = [] } = req.body || {};

    const recIds = Array.isArray(toReconciled)
      ? Array.from(new Set(toReconciled.map((x) => String(x)).filter(Boolean)))
      : [];
    const unrecIds = Array.isArray(toUnreconciled)
      ? Array.from(new Set(toUnreconciled.map((x) => String(x)).filter(Boolean)))
      : [];

    const purchaseRows = await listPurchaseInvoicesFromStore();
    const salesRows = await listSalesInvoicesFromStore();
    const purchaseIdSet = new Set(
      purchaseRows.flatMap((inv) => [String(inv?._id || ""), String(inv?.id || "")]).filter(Boolean)
    );
    const salesIdSet = new Set(
      salesRows.flatMap((inv) => [String(inv?._id || ""), String(inv?.id || "")]).filter(Boolean)
    );

    const recPurchaseIds = recIds.filter((id) => purchaseIdSet.has(id));
    const recSalesIds = recIds.filter((id) => salesIdSet.has(id));
    const unrecPurchaseIds = unrecIds.filter((id) => purchaseIdSet.has(id));
    const unrecSalesIds = unrecIds.filter((id) => salesIdSet.has(id));

    const recPurchase = await updatePurchaseInvoicesStatusByIds(recPurchaseIds, "rapprochée");
    const recSales = await updateSalesInvoicesStatusByIds(recSalesIds, "rapprochée");
    const unrecPurchase = await updatePurchaseInvoicesStatusByIds(unrecPurchaseIds, "non_rapprochée");
    const unrecSales = await updateSalesInvoicesStatusByIds(unrecSalesIds, "non_rapprochée");

    return res.json({
      success: true,
      message: "Statuts factures synchronisés",
      stats: {
        input: {
          toReconciled: recIds.length,
          toUnreconciled: unrecIds.length,
        },
        reconciled: { purchase: recPurchase, sales: recSales },
        unreconciled: { purchase: unrecPurchase, sales: unrecSales },
      },
    });
  } catch (error) {
    console.error("syncReconciliationInvoiceStatus error:", error);
    return res.status(500).json({
      error: "Erreur synchronisation statuts factures",
      details: String(error),
    });
  }
}

/** Appelé après création / modification facture */
export async function triggerInvoiceReconciliationJobs(invoiceId) {
  try {
    return await enqueueInvoiceReconciliation(invoiceId);
  } catch (error) {
    console.warn("triggerInvoiceReconciliationJobs:", error?.message || error);
    return { enqueued: 0 };
  }
}
