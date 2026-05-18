import type { StoredReconciliationProposal } from "./reconciliation-proposals-api";
import type { SepaOperationDecision } from "./types";

export type TxnReconciliationBadgeStatus = "rapproché" | "partiel" | "non_rapproché";

export type SepaMissingInvoice = {
  invoiceReference?: string | null;
  creditorName?: string | null;
  amount?: number;
  currency?: string;
  reason?: string;
  hint?: string;
};

export type ProposalPayload = {
  suggestions: unknown[];
  combinations: unknown[];
  missingInvoices?: SepaMissingInvoice[];
  scoring?: string;
  engineVersion?: string;
  processingStatus?: string;
};

export function proposalPayloadFromRow(
  row: StoredReconciliationProposal | undefined
): ProposalPayload | null {
  if (!row) return null;
  return {
    suggestions: row.suggestions || [],
    combinations: row.combinations || [],
    missingInvoices: row.missingInvoices || [],
    scoring: row.scoring || "",
    engineVersion: row.engineVersion || "",
    processingStatus: row.processingStatus,
  };
}

export function filterCombinationsWithExistingInvoices<T extends { invoiceIds?: string[] }>(
  combos: T[],
  existingInvoiceIds: Set<string>
): T[] {
  return (combos || []).filter(
    (c) =>
      Array.isArray(c.invoiceIds) &&
      c.invoiceIds.length > 0 &&
      c.invoiceIds.every((id) => existingInvoiceIds.has(String(id)))
  );
}

export type ComboInvoiceRef = {
  id: string;
  invoiceNumber?: string;
  vendorCustomer?: string;
  amountGross?: number;
};

/** Garde les combinaisons dont toutes les factures existent encore, avec libellés pour l'UI. */
export function filterAndHydrateCombinations<
  T extends {
    invoiceIds?: string[];
    invoices?: ComboInvoiceRef[];
    totalAmount?: number;
    diff?: number;
    score?: number;
    reason?: string;
    matchType?: string;
  },
>(
  combos: T[],
  resolveInvoice: (id: string) => ComboInvoiceRef | undefined
): Array<T & { invoiceIds: string[]; invoices: ComboInvoiceRef[] }> {
  const out: Array<T & { invoiceIds: string[]; invoices: ComboInvoiceRef[] }> = [];
  for (const c of combos || []) {
    const ids = (c.invoiceIds || []).map((id) => String(id)).filter(Boolean);
    if (!ids.length) continue;
    const invoices: ComboInvoiceRef[] = [];
    let ok = true;
    for (const id of ids) {
      const resolved = resolveInvoice(id);
      const embedded = (c.invoices || []).find((inv) => String(inv.id) === id);
      if (resolved) {
        invoices.push(
          embedded
            ? {
                id,
                invoiceNumber: embedded.invoiceNumber ?? resolved.invoiceNumber,
                vendorCustomer: embedded.vendorCustomer ?? resolved.vendorCustomer,
                amountGross: embedded.amountGross ?? resolved.amountGross,
              }
            : resolved
        );
      } else if (embedded?.invoiceNumber) {
        invoices.push({
          id,
          invoiceNumber: embedded.invoiceNumber,
          vendorCustomer: embedded.vendorCustomer ?? "",
          amountGross: Number(embedded.amountGross ?? 0),
        });
      } else {
        ok = false;
        break;
      }
    }
    if (!ok || invoices.length !== ids.length) continue;
    out.push({ ...c, invoiceIds: ids, invoices });
  }
  return out;
}

/** Scope IDs liés à une opération bancaire (lignes SEPA, lot batch::). */
/** Proposition persistée pour une ligne SEPA (scope exact ou suffixe d'ID). */
export function resolveStoredProposalForSepaLine(
  proposalsMap: Record<string, StoredReconciliationProposal | undefined>,
  parentTxnId: string,
  opId: string
): StoredReconciliationProposal | undefined {
  const parent = String(parentTxnId || "");
  const line = String(opId || "");
  if (!parent || !line) return undefined;

  const exact = `${parent}::${line}`;
  const direct = proposalsMap[exact];
  if (direct) return direct;

  const suffix = `::${line}`;
  const fuzzyKey = Object.keys(proposalsMap).find(
    (k) => k.startsWith(`${parent}::`) && k.endsWith(suffix)
  );
  if (fuzzyKey && proposalsMap[fuzzyKey]) return proposalsMap[fuzzyKey];

  return undefined;
}

