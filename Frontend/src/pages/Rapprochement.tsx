import { useEffect, useMemo, useState, Card, CardContent, CardHeader, CardTitle, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, StatusBadge, formatCurrency } from "./imports";

type Invoice = {
  id: string;
  invoiceNumber: string;
  vendorCustomer: string;
  invoiceDate: string;
  dueDate: string;
  amountGross: number;
  currency?: string;
  type?: "purchase" | "sales";
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

  useEffect(() => {
    const scoreOps = async () => {
      if (!invoices.length || !bankOperations.length) return;
      const entries = await Promise.all(
        bankOperations.map(async (op) => {
          const res = await fetch("/api/reconciliation/score", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transaction: op, invoices }),
          });
          const data = await res.json().catch(() => ({}));
          const s = Array.isArray(data?.suggestions) ? data.suggestions : [];
          return [op.id, s] as const;
        })
      );
      setOpSuggestions(Object.fromEntries(entries));
    };
    void scoreOps();
  }, [invoices, bankOperations]);

  useEffect(() => {
    const scoreSepa = async () => {
      if (!invoices.length || !sepaBatches.length) return;
      const entries = await Promise.all(
        sepaBatches.map(async (batch) => {
          const res = await fetch("/api/reconciliation/sepa-score", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sepaBatch: batch, invoices }),
          });
          const data = await res.json().catch(() => ({}));
          return [batch.id, Array.isArray(data?.combinationSuggestions) ? data.combinationSuggestions : []] as const;
        })
      );
      setSepaSuggestions(Object.fromEntries(entries));
    };
    void scoreSepa();
  }, [invoices, sepaBatches]);

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
          Scoring serveur (montant, dates, références, sens) avec complément IA seulement si cohérent — combinaisons SEPA côté serveur.
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
            <p className="text-sm text-muted-foreground">Aucune correspondance trouvée pour les opérations bancaires.</p>
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
                      <p className={`font-mono font-semibold ${op.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {formatCurrency(op.amount, op.currency)}
                      </p>
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
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                                {s.score}%
                              </span>
                              {typeof s.localScore === "number" && s.localScore !== s.score ? (
                                <span className="text-[10px] text-muted-foreground">local {s.localScore}%</span>
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
            <p className="text-sm text-muted-foreground">Aucune correspondance trouvée pour les lots SEPA.</p>
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
                        <TableHead className="w-[120px]">Score</TableHead>
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
                          <TableCell>{Number(combo.score || 0)}%</TableCell>
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
