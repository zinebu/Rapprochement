import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  formatCurrency,
  toast,
  ChevronDown,
  FileSearch,
  Eye,
} from "./imports";
import { cn } from "@/lib/utils";

type PayrollSlip = {
  id: string;
  matricule?: string;
  employeeName: string;
  civility?: string | null;
  jobTitle?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  grossSalary?: number | null;
  netPay?: number | null;
  employerCost?: number | null;
  paymentDate?: string | null;
  iban?: string | null;
  pageStart?: number;
  pageEnd?: number;
};

type PayrollBatch = {
  id: string;
  sourceDocumentId?: string;
  label?: string;
  periodLabel?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  companyName?: string | null;
  companyAddress?: string | null;
  numberOfSlips?: number;
  totalGross?: number | null;
  totalNet?: number | null;
  totalEmployerCost?: number | null;
  currency?: string;
  slips: PayrollSlip[];
};

type ImportedDoc = {
  _id?: string;
  documentType?: string;
  structuredData?: {
    documentType?: string;
    payrollBatch?: PayrollBatch;
  };
};

function formatPeriod(batch: PayrollBatch) {
  if (batch.periodLabel) return batch.periodLabel;
  if (batch.periodStart && batch.periodEnd) {
    const start = batch.periodStart.slice(0, 7).split("-").reverse().join("/");
    const end = batch.periodEnd.slice(0, 7).split("-").reverse().join("/");
    return `${start} → ${end}`;
  }
  return "—";
}

