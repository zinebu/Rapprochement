import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./imports";

type SepaOperation = {
  id: string;
  creditorName: string;
  creditorIban: string;
  creditorBic?: string | null;
  amount: number;
  currency: string;
  endToEndId: string;
  remittanceInfo: string;
};

type SepaBatch = {
  id: string;
  sourceDocumentId?: string;
  label?: string;
  executionDate?: string | null;
  totalAmount?: number;
  numberOfTransactions?: number;
  debtorName?: string | null;
  debtorIban?: string | null;
  debtorCurrency?: string | null;
  operations: SepaOperation[];
};

type ImportedDoc = {
  _id?: string;
  documentType?: string;
  structuredData?: {
    documentType?: string;
    sepaBatch?: SepaBatch;
  };
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  vendorCustomer: string;
  amountGross: number;
  currency?: string | null;
  type?: "purchase" | "sales";
};

type OperationSuggestion = {
  invoiceId: string;
  score: number;
  reason: string;
  signals?: string[];
};

function normalizeRef(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s\-_./]+/g, "");
}

export default function SepaPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [batches, setBatches] = useState<SepaBatch[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [opSuggestions, setOpSuggestions] = useState<Record<string, OperationSuggestion[]>>({});
  const [opSelection, setOpSelection] = useState<Record<string, string[]>>({});
  const [opReconciled, setOpReconciled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = async () => {
      const [importsRes, invoicesRes] = await Promise.all([
        fetch("/api/imports", { credentials: "include" }),
        fetch("/api/invoices", { credentials: "include" }),
      ]);
      const importsData = await importsRes.json().catch(() => ({}));
      const invoicesData = await invoicesRes.json().catch(() => ({}));
      if (!importsRes.ok) return;

      const docs: ImportedDoc[] = Array.isArray(importsData?.documents) ? importsData.documents : [];
      const importedBatches = docs
        .map((d) => {
          const batch = d?.structuredData?.sepaBatch;
          if (!batch || !batch.id) return null;
          const seenIds = new Set<string>();
          const normalizedOperations = (batch.operations || []).map((op, index) => {
            const baseId = String(op?.id || op?.endToEndId || `sepa-op-${index + 1}`);
            let uniqueId = baseId;
            if (seenIds.has(uniqueId)) uniqueId = `${baseId}-${index + 1}`;
            seenIds.add(uniqueId);
            return { ...op, id: uniqueId };
          });
          return {
            ...batch,
            operations: normalizedOperations,
            sourceDocumentId: d._id,
          } as SepaBatch;
        })
        .filter((b): b is SepaBatch => Boolean(b && b.id));
      setBatches(importedBatches);
      if (invoicesRes.ok) {
        const inv: Invoice[] = Array.isArray(invoicesData?.invoices) ? invoicesData.invoices : [];
        setInvoices(inv);
      }

      const ref = params.get("ref");
      if (ref) {
        const wanted = normalizeRef(ref);
        const match = importedBatches.find((b) => normalizeRef(b.id) === wanted);
        if (match) setSelectedId(match.id);
      } else if (importedBatches[0]) {
        setSelectedId(importedBatches[0].id);
      }
    };
    void load();
  }, [params]);

  const selected = useMemo(
    () => batches.find((b) => b.id === selectedId) || null,
    [batches, selectedId]
  );

  const selectedTotal = useMemo(() => {
    if (!selected) return null;
    if (typeof selected.totalAmount === "number" && !Number.isNaN(selected.totalAmount)) {
      return selected.totalAmount;
    }
    return selected.operations.reduce((sum, op) => sum + Number(op.amount || 0), 0);
  }, [selected]);

  useEffect(() => {
    const loadOperationSuggestions = async () => {
      if (!selected || invoices.length === 0) {
        setOpSuggestions({});
        return;
      }
      const next: Record<string, OperationSuggestion[]> = {};
      for (const op of selected.operations) {
        try {
          const transaction = {
            id: op.id,
            txnDate: selected.executionDate || new Date().toISOString().slice(0, 10),
            label: `${op.creditorName} ${op.remittanceInfo || ""}`.trim(),
            reference: op.endToEndId || selected.id,
            amount: -Math.abs(Number(op.amount || 0)),
            currency: op.currency || selected.debtorCurrency || "EUR",
            operationType: "decaissement",
            paymentMethod: "SEPA",
            counterpartyName: op.creditorName,
          };

          const res = await fetch("/api/reconciliation/score", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transaction, invoices }),
          });
          const data = await res.json().catch(() => ({}));
          const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
          next[op.id] = suggestions
            .filter((s: any) => Number(s?.score || 0) >= 24)
            .slice(0, 5)
            .map((s: any) => ({
              invoiceId: String(s.invoiceId),
              score: Number(s.score || 0),
              reason: String(s.reason || ""),
              signals: Array.isArray(s.signals) ? s.signals : [],
            }));
        } catch {
          next[op.id] = [];
        }
      }
      setOpSuggestions(next);
    };

    void loadOperationSuggestions();
  }, [selected, invoices]);

  const invoiceById = useMemo(() => {
    const map = new Map<string, Invoice>();
    invoices.forEach((inv) => map.set(inv.id, inv));
    return map;
  }, [invoices]);

  const deleteSepaBatch = async (batch: SepaBatch) => {
    if (!batch.sourceDocumentId) return;
    const res = await fetch(`/api/imports/${encodeURIComponent(batch.sourceDocumentId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok && res.status !== 404) return;
    setBatches((prev) => prev.filter((b) => b.id !== batch.id));
    if (selectedId === batch.id) {
      const next = batches.find((b) => b.id !== batch.id);
      setSelectedId(next?.id || "");
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SEPA</h1>
          <p className="text-sm text-muted-foreground">Lots SEPA importés depuis le module Import.</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/banque")}>Retour Banque</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lots SEPA importés</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun lot SEPA importé.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {batches.map((batch) => (
                <div key={batch.id} className="inline-flex items-center gap-1">
                  <Button
                    variant={selectedId === batch.id ? "default" : "outline"}
                    onClick={() => setSelectedId(batch.id)}
                  >
                    {batch.id}
                  </Button>
                  {batch.sourceDocumentId ? (
                    <Button variant="outline" size="sm" onClick={() => void deleteSepaBatch(batch)}>
                      Supprimer
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{selected.label || selected.id}</CardTitle>
              {selected.sourceDocumentId ? (
                <Button variant="outline" size="sm" onClick={() => void deleteSepaBatch(selected)}>
                  Supprimer cette SEPA
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div><span className="text-muted-foreground">Référence :</span> {selected.id}</div>
              <div><span className="text-muted-foreground">Date exécution :</span> {selected.executionDate || "—"}</div>
              <div><span className="text-muted-foreground">Débiteur :</span> {selected.debtorName || "—"}</div>
              <div><span className="text-muted-foreground">Nb opérations :</span> {selected.numberOfTransactions ?? selected.operations.length}</div>
              <div><span className="text-muted-foreground">Total :</span> {selectedTotal != null ? `${selectedTotal.toFixed(2)} ${selected.debtorCurrency || "EUR"}` : "—"}</div>
            </div>
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Créancier</TableHead>
                    <TableHead>IBAN</TableHead>
                    <TableHead>Réf</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Rapprochement facture</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.operations.map((op) => (
                    <TableRow key={op.id}>
                      <TableCell>{op.creditorName}</TableCell>
                      <TableCell>{op.creditorIban}</TableCell>
                      <TableCell>{op.endToEndId}</TableCell>
                      <TableCell className="text-right">{op.amount} {op.currency}</TableCell>
                      <TableCell className="min-w-[380px]">
                        <div className="space-y-2">
                          {opReconciled[op.id] ? (
                            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700">
                              Rapprochée
                            </span>
                          ) : null}
                          {(opSuggestions[op.id] || []).length === 0 ? (
                            <p className="text-xs text-muted-foreground">Aucune suggestion.</p>
                          ) : (
                            <div className="space-y-2">
                              {(opSuggestions[op.id] || []).map((s) => {
                                const inv = invoiceById.get(s.invoiceId);
                                if (!inv) return null;
                                const selectedForOp = opSelection[op.id] || [];
                                const checked = selectedForOp.includes(inv.id);
                                return (
                                  <label
                                    key={`${op.id}-${inv.id}`}
                                    className={`flex cursor-pointer items-start justify-between rounded-lg border px-2 py-2 ${
                                      checked ? "border-primary bg-primary/5" : "border-slate-200"
                                    }`}
                                  >
                                    <div className="pr-2">
                                      <p className="text-xs font-medium">
                                        {inv.invoiceNumber} - {inv.vendorCustomer}
                                      </p>
                                      <p className="text-[11px] text-muted-foreground">
                                        {s.score}% - {s.reason}
                                      </p>
                                    </div>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        setOpSelection((prev) => {
                                          const current = prev[op.id] || [];
                                          const next = current.includes(inv.id)
                                            ? current.filter((id) => id !== inv.id)
                                            : [...current, inv.id];
                                          return { ...prev, [op.id]: next };
                                        });
                                      }}
                                    />
                                  </label>
                                );
                              })}
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    const selectedIds = opSelection[op.id] || [];
                                    if (selectedIds.length === 0) return;
                                    setOpReconciled((prev) => ({ ...prev, [op.id]: true }));
                                  }}
                                >
                                  Rapprocher
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
