import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  formatCurrency,
  ChevronDown,
} from "./imports";
import { cn } from "@/lib/utils";

type SepaOperation = {
  id: string;
  creditorName: string;
  creditorIban: string;
  creditorBic?: string | null;
  amount: number;
  currency: string;
  endToEndId: string;
  remittanceInfo: string;
  payrollSlipRef?: string;
  employeeName?: string;
};

type SepaBatch = {
  id: string;
  sourceDocumentId?: string;
  type?: "invoice" | "payroll";
  label?: string;
  executionDate?: string | null;
  totalAmount?: number;
  numberOfTransactions?: number;
  debtorName?: string | null;
  debtorIban?: string | null;
  debtorCurrency?: string | null;
  periodLabel?: string | null;
  linkedSlipCount?: number;
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

function normalizeRef(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s\-_./]+/g, "");
}

function batchTotal(batch: SepaBatch): number | null {
  if (typeof batch.totalAmount === "number" && !Number.isNaN(batch.totalAmount)) {
    return batch.totalAmount;
  }
  const sum = batch.operations.reduce((s, op) => s + Number(op.amount || 0), 0);
  return sum > 0 ? sum : null;
}

function ListLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground"
        aria-hidden
      />
      Chargement…
    </div>
  );
}

export default function SepaPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [batches, setBatches] = useState<SepaBatch[]>([]);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
      const importsRes = await fetch("/api/imports", { credentials: "include" });
      const importsData = await importsRes.json().catch(() => ({}));
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

      const ref = params.get("ref");
      if (ref) {
        const wanted = normalizeRef(ref);
        const match = importedBatches.find((b) => normalizeRef(b.id) === wanted);
        if (match) setOpenIds({ [match.id]: true });
      }
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [params]);

  const setOpen = (id: string, open: boolean) => {
    setOpenIds((prev) => ({ ...prev, [id]: open }));
  };

  const deleteSepaBatch = async (batch: SepaBatch, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!batch.sourceDocumentId) return;
    const res = await fetch(`/api/imports/${encodeURIComponent(batch.sourceDocumentId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok && res.status !== 404) return;
    setBatches((prev) => prev.filter((b) => b.id !== batch.id));
    setOpenIds((prev) => {
      const next = { ...prev };
      delete next[batch.id];
      return next;
    });
  };

  const sortedBatches = useMemo(() => {
    return [...batches].sort((a, b) => String(b.executionDate || "").localeCompare(String(a.executionDate || "")));
  }, [batches]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">SEPA</h1>
        <Button variant="outline" onClick={() => navigate("/banque")}>
          Banque
        </Button>
      </div>

      {loading ? (
        <ListLoading />
      ) : batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun lot SEPA importé.</p>
      ) : (
        <ul className="space-y-2">
          {sortedBatches.map((batch) => {
            const total = batchTotal(batch);
            const cur = batch.debtorCurrency || "EUR";
            const n = batch.numberOfTransactions ?? batch.operations.length;
            const isOpen = Boolean(openIds[batch.id]);

            return (
              <li key={batch.id} className="list-none">
                <Collapsible open={isOpen} onOpenChange={(open) => setOpen(batch.id, open)}>
                  <div className="overflow-hidden rounded-lg border bg-card">
                    <div className="flex items-stretch">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
                        >
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                              isOpen && "rotate-180"
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">
                              {batch.label || batch.id}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              {batch.type === "payroll" ? (
                                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-violet-800">
                                  Salaires
                                </span>
                              ) : null}
                              {batch.executionDate ? <span>{batch.executionDate}</span> : null}
                              <span>
                                {n} × {total != null ? formatCurrency(total, cur) : "—"}
                              </span>
                              {batch.debtorName ? (
                                <span className="max-w-[200px] truncate">{batch.debtorName}</span>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      </CollapsibleTrigger>
                      {batch.sourceDocumentId ? (
                        <div className="flex shrink-0 items-center border-l pr-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={(e) => void deleteSepaBatch(batch, e)}
                          >
                            Supprimer
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <CollapsibleContent>
                      <div className="border-t bg-muted/20 px-4 py-3">
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                          {batch.debtorIban ? (
                            <div className="flex gap-2">
                              <dt className="shrink-0 text-muted-foreground">IBAN</dt>
                              <dd className="min-w-0 font-mono text-xs break-all">{batch.debtorIban}</dd>
                            </div>
                          ) : null}
                          {batch.debtorName ? (
                            <div className="flex gap-2">
                              <dt className="shrink-0 text-muted-foreground">Débiteur</dt>
                              <dd className="min-w-0 truncate">{batch.debtorName}</dd>
                            </div>
                          ) : null}
                        </dl>

                        <div className="mt-4 overflow-hidden rounded-md border bg-background">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Créancier</TableHead>
                                <TableHead className="hidden sm:table-cell">IBAN</TableHead>
                                <TableHead className="hidden md:table-cell">Réf.</TableHead>
                                <TableHead className="text-right">Montant</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {batch.operations.map((op) => (
                                <TableRow key={op.id}>
                                  <TableCell>
                                    <div className="font-medium">{op.creditorName}</div>
                                    <div className="mt-1 font-mono text-[11px] text-muted-foreground sm:hidden">
                                      {op.creditorIban}
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-muted-foreground md:hidden">
                                      {op.endToEndId}
                                    </div>
                                  </TableCell>
                                  <TableCell className="hidden max-w-[220px] truncate font-mono text-xs sm:table-cell">
                                    {op.creditorIban}
                                  </TableCell>
                                  <TableCell className="hidden max-w-[140px] truncate font-mono text-xs md:table-cell">
                                    {op.endToEndId}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {formatCurrency(Number(op.amount || 0), op.currency || cur)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
