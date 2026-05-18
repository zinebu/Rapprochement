import { buildCandidateInvoicesForTransaction } from "./reconciliation-candidates.service.js";
import { buildReconciliationSourceHash } from "./reconciliation-hash.service.js";
import { RECONCILIATION_ENGINE_VERSION } from "./reconciliation-engine.service.js";
import { buildDeterministicStrictMatches } from "./reconciliation-proposal-guards.js";
import {
  buildLocalSuggestion,
  invoiceId,
  supplierAmountDateMatch,
  transactionMatchesInvoice,
  invoiceReferenceMatchesTransaction,
  amountMatchesTransaction,
  amountCoherentWithTransaction,
  supplierNameMatch,
  extractTransactionCounterparty,
} from "./reconciliation-scoring.service.js";

const ENGINE_MIN_SCORE = 35;

function invoiceRowSummary(inv) {
  return {
    id: invoiceId(inv),
    invoiceNumber: inv?.invoiceNumber || "",
    vendorCustomer: inv?.vendorCustomer || "",
    amountGross: Number(inv?.amountGross || 0),
  };
}

function engineSuggestionAccepted(transaction, inv) {
  if (!amountCoherentWithTransaction(transaction, inv)) return false;
  if (supplierAmountDateMatch(transaction, inv)) return true;
  if (!amountMatchesTransaction(transaction, inv)) return false;
  const counterparty = extractTransactionCounterparty(transaction);
  if (supplierNameMatch(counterparty, inv?.vendorCustomer || "")) return true;
  if (transactionMatchesInvoice(transaction, inv)) return true;
  if (invoiceReferenceMatchesTransaction(transaction, inv)) return true;
  return false;
}

/**
 * Rapprochement synchrone sans OpenAI : montant, dates, références, sens achat/vente.
 * L'IA peut compléter via la file async si OPENAI_ENABLED.
 */
export function computeEngineReconciliationForTransaction(transaction, allInvoices = []) {
  const candidates = buildCandidateInvoicesForTransaction(transaction, allInvoices);
  const strict = buildDeterministicStrictMatches(transaction, candidates);
  const seen = new Set(
    (strict.suggestions || []).map((s) => String(s.invoiceId || "")).filter(Boolean)
  );

  const ranked = [];
  for (const inv of candidates) {
    const id = invoiceId(inv);
    if (!id || seen.has(id)) continue;

    const local = buildLocalSuggestion(transaction, inv);
    if (local.score < ENGINE_MIN_SCORE) continue;
    if (!engineSuggestionAccepted(transaction, inv)) continue;

    ranked.push({
      invoiceId: id,
      score: local.score,
      reason: local.reason,
      signals: local.signals,
      matchTier: supplierAmountDateMatch(transaction, inv) ? "strong" : "engine",
      scoring: "engine-deterministic",
      invoice: invoiceRowSummary(inv),
    });
    seen.add(id);
  }

  const suggestions = [...(strict.suggestions || []), ...ranked]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 8);

  const sourceHash = buildReconciliationSourceHash(
    transaction,
    candidates,
    RECONCILIATION_ENGINE_VERSION
  );

  const top = suggestions[0] || null;

  return {
    success: true,
    sourceHash,
    suggestions,
    combinations: [],
    missingInvoices: [],
    scoring: "engine-deterministic",
    engineVersion: RECONCILIATION_ENGINE_VERSION,
    processingStatus: "processed",
    topScore: Number(top?.score || 0),
    topExplanation: String(top?.reason || ""),
    proposalData: {
      suggestions,
      combinations: [],
      missingInvoices: [],
      scoring: "engine-deterministic",
      engineVersion: RECONCILIATION_ENGINE_VERSION,
    },
  };
}

/** Fusionne les suggestions IA en ne gardant que les lignes cohérentes avec le moteur. */
export function mergeAiSuggestionsIfCoherent(
  transaction,
  engineSuggestions = [],
  aiSuggestions = [],
  invoiceLookup = new Map()
) {
  const seen = new Set(engineSuggestions.map((s) => String(s.invoiceId || "")));
  const merged = [...engineSuggestions];

  for (const row of aiSuggestions || []) {
    const id = String(row.invoiceId || row.invoice?.id || "");
    if (!id || seen.has(id)) continue;
    const inv = row.invoice || invoiceLookup.get(id);
    if (!inv) continue;
    const local = buildLocalSuggestion(transaction, inv);
    if (!engineSuggestionAccepted(transaction, inv)) continue;
    merged.push({
      ...row,
      score: Math.min(Number(row.score || local.score), local.score + 8),
      reason: row.reason || local.reason,
      signals: [...new Set([...(row.signals || []), ...local.signals, "Complément IA validé"])],
      matchTier: row.matchTier || "ai-supplement",
      scoring: "engine+ai",
    });
    seen.add(id);
  }

  return merged.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 8);
}