/** Combinaisons API en priorité, sinon celles dérivées du payload (ex. fallback fournisseur). */
export function pickDisplayCombinations<T extends { invoiceIds?: string[] }>(
  payload: ProposalPayload | null,
  builtCombos: T[]
): T[] {
  const fromPayload = Array.isArray(payload?.combinations) ? payload.combinations : [];
  return (fromPayload.length > 0 ? fromPayload : builtCombos) as T[];
}

export function proposalScopeKeysForTxn(
  txnId: string,
  proposalsMap: Record<string, StoredReconciliationProposal | undefined>
): string[] {
  const id = String(txnId || "");
  if (!id) return [];
  return Object.keys(proposalsMap).filter(
    (k) => k === id || k.startsWith(`${id}::`) || k === `batch::${id}`
  );
}

/** True si la proposition persistée a au moins une combinaison ou suggestion affichable. */
export function hasVisibleStoredProposal(
  row: StoredReconciliationProposal | undefined,
  existingInvoiceIds: Set<string>
): boolean {
  if (!row || row.processingStatus !== "processed") return false;
  const payload = proposalPayloadFromRow(row);
  if (!payload) return false;

  const rawCombos = (payload.combinations || []) as {
    invoiceIds?: string[];
    invoices?: ComboInvoiceRef[];
  }[];
  for (const c of rawCombos) {
    const ids = (c.invoiceIds || []).map((id) => String(id)).filter(Boolean);
    if (!ids.length) continue;
    const allInList = ids.every((id) => existingInvoiceIds.has(id));
    const allEmbedded = ids.every((id) =>
      (c.invoices || []).some(
        (inv) => String(inv.id) === id && String(inv.invoiceNumber || "").length > 0
      )
    );
    if (allInList || allEmbedded) return true;
  }

  const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
  return suggestions.some((s) => {
    const invId = String(
      (s as { invoiceId?: string; invoice?: { id?: string } }).invoiceId ||
        (s as { invoice?: { id?: string } }).invoice?.id ||
        ""
    );
    return Boolean(invId && existingInvoiceIds.has(invId));
  });
}

export function countResolvableSuggestions(
  payload: ProposalPayload | null,
  resolveInvoice: (invoiceId: string) => unknown | undefined
): number {
  if (!payload) return 0;
  const raw = Array.isArray(payload.suggestions) ? payload.suggestions : [];
  return raw.filter((s: { invoiceId?: string }) => {
    const id = String(s?.invoiceId || "");
    return id && Boolean(resolveInvoice(id));
  }).length;
}

const SEPA_HIDDEN_REASON_PATTERNS = [
  /^Rapprochement direct\b/i,
  /^Correspondance parfaite/i,
  /\bremittanceInfo\b/i,
];

const SEPA_MAX_REASON_LENGTH = 120;

/** Masque les libellés techniques / verbeux de l'agent IA dans l'UI SEPA. */
export function filterSepaCandidateReasons(reasons: string[]): string[] {
  return (reasons || []).filter((reason) => {
    const text = String(reason || "").trim();
    if (!text) return false;
    if (text.length > SEPA_MAX_REASON_LENGTH) return false;
    return !SEPA_HIDDEN_REASON_PATTERNS.some((pattern) => pattern.test(text));
  });
}

/** Statut affiché dans la liste banque : vert / orange / rouge. */
function normalizeInvoiceRef(value: string) {
  return String(value || "")
    .replace(/[\s\-_./]+/g, "")
    .toUpperCase();
}

