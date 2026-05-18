export const PROPOSAL_PROCESSING_STALE_MS = 3 * 60 * 1000;

function rowUpdatedAtMs(apiRow) {
  const raw = apiRow?.updatedAt;
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Job orphelin (serveur redémarré pendant un traitement). */
export function isProposalProcessingStuck(apiRow, maxAgeMs = PROPOSAL_PROCESSING_STALE_MS) {
  if (!apiRow || apiRow.processingStatus !== "processing") return false;
  const updated = rowUpdatedAtMs(apiRow);
  if (!updated) return true;
  return Date.now() - updated > maxAgeMs;
}

/**
 * Détermine si une proposition persistée contient du contenu affichable.
 */
export function proposalDataHasContent(proposalData) {
  if (!proposalData || typeof proposalData !== "object") return false;
  const suggestions = Array.isArray(proposalData.suggestions) ? proposalData.suggestions : [];
  const combinations = Array.isArray(proposalData.combinations)
    ? proposalData.combinations
    : [];
  const missingInvoices = Array.isArray(proposalData.missingInvoices)
    ? proposalData.missingInvoices
    : [];
  return suggestions.length > 0 || combinations.length > 0 || missingInvoices.length > 0;
}

/**
 * True si le cache peut être réutilisé (hash + moteur + contenu ou vide volontaire).
 */
export function isStoredProposalCacheHit(existing, { sourceHash, engineVersion } = {}) {
  if (!existing || existing.processingStatus !== "processed") return false;
  if (sourceHash && String(existing.sourceHash || "") !== String(sourceHash)) {
    return false;
  }
  if (engineVersion) {
    const rowEngine =
      String(existing.engineVersion || existing.proposalData?.engineVersion || "");
    if (rowEngine && rowEngine !== String(engineVersion)) return false;
    const scoring = String(existing.proposalData?.scoring || existing.scoring || "");
    if (scoring.includes("local") && !scoring.includes("supplier-gate")) return false;
  }
  return proposalDataHasContent(existing.proposalData);
}

/**
 * Proposition persistée avec un ancien moteur (ex. reco-v4 + combinaisons locales).
 */
export function isProposalScopeStale(apiRow, engineVersion = "") {
  if (!apiRow) return false;
  const rowEngine = String(apiRow.engineVersion || "");
  const rowScoring = String(apiRow.scoring || "");
  if (rowScoring.includes("local") && !rowScoring.includes("supplier-gate")) {
    return true;
  }
  if (engineVersion && rowEngine && rowEngine !== String(engineVersion)) {
    return true;
  }
  return false;
}

/**
 * True si un GET /proposals ne doit pas re-enfiler ce scope (moteur actuel, contenu valide).
 */
export function isProposalScopeSatisfied(apiRow, engineVersion = "") {
  if (!apiRow) return false;
  if (isProposalScopeStale(apiRow, engineVersion)) return false;
  if (apiRow.processingStatus === "processing") {
    return !isProposalProcessingStuck(apiRow);
  }
  if (apiRow.processingStatus !== "processed") return false;
  if (engineVersion && String(apiRow.engineVersion || "") !== String(engineVersion)) {
    return false;
  }
  if (String(apiRow.scoring || "") === "ai-empty") return true;
  if (String(apiRow.scoring || "").startsWith("sepa-reference")) return true;
  if (String(apiRow.scoring || "") === "ai-missing-invoice") return true;
  const suggestions = Array.isArray(apiRow.suggestions) ? apiRow.suggestions : [];
  const combinations = Array.isArray(apiRow.combinations) ? apiRow.combinations : [];
  const missingInvoices = Array.isArray(apiRow.missingInvoices) ? apiRow.missingInvoices : [];
  return suggestions.length > 0 || combinations.length > 0 || missingInvoices.length > 0;
}
