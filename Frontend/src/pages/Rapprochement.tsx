import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, formatCurrency } from "./imports";
import {
  fetchStoredProposals,
  requestRecalculate,
  subscribeReconciliationEvents,
} from "@/features/banque/reconciliation-proposals-api";

type Invoice = {
  id: string;
  invoiceNumber: string;
  vendorCustomer: string;
  invoiceDate: string;
  dueDate: string;
  amountGross: number;
  currency?: string;
  type?: "purchase" | "sales";
  status?: string;
};

type BankOperation = {
  id: string;
  txnDate: string;
  label: string;
  reference: string;
  amount: number;
  currency: string;
  operationType: "encaissement" | "decaissement";
  counterpartyName?: string | null;
};

type SepaBatch = {
  id: string;
  totalAmount?: number;
  debtorCurrency?: string;
  operations: Array<{
    id: string;
    creditorName: string;
    amount: number;
    endToEndId: string;
    remittanceInfo: string;
  }>;
};

type ImportedDoc = {
  _id?: string;
  documentType?: string;
  structuredData?: {
    documentType?: string;
    operations?: any[];
    sepaBatch?: SepaBatch;
  };
};

function toIsoDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

export default function Rapprochement() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [bankOperations, setBankOperations] = useState<BankOperation[]>([]);
  const [sepaBatches, setSepaBatches] = useState<SepaBatch[]>([]);
  const [opSuggestions, setOpSuggestions] = useState<
    Record<string, Array<{ invoiceId: string; score: number; reason: string; localScore?: number; signals?: string[] }>>
  >({});
  const [sepaSuggestions, setSepaSuggestions] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);
  const [recoRecalculatingId, setRecoRecalculatingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [invRes, impRes] = await Promise.all([
          fetch("/api/invoices", { credentials: "include" }),
          fetch("/api/imports", { credentials: "include" }),
        ]);
        const invData = await invRes.json();
        const impData = await impRes.json();
        if (invRes.ok) setInvoices(Array.isArray(invData?.invoices) ? invData.invoices : []);
        if (impRes.ok) {
          const docs: ImportedDoc[] = Array.isArray(impData?.documents) ? impData.documents : [];
          const ops: BankOperation[] = [];
          const sepas: SepaBatch[] = [];
          docs.forEach((doc) => {
            const sd = doc.structuredData;
            const t = sd?.documentType || doc.documentType;
            if (t === "bank_statement" && Array.isArray(sd?.operations)) {
              sd.operations.forEach((op: any) => {
                if (op?.id && typeof op.amount === "number") {
                  ops.push({
                    id: op.id,
                    txnDate: op.txnDate,
                    label: op.label,
                    reference: op.reference,
                    amount: op.amount,
                    currency: op.currency || "EUR",
                    operationType: op.operationType || (op.amount >= 0 ? "encaissement" : "decaissement"),
                    counterpartyName: op.counterpartyName || null,
                  });
                }
              });
            }
            if (t === "sepa_xml" && sd?.sepaBatch?.id) {
              sepas.push(sd.sepaBatch);
            }
          });
          setBankOperations(ops);
          setSepaBatches(sepas);
        }
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const loadProposalsForOperations = useCallback(async (ops: BankOperation[]) => {
    if (!ops.length) {
      setOpSuggestions({});
      return;
    }
    const { proposals: byId } = await fetchStoredProposals(ops.map((o) => o.id));
    const entries = ops.map((op) => {
      const row = byId[op.id];
      const suggestions =
        row?.processingStatus === "processed" && Array.isArray(row.suggestions)
          ? row.suggestions.map((s) => ({
              invoiceId: String(s.invoiceId),
              score: Number(s.score || 0),
              reason: String(s.reason || ""),
              signals: s.signals,
            }))
          : [];
      return [op.id, suggestions] as const;
    });
    setOpSuggestions(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void loadProposalsForOperations(bankOperations);
  }, [bankOperations, loadProposalsForOperations]);

  useEffect(() => {
    return subscribeReconciliationEvents((payload) => {
      const type = String(payload?.type || "");
      if (type !== "RECONCILIATION_PROCESSED" && type !== "RECONCILIATION_FAILED") return;
      void loadProposalsForOperations(bankOperations);
    });
  }, [bankOperations, loadProposalsForOperations]);

  const openInvoices = useMemo(
    () =>
      invoices.filter((inv) => {
        const status = String(inv.status || "").toLowerCase();
        return !["rapprochée", "rapprochee", "reconciled"].includes(status);
      }),
    [invoices]
  );

  const handleRecalculate = async (op: BankOperation) => {
    setRecoRecalculatingId(op.id);
    try {
      await requestRecalculate(op, openInvoices);
    } finally {
      setRecoRecalculatingId(null);
    }
  };

  const invoicesById = useMemo(() => {
    const m = new Map<string, Invoice>();
    invoices.forEach((i) => m.set(i.id, i));
    return m;
  }, [invoices]);

  const matchedOperations = useMemo(
    () =>
      bankOperations
        .map((op) => ({
          op,
          suggestions: (opSuggestions[op.id] || []).filter((s) => Number(s.score || 0) >= 28).slice(0, 5),
        }))
        .filter((entry) => entry.suggestions.length > 0),
    [bankOperations, opSuggestions]
  );

  const matchedSepa = useMemo(
    () =>
      sepaBatches
        .map((batch) => ({
          batch,
          combos: (sepaSuggestions[batch.id] || []).slice(0, 5),
        }))
        .filter((entry) => entry.combos.length > 0),
    [sepaBatches, sepaSuggestions]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Rapprochement</h1>
        <p className="text-sm text-muted-foreground">
          Suggestions lues depuis le cache serveur (aucun appel OpenAI au chargement). Utilisez « Recalculer » pour forcer une nouvelle analyse.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rapprochement opérations / factures</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement...</p>
          ) : matchedOperations.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Aucune correspondance en cache pour les opérations bancaires.
              </p>
              {bankOperations.length > 0 ? (
                <div className="space-y-2">
                  {bankOperations.slice(0, 20).map((op) => (
                    <div key={op.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                      <span className="truncate text-sm">{op.label}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={recoRecalculatingId === op.id}
                        onClick={() => void handleRecalculate(op)}
                      >
                        {recoRecalculatingId === op.id ? "Recalcul…" : "Recalculer"}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              {matchedOperations.map(({ op, suggestions }) => {
                return (
                  <div key={op.id} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{op.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {toIsoDate(op.txnDate)} · {op.reference} · {op.counterpartyName || "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className={`font-mono font-semibold ${op.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {formatCurrency(op.amount, op.currency)}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={recoRecalculatingId === op.id}
                          onClick={() => void handleRecalculate(op)}
                        >
                          Recalculer
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {suggestions.map((s) => {
                        const inv = invoicesById.get(String(s.invoiceId));
                        if (!inv) return null;
                        return (
                          <div key={`${op.id}-${inv.id}`} className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{inv.vendorCustomer} · {inv.invoiceNumber}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{s.reason}</p>
                              {Array.isArray(s.signals) && s.signals.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {s.signals.map((sig, i) => (
                                    <span key={i} className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
                                      {sig}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rapprochement SEPA par combinaison</CardTitle>
        </CardHeader>
        <CardContent>
          {matchedSepa.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune combinaison SEPA en cache. Utilisez la page Banque pour rapprocher les lots SEPA.
            </p>
          ) : (
            <div className="space-y-6">
              {matchedSepa.map(({ batch, combos }) => (
                <div key={batch.id} className="rounded-xl border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{batch.id}</p>
                      <p className="text-xs text-muted-foreground">
                        Total SEPA: {formatCurrency(Number(batch.totalAmount || 0), batch.debtorCurrency || "EUR")}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">{batch.operations.length} opérations SEPA</span>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Factures proposées (combinaison)</TableHead>
                        <TableHead className="w-[180px]">Total combinaison</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {combos.map((combo: any, idx: number) => (
                        <TableRow key={`${batch.id}-${idx}`}>
                          <TableCell>
                            {(combo.invoiceIds || [])
                              .map((id: string) => invoicesById.get(id)?.invoiceNumber || id)
                              .join(", ")}
                          </TableCell>
                          <TableCell>{formatCurrency(Number(combo.totalAmount || 0), batch.debtorCurrency || "EUR")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