export function getTxnReconciliationBadgeStatus(
  txn: {
    reconciledStatus?: string;
    matchedInvoiceIds?: string[];
    pendingInvoiceIds?: string[];
    reviewFlag?: boolean;
    sepaLineDecisions?: Record<string, SepaOperationDecision>;
  },
  sepaBatch?: { operations?: Array<{ linkedInvoiceIds?: string[] }> } | null
): TxnReconciliationBadgeStatus {
  const raw = String(txn.reconciledStatus || "").toLowerCase();
  if (raw === "rapproché" || raw === "rapprochee" || raw === "reconciled") {
    return "rapproché";
  }
  if (raw === "partiel" || raw === "partial") {
    return "partiel";
  }

  const matched = (txn.matchedInvoiceIds ?? []).filter(Boolean).length;
  const pending = (txn.pendingInvoiceIds ?? []).filter(Boolean).length;
  if (matched > 0 || pending > 0) return "partiel";

  const sepaOps = sepaBatch?.operations ?? [];
  if (sepaOps.length > 0) {
    const withLinked = sepaOps.filter((op) => (op.linkedInvoiceIds?.length ?? 0) > 0).length;
    if (withLinked > 0 && withLinked < sepaOps.length) return "partiel";
  }

  const decisions =
    txn.sepaLineDecisions && typeof txn.sepaLineDecisions === "object"
      ? Object.values(txn.sepaLineDecisions)
      : [];
  if (decisions.length > 0) {
    const approved = decisions.filter((d) => d.status === "approved").length;
    const touched = decisions.filter(
      (d) =>
        d.status !== "pending" ||
        (d.selectedInvoiceIds?.length ?? 0) > 0 ||
        Boolean(d.rejectAllSuggestions)
    ).length;
    if (approved > 0 && approved < decisions.length) return "partiel";
    if (touched > 0 && approved < decisions.length) return "partiel";
    if (decisions.some((d) => d.status === "review" || d.status === "rejected")) {
      return "partiel";
    }
  }

  return "non_rapproché";
}

/** Toutes les factures liées à l'opération (y compris rapprochement partiel / lignes SEPA). */
export function getTxnDisplayInvoiceIds(
  txn?: {
    reconciledStatus?: string;
    matchedInvoiceIds?: string[];
    pendingInvoiceIds?: string[];
    sepaLineDecisions?: Record<string, SepaOperationDecision>;
  } | null,
  sepaBatch?: { operations?: Array<{ linkedInvoiceIds?: string[] }> } | null
): string[] {
  if (!txn) return [];
  const ids = new Set<string>();
  for (const id of txn.matchedInvoiceIds ?? []) {
    if (id) ids.add(String(id));
  }
  for (const id of txn.pendingInvoiceIds ?? []) {
    if (id) ids.add(String(id));
  }
  if (txn.sepaLineDecisions && typeof txn.sepaLineDecisions === "object") {
    for (const d of Object.values(txn.sepaLineDecisions)) {
      for (const id of d.selectedInvoiceIds ?? []) {
        if (id) ids.add(String(id));
      }
    }
  }
  for (const op of sepaBatch?.operations ?? []) {
    for (const id of op.linkedInvoiceIds ?? []) {
      if (id) ids.add(String(id));
    }
  }
  return Array.from(ids);
}

/** Libellés factures pour la colonne liste (résolution id ou n° facture). */
export function getTxnInvoiceDisplayChips(
  txn: Parameters<typeof getTxnDisplayInvoiceIds>[0],
  sepaBatch: Parameters<typeof getTxnDisplayInvoiceIds>[1],
  invoices: Array<{ id: string; invoiceNumber: string }>
): Array<{ key: string; label: string }> {
  const rawIds = getTxnDisplayInvoiceIds(txn, sepaBatch);
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  const byNumber = new Map(invoices.map((inv) => [normalizeInvoiceRef(inv.invoiceNumber), inv]));
  const chips: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();

  for (const raw of rawIds) {
    const token = String(raw || "").trim();
    if (!token) continue;
    const resolved =
      byId.get(token) || byNumber.get(normalizeInvoiceRef(token));
    const key = resolved?.id || token;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({
      key,
      label: resolved?.invoiceNumber || token,
    });
  }
  return chips;
}

/** IDs factures issus des décisions SEPA persistées (rechargement liste). */
export function collectInvoiceIdsFromSepaDecisions(
  decisions?: Record<string, SepaOperationDecision> | null
): string[] {
  if (!decisions || typeof decisions !== "object") return [];
  const ids = new Set<string>();
  for (const d of Object.values(decisions)) {
    for (const id of d.selectedInvoiceIds ?? []) {
      if (id) ids.add(String(id));
    }
  }
  return Array.from(ids);
}

/** Réinjecte les factures liées sur les lignes du lot SEPA à partir des décisions persistées. */
export function applySepaDecisionsToBatch<
  T extends { operations?: Array<{ id: string; linkedInvoiceIds?: string[] }> },
>(batch: T, decisions: Record<string, SepaOperationDecision>): T {
  if (!batch?.operations?.length) return batch;
  return {
    ...batch,
    operations: batch.operations.map((op) => {
      const selected = decisions[op.id]?.selectedInvoiceIds;
      if (!selected?.length) return op;
      return { ...op, linkedInvoiceIds: [...selected] };
    }),
  };
}
