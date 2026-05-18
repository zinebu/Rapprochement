export type StoredReconciliationProposal = {
  scopeId: string;
  bankTransactionId: string;
  processingStatus: "not_processed" | "processing" | "processed" | "failed";
  processingError?: string | null;
  sourceHash?: string;
  suggestions: Array<{
    invoiceId: string;
    score: number;
    reason?: string;
    signals?: string[];
  }>;
  combinations?: Array<{
    invoiceIds: string[];
    score: number;
    reason?: string;
  }>;
  missingInvoices?: Array<{
    invoiceReference?: string | null;
    creditorName?: string | null;
    amount?: number;
    currency?: string;
    reason?: string;
    hint?: string;
  }>;
  scoring?: string | null;
  engineVersion?: string | null;
};

export type FetchStoredProposalsResult = {
  proposals: Record<string, StoredReconciliationProposal>;
  ensure?: { enqueued?: number; skipped?: number; missing?: number; stale?: number } | null;
};

export async function fetchStoredProposalsMap(
  bankTransactionIds: string[],
  options?: { ensure?: boolean }
): Promise<FetchStoredProposalsResult> {
  const unique = Array.from(new Set(bankTransactionIds.map((x) => String(x)).filter(Boolean)));
  if (!unique.length) return { proposals: {} };

  const merged: Record<string, StoredReconciliationProposal> = {};
  let ensure: FetchStoredProposalsResult["ensure"] = null;

  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const part = await fetchStoredProposals(chunk, options);
    Object.assign(merged, part.proposals);
    if (part.ensure?.enqueued || part.ensure?.stale) {
      ensure = {
        enqueued: (ensure?.enqueued || 0) + (part.ensure.enqueued || 0),
        skipped: (ensure?.skipped || 0) + (part.ensure.skipped || 0),
        missing: (ensure?.missing || 0) + (part.ensure.missing || 0),
        stale: (ensure?.stale || 0) + (part.ensure.stale || 0),
      };
    }
  }

  return { proposals: merged, ensure };
}

export async function fetchStoredProposals(
  bankTransactionIds: string[],
  options?: { ensure?: boolean }
): Promise<FetchStoredProposalsResult> {
  const ids = Array.from(new Set(bankTransactionIds.map((x) => String(x)).filter(Boolean)));
  if (!ids.length) return { proposals: {} };
  const qs = encodeURIComponent(ids.join(","));
  const ensure = options?.ensure === false ? "0" : "1";
  const res = await fetch(
    `/api/reconciliation/proposals?bankTransactionIds=${qs}&ensure=${ensure}`,
    {
      credentials: "include",
      cache: "no-store",
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { proposals: {} };
  return {
    proposals: (data?.proposals || {}) as Record<string, StoredReconciliationProposal>,
    ensure: data?.ensure ?? null,
  };
}

export type EngineMatchResponse = {
  success?: boolean;
  processingStatus?: string;
  scoring?: string;
  suggestions?: Array<{
    invoiceId: string;
    score: number;
    reason?: string;
    signals?: string[];
    matchTier?: string;
    invoice?: {
      id: string;
      invoiceNumber?: string;
      vendorCustomer?: string;
      amountGross?: number;
    };
  }>;
};

/** Moteur serveur synchrone (montant, dates, références, sens) — sans attendre l'IA. */
export async function fetchEngineMatch(
  transaction: Record<string, unknown>,
  invoices: unknown[]
): Promise<EngineMatchResponse> {
  const res = await fetch("/api/reconciliation/engine-match", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction, invoices }),
  });
  const data = (await res.json().catch(() => ({}))) as EngineMatchResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export async function requestRecalculate(
  transaction: Record<string, unknown>,
  invoices: unknown[]
): Promise<{ success?: boolean; processingStatus?: string }> {
  const res = await fetch("/api/reconciliation/recalculate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction, invoices }),
  });
  return res.json().catch(() => ({}));
}

export function subscribeReconciliationEvents(
  onEvent: (payload: Record<string, unknown>) => void
): () => void {
  const source = new EventSource("/api/reconciliation/events", { withCredentials: true });
  source.onmessage = (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      onEvent(payload);
    } catch {
      // ignore
    }
  };
  return () => source.close();
}