function payslipFileUrl(documentId: string, slipId: string) {
  return `/api/imports/${encodeURIComponent(documentId)}/payslip/${encodeURIComponent(slipId)}/file`;
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

export default function BulletinsPaiePage() {
  const [params] = useSearchParams();
  const [batches, setBatches] = useState<PayrollBatch[]>([]);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{
    title: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
      const res = await fetch("/api/imports", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;

      const docs: ImportedDoc[] = Array.isArray(data?.documents) ? data.documents : [];
      const imported = docs
        .map((d) => {
          const batch = d?.structuredData?.payrollBatch;
          if (!batch?.id || !Array.isArray(batch.slips) || batch.slips.length === 0) return null;
          return {
            ...batch,
            slips: batch.slips,
            sourceDocumentId: d._id,
          } as PayrollBatch;
        })
        .filter((b): b is PayrollBatch => Boolean(b));

      setBatches(imported);

      const ref = params.get("batch");
      if (ref) {
        const match = imported.find((b) => b.id === ref);
        if (match) setOpenIds({ [match.id]: true });
      }
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [params]);

  const sortedBatches = useMemo(() => {
    return [...batches].sort((a, b) =>
      String(b.periodStart || b.label || "").localeCompare(String(a.periodStart || a.label || ""))
    );
  }, [batches]);

  const deleteBatch = async (batch: PayrollBatch, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!batch.sourceDocumentId) return;
    const res = await fetch(`/api/imports/${encodeURIComponent(batch.sourceDocumentId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok && res.status !== 404) {
      toast.error("Impossible de supprimer ce bulletin.");
      return;
    }
    setBatches((prev) => prev.filter((b) => b.id !== batch.id));
    setOpenIds((prev) => {
      const next = { ...prev };
      delete next[batch.id];
      return next;
    });
  };

  const openSlip = (batch: PayrollBatch, slip: PayrollSlip) => {
    if (!batch.sourceDocumentId) return;
    setPreview({
      title: `${slip.employeeName} — ${slip.matricule || slip.id}`,
      url: payslipFileUrl(batch.sourceDocumentId, slip.id),
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bulletins de paie</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fiches salariés extraites des bulletins de paie importés (grand livre de paie mensuel).
        </p>
      </div>

      {loading ? (
        <ListLoading />
      ) : sortedBatches.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Aucun bulletin importé. Utilisez{" "}
          <a href="/import" className="text-primary underline-offset-2 hover:underline">
            Import
          </a>{" "}
          pour charger un PDF de bulletin de paie (ex. Bulletins_01-2025).
        </div>
      ) : (
        <ul className="space-y-2">
          {sortedBatches.map((batch) => {
            const cur = batch.currency || "EUR";
            const isOpen = Boolean(openIds[batch.id]);
            const n = batch.numberOfSlips ?? batch.slips.length;

            return (
              <li key={batch.id} className="list-none">
                <Collapsible open={isOpen} onOpenChange={(open) => setOpenIds((p) => ({ ...p, [batch.id]: open }))}>
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
                            <div className="truncate text-sm font-semibold text-foreground">
                              {batch.label || batch.id}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              <span>Période {formatPeriod(batch)}</span>
                              <span>{n} salarié{n > 1 ? "s" : ""}</span>
                              {batch.totalNet != null ? (
                                <span>Net total {formatCurrency(batch.totalNet, cur)}</span>
                              ) : null}
                              {batch.companyName ? (
                                <span className="max-w-[200px] truncate">{batch.companyName}</span>
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
                            onClick={(e) => void deleteBatch(batch, e)}
                          >
                            Supprimer
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <CollapsibleContent>
                      <div className="border-t bg-muted/20 px-4 py-3">
                        <dl className="mb-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                          {batch.companyAddress ? (
                            <div className="flex gap-2 sm:col-span-2">
                              <dt className="shrink-0 text-muted-foreground">Société</dt>
                              <dd className="min-w-0">
                                {batch.companyName}
                                <span className="block text-xs text-muted-foreground">{batch.companyAddress}</span>
                              </dd>
                            </div>
                          ) : null}
                          {batch.totalGross != null ? (
                            <div className="flex gap-2">
                              <dt className="text-muted-foreground">Brut total</dt>
                              <dd className="font-mono">{formatCurrency(batch.totalGross, cur)}</dd>
                            </div>
                          ) : null}
                          {batch.totalEmployerCost != null ? (
                            <div className="flex gap-2">
                              <dt className="text-muted-foreground">Coût entreprise</dt>
                              <dd className="font-mono">{formatCurrency(batch.totalEmployerCost, cur)}</dd>
                            </div>
                          ) : null}
                        </dl>

                        <div className="overflow-hidden rounded-md border bg-background">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Salarié</TableHead>
                                <TableHead className="hidden sm:table-cell">Matricule</TableHead>
                                <TableHead className="hidden md:table-cell">Emploi</TableHead>
                                <TableHead className="text-right">Brut</TableHead>
                                <TableHead className="text-right">Net à payer</TableHead>
                                <TableHead className="w-[90px] text-right">Fiche</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {batch.slips.map((slip) => (
                                <TableRow key={slip.id}>
                                  <TableCell>
                                    <div className="font-medium">
                                      {slip.civility ? `${slip.civility} ` : ""}
                                      {slip.employeeName}
                                    </div>
                                  </TableCell>
                                  <TableCell className="hidden font-mono text-xs sm:table-cell">
                                    {slip.matricule || "—"}
                                  </TableCell>
                                  <TableCell className="hidden max-w-[160px] truncate text-xs md:table-cell">
                                    {slip.jobTitle || "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {slip.grossSalary != null
                                      ? formatCurrency(slip.grossSalary, cur)
                                      : "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm font-semibold">
                                    {slip.netPay != null ? formatCurrency(slip.netPay, cur) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 gap-1"
                                      onClick={() => openSlip(batch, slip)}
                                      disabled={!batch.sourceDocumentId}
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                      Voir
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {batch.sourceDocumentId ? (
                          <div className="mt-3 flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setPreview({
                                  title: batch.label || "Bulletin complet",
                                  url: `/api/imports/${encodeURIComponent(batch.sourceDocumentId!)}/file`,
                                })
                              }
                            >
                              <FileSearch className="mr-1 h-3.5 w-3.5" />
                              Voir le PDF source
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-base">{preview?.title || "Fiche de paie"}</DialogTitle>
          </DialogHeader>
          {preview?.url ? (
            <iframe
              title={preview.title}
              src={preview.url}
              className="h-[min(78vh,820px)] w-full border-0 bg-slate-100"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
