import {
  useMemo,
  useState,
  useRef,
  useEffect,
  Card,
  CardContent,
  Button,
  StatCard,
  StatusBadge,
  mockTransactions,
  mockInvoices,
  formatCurrency,
  formatDate,
  type BankTransaction,
  type Invoice,
  ArrowRight,
  Check,
  Undo2,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  Hash,
  Tag,
  AlertTriangle,
  CheckCircle2,
  Info,
  toast,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
} from "./imports";
import { getReconciliationSuggestions, validateReconciliation, resetReconciliation } from "../services/reconciliationApi";
import { getInvoices } from "../services/reconciliationApi";
import type {
  BackendSuggestion,
  CurrencyCode,
  CurrencyFilter,
  ScopeFilter,
  SepaBatchOperation,
  SepaOperationCandidate,
  SepaOperationDecision,
  SepaOperationDecisionStatus,
} from "@/features/rapprochement/types";
import {
  computeMatchScore,
  ensureDemoInvoices,
  ensureDemoTransactions,
  getAccountBadge,
  getAvailableInvoicesForSepaOperation,
  getDecisionBadgeClass,
  getDecisionLabel,
  getInvoiceCurrency,
  getSepaBatchForTransaction,
  getSepaDecisionAmount,
  getTransactionCurrency,
  getCurrencyBadgeClass,
  getMatchDetails,
  isSepaBatch,
  shouldShowAccountBadge,
} from "@/features/rapprochement/utils";

export default function Rapprochement() {
  const [backendSuggestions, setBackendSuggestions] = useState<BackendSuggestion[]>([]);
const [loadingSuggestions, setLoadingSuggestions] = useState(false);
const loadBackendSuggestions = async () => {
  try {
    setLoadingSuggestions(true);
    const data = await getReconciliationSuggestions();
    setBackendSuggestions(data);
  } catch (error) {
    console.error(error);
    toast.error("Impossible de charger les suggestions backend.");
  } finally {
    setLoadingSuggestions(false);
  }
};
useEffect(() => {
  loadBackendSuggestions();
}, []);
  const [transactions, setTransactions] = useState<BankTransaction[]>(() => ensureDemoTransactions(mockTransactions));
  const [invoices, setInvoices] = useState<Invoice[]>(() => ensureDemoInvoices(mockInvoices));
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set());
  const [detailsTxnId, setDetailsTxnId] = useState<string | null>(null);
  const [sepaDialogTxnId, setSepaDialogTxnId] = useState<string | null>(null);
  const [sepaLineDecisions, setSepaLineDecisions] = useState<Record<string, SepaOperationDecision>>({});
  const [sepaCurrentOperationIndex, setSepaCurrentOperationIndex] = useState(0);
  const [rejectedSuggestionTxns, setRejectedSuggestionTxns] = useState<Set<string>>(new Set());
  const [currencyFilter, setCurrencyFilter] = useState<CurrencyFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
const [previewPdfTitle, setPreviewPdfTitle] = useState("");
  const unreconciledRef = useRef<HTMLDivElement>(null);
  const reconciledRef = useRef<HTMLDivElement>(null);
  const sepaPendingRef = useRef<HTMLDivElement>(null);
  const sepaReconciledRef = useRef<HTMLDivElement>(null);
const [showBackendSuggestions, setShowBackendSuggestions] = useState(true);
  const scrollToSection = (ref: { current: HTMLDivElement | null }) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleExpand = (key: string) => {
    setExpandedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const matchesFilters = (txn: BankTransaction) => {
    const currency = getTransactionCurrency(txn);
    const scopeOk =
      scopeFilter === "all" ||
      (scopeFilter === "sepa" && isSepaBatch(txn)) ||
      (scopeFilter === "bank" && !isSepaBatch(txn)) ||
      (scopeFilter === "prelevement" && shouldShowAccountBadge(txn));

    const currencyOk = currencyFilter === "all" || currency === currencyFilter;

    return scopeOk && currencyOk;
  };

  const allFilteredTransactions = transactions.filter(matchesFilters);
  const unreconciled = allFilteredTransactions.filter((t) => t.reconciledStatus === "non_rapproché");
  const reconciled = allFilteredTransactions.filter((t) => t.reconciledStatus !== "non_rapproché");

  const unreconciledNonSepa = unreconciled.filter((t) => !isSepaBatch(t));
  const sepaUnreconciled = unreconciled.filter(isSepaBatch);
  const reconciledNonSepa = reconciled.filter((t) => !isSepaBatch(t));
  const sepaReconciledTxns = reconciled.filter(isSepaBatch);

  const selectedDetailsTxn = transactions.find((t) => t.id === detailsTxnId) ?? null;

  const selectedDetailsInvoices = useMemo(() => {
    if (!selectedDetailsTxn?.matchedInvoiceIds || selectedDetailsTxn.matchedInvoiceIds.length === 0) {
      return [] as Invoice[];
    }

    return selectedDetailsTxn.matchedInvoiceIds
      .map((id) => invoices.find((i) => i.id === id))
      .filter((i): i is Invoice => Boolean(i));
  }, [selectedDetailsTxn, invoices]);

  const suggestions = useMemo(() => {
    const map = new Map<string, { invoice: Invoice; score: number }[]>();

    for (const txn of unreconciled) {
      if (isSepaBatch(txn)) {
        map.set(txn.id, []);
        continue;
      }

      const txnCurrency = getTransactionCurrency(txn);
      const unreconciledInvoices = invoices.filter(
        (i) =>
          getInvoiceCurrency(i) === txnCurrency &&
          !transactions.some((r) => r.reconciledStatus !== "non_rapproché" && r.matchedInvoiceIds?.includes(i.id)),
      );

      const scored = unreconciledInvoices
        .map((inv) => ({ invoice: inv, score: computeMatchScore(txn, inv) }))
        .filter((s) => s.score > 15)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      map.set(txn.id, scored);
    }

    return map;
  }, [unreconciled, invoices, transactions]);

  const handleReconcile = async (txnId: string, invId: string) => {
  try {
    await validateReconciliation(txnId, [invId]);
    toast.success("Opération rapprochée avec succès.");
    await loadBackendSuggestions();
  } catch (error) {
    console.error(error);
    toast.error("Échec du rapprochement.");
  }
};

  const handleReconcileBatch = async (
  txnId: string,
  invIds: string[],
  _status: BankTransaction["reconciledStatus"] = "rapproché",
) => {
  if (invIds.length === 0) {
    toast.error("Sélectionnez au moins une facture.");
    return;
  }

  try {
    await validateReconciliation(txnId, invIds);
    toast.success("Lot SEPA rapproché avec succès.");
    await loadBackendSuggestions();
  } catch (error) {
    console.error(error);
    toast.error("Échec du rapprochement SEPA.");
  }
};
const handleUnreconcile = async (txnId: string) => {
  try {
    await resetReconciliation(txnId);
    toast.info("Rapprochement annulé.");
    await loadBackendSuggestions();
  } catch (error) {
    console.error(error);
    toast.error("Échec de l'annulation du rapprochement.");
  }
};

  const sepaDialogTxn = useMemo(
    () => (sepaDialogTxnId ? transactions.find((t) => t.id === sepaDialogTxnId) ?? null : null),
    [sepaDialogTxnId, transactions],
  );

  const sepaBatch = useMemo(() => {
    if (!sepaDialogTxn) return null;
    return getSepaBatchForTransaction(sepaDialogTxn);
  }, [sepaDialogTxn]);

  const sepaOperationCandidates = useMemo(() => {
    if (!sepaDialogTxn || !sepaBatch) {
      return [] as { operation: SepaBatchOperation; candidates: SepaOperationCandidate[] }[];
    }

    return sepaBatch.operations.map((op) => ({
      operation: op,
      candidates: getAvailableInvoicesForSepaOperation(
        sepaDialogTxn,
        op,
        invoices,
        transactions,
        sepaLineDecisions[op.id]?.selectedInvoiceIds ?? [],
      ),
    }));
  }, [invoices, sepaBatch, sepaDialogTxn, sepaLineDecisions, transactions]);

  const sepaCurrentOperation = useMemo(() => {
    if (!sepaBatch) return null;
    return sepaBatch.operations[sepaCurrentOperationIndex] ?? null;
  }, [sepaBatch, sepaCurrentOperationIndex]);

  const sepaCurrentCandidates = useMemo(() => {
    if (!sepaCurrentOperation) return [] as SepaOperationCandidate[];
    return sepaOperationCandidates.find((entry) => entry.operation.id === sepaCurrentOperation.id)?.candidates ?? [];
  }, [sepaCurrentOperation, sepaOperationCandidates]);

  const sepaApprovedInvoiceIds = useMemo(() => {
    return (Object.values(sepaLineDecisions) as SepaOperationDecision[])
      .filter((decision) => decision.status === "approved")
      .flatMap((decision) => decision.selectedInvoiceIds)
      .filter((value, index, array) => array.indexOf(value) === index);
  }, [sepaLineDecisions]);

  const sepaSummary = useMemo(() => {
    if (!sepaBatch) {
      return { approved: 0, rejected: 0, review: 0, pending: 0 };
    }

    return sepaBatch.operations.reduce(
      (acc, op) => {
        const status = sepaLineDecisions[op.id]?.status ?? "pending";
        acc[status] += 1;
        return acc;
      },
      { approved: 0, rejected: 0, review: 0, pending: 0 } as Record<SepaOperationDecisionStatus, number>,
    );
  }, [sepaBatch, sepaLineDecisions]);

  const sepaCanFinalize = useMemo(() => {
    if (!sepaBatch || !sepaDialogTxn) return false;
    return sepaBatch.operations.every((op) => {
      const decision = sepaLineDecisions[op.id];
      if (!decision) return false;
      if (decision.status === "approved") return decision.selectedInvoiceIds.length > 0;
      return decision.status === "rejected" || decision.status === "review";
    });
  }, [sepaBatch, sepaDialogTxn, sepaLineDecisions]);

  const sepaInvoicesTotal = useMemo(() => {
    return (Object.values(sepaLineDecisions) as SepaOperationDecision[])
      .filter((decision) => decision.status === "approved")
      .map((decision) => getSepaDecisionAmount(decision, invoices))
      .reduce((sum, value) => sum + value, 0);
  }, [invoices, sepaLineDecisions]);

  const activeFiltersCount = (currencyFilter === "all" ? 0 : 1) + (scopeFilter === "all" ? 0 : 1);

 const openInvoicePdf = (inv: Invoice) => {
  if (inv.pdfUrl) {
    setPreviewPdfUrl(inv.pdfUrl);
    setPreviewPdfTitle(`${inv.invoiceNumber} — ${inv.vendorCustomer}`);
  } else {
    toast.info("Visualisation PDF non disponible pour cette facture.");
  }
};

  const openSepaDialog = (txn: BankTransaction) => {
    setSepaDialogTxnId(txn.id);
    setSepaCurrentOperationIndex(0);
    const batch = getSepaBatchForTransaction(txn);

    if (batch) {
      setSepaLineDecisions(
        Object.fromEntries(
          batch.operations.map((op) => [
            op.id,
            { status: "pending", selectedInvoiceIds: [] } satisfies SepaOperationDecision,
          ]),
        ),
      );
    } else {
      setSepaLineDecisions({});
    }
  };

  const toggleSepaInvoiceSelection = (operationId: string, invoiceId: string) => {
    setSepaLineDecisions((prev) => {
      const current = prev[operationId] ?? { status: "pending", selectedInvoiceIds: [] };
      const selectedInvoiceIds = current.selectedInvoiceIds.includes(invoiceId)
        ? current.selectedInvoiceIds.filter((id) => id !== invoiceId)
        : [...current.selectedInvoiceIds, invoiceId];

      return {
        ...prev,
        [operationId]: {
          ...current,
          selectedInvoiceIds,
          status: selectedInvoiceIds.length > 0 ? "approved" : "pending",
        },
      };
    });
  };

  const goToNextSepaOperation = () => {
    if (!sepaBatch) return;
    setSepaCurrentOperationIndex((prev) => Math.min(prev + 1, sepaBatch.operations.length - 1));
  };

  const goToPreviousSepaOperation = () => {
    setSepaCurrentOperationIndex((prev) => Math.max(prev - 1, 0));
  };

  const approveSepaOperationAndNext = (operationId: string) => {
    setSepaLineDecisions((prev) => {
      const current = prev[operationId] ?? { status: "pending", selectedInvoiceIds: [] };
      if (current.selectedInvoiceIds.length === 0) {
        toast.error("Sélectionne au moins une facture pour cette opération.");
        return prev;
      }
      return {
        ...prev,
        [operationId]: {
          ...current,
          status: "approved",
        },
      };
    });
    goToNextSepaOperation();
  };

  const rejectSepaOperationAndNext = (operationId: string) => {
    setSepaLineDecisions((prev) => ({
      ...prev,
      [operationId]: {
        status: "rejected",
        selectedInvoiceIds: [],
      },
    }));
    goToNextSepaOperation();
  };

  const markSepaOperationForReviewAndNext = (operationId: string) => {
    setSepaLineDecisions((prev) => ({
      ...prev,
      [operationId]: {
        ...(prev[operationId] ?? { selectedInvoiceIds: [] }),
        status: "review",
      },
    }));
    goToNextSepaOperation();
  };

  const renderCurrencyBadge = (currency: CurrencyCode, compact = false) => {
    const badge = getAccountBadge(currency);
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${getCurrencyBadgeClass(currency)}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
        {compact ? badge.short : badge.label}
      </span>
    );
  };

  return (
    <div className="space-y-6">
   
    <Card>
  <CardContent className="p-4">
    <div className="flex items-center justify-between mb-3">
  <div className="flex items-center gap-2">
    <button
      onClick={() => setShowBackendSuggestions((prev) => !prev)}
      className="text-sm font-medium flex items-center gap-1"
    >
      {showBackendSuggestions ? "▼" : "▶"} Suggestions backend
    </button>
  </div>

  <Button variant="outline" size="sm" onClick={loadBackendSuggestions}>
    Recharger
  </Button>
</div>
{showBackendSuggestions && (
  <>
    {loadingSuggestions ? (
      <p className="text-sm text-muted-foreground">Chargement...</p>
    ) : backendSuggestions.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        Aucune suggestion backend trouvée.
      </p>
    ) : (
      <div className="space-y-3">
  {backendSuggestions.map((item) => (
    <Card key={item.transactionId} className="animate-fade-in">
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="space-y-1 rounded-lg bg-muted p-3 lg:w-1/3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Transaction backend
              </span>
              <span className="rounded-full bg-muted px-2 py-1 text-xs">
                {item.matches.length} suggestion(s)
              </span>
            </div>

            <p className="text-sm font-medium">{item.label}</p>

            <p
              className={`font-mono text-lg font-bold ${
                item.amount < 0 ? "text-destructive" : "text-success"
              }`}
            >
              {formatCurrency(item.amount, item.currency)}
            </p>

            <p className="text-xs text-muted-foreground">{item.currency}</p>
          </div>

          <div className="flex-1 space-y-2">
            {item.matches.map((match, index) => {
  const expandKey = `${item.transactionId}-${index}`;
  const isExpanded = expandedSuggestions.has(expandKey);

  return (
    <Collapsible
      key={index}
      open={isExpanded}
      onOpenChange={() => toggleExpand(expandKey)}
    >
      <div className="rounded-lg border transition-colors hover:bg-accent/50">
        {"invoiceNumber" in match ? (
          <>
            <div className="flex items-center justify-between p-3">
              <CollapsibleTrigger asChild>
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {match.vendorCustomer}
                      </span>

                      <span className="font-mono text-xs text-primary">
                        {match.invoiceNumber}
                      </span>

                      {match.pdfUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewPdfUrl(match.pdfUrl);
                            setPreviewPdfTitle(
                              `${match.invoiceNumber} — ${match.vendorCustomer}`
                            );
                          }}
                        >
                          Voir PDF
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {match.invoiceDate && (
                        <span>{formatDate(match.invoiceDate)}</span>
                      )}
                      <span className="font-mono">
                        {formatCurrency(match.amount, item.currency)}
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                          match.score >= 70
                            ? "bg-success/15 text-success"
                            : match.score >= 40
                            ? "bg-warning/15 text-warning"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {match.score}% match
                      </span>
                    </div>
                  </div>
                </button>
              </CollapsibleTrigger>

              <Button
                size="sm"
                variant="outline"
                className="ml-2 shrink-0"
                onClick={() =>
                  handleReconcile(item.transactionId, match.invoiceId)
                }
              >
                Valider
              </Button>
            </div>

            <CollapsibleContent>
              <div className="px-3 pb-3 pt-0">
                <div className="space-y-3 rounded-md bg-muted/50 p-3 text-sm">
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Détail facture
                    </p>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Hash className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">N° :</span>
                        <span className="font-mono font-medium">
                          {match.invoiceNumber}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Tag className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Type :</span>
                        <span className="font-medium">
                          {match.invoiceType === "purchase" ? "Achat" : "Vente"}
                        </span>
                      </div>

                      {match.invoiceDate && (
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Date :</span>
                          <span>{formatDate(match.invoiceDate)}</span>
                        </div>
                      )}

                      {match.dueDate && (
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Échéance :</span>
                          <span>{formatDate(match.dueDate)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {match.details && (
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        {match.details.amountDiff === 0 ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                        ) : (
                          <Info className="h-3.5 w-3.5 shrink-0 text-primary" />
                        )}
                        <span>
                          Écart montant :{" "}
                          <span className="font-mono font-medium">
                            {formatCurrency(match.details.amountDiff, item.currency)}
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {match.details.directionMatch ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                        )}
                        <span>
                          Sens : {match.details.directionMatch ? "cohérent" : "incohérent"}
                        </span>
                      </div>

                      {typeof match.details.daysDiffInvoice === "number" && (
                        <div className="flex items-center gap-2">
                          <Info className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span>
                            Écart avec date facture : {match.details.daysDiffInvoice} j
                          </span>
                        </div>
                      )}

                      {typeof match.details.daysDiffDue === "number" && (
                        <div className="flex items-center gap-2">
                          <Info className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span>
                            Écart avec échéance : {match.details.daysDiffDue} j
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {!!match.reasons?.length && (
                    <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                      {match.reasons.map((reason) => (
                        <span
                          key={reason}
                          className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3 border-t border-border pt-1 text-xs">
                    <span className="text-muted-foreground">Catégorie :</span>
                    <span className="font-medium">{match.category ?? "—"}</span>
                    <span className="ml-2 text-muted-foreground">Statut :</span>
                    <span className="font-medium">{match.status ?? "—"}</span>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between p-3">
              <CollapsibleTrigger asChild>
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        Paiement groupé SEPA
                      </span>
                      <span className="font-mono text-xs text-primary">
                        {match.invoiceNumbers.join(", ")}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">
                        {formatCurrency(match.total, item.currency)}
                      </span>
                      <span className="rounded-full px-1.5 py-0.5 text-xs font-medium bg-success/15 text-success">
                        {match.score}% match
                      </span>
                    </div>
                  </div>
                </button>
              </CollapsibleTrigger>

              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  handleReconcileBatch(item.transactionId, match.invoiceIds)
                }
              >
                Valider SEPA
              </Button>
            </div>

            <CollapsibleContent>
              <div className="px-3 pb-3 pt-0">
                <div className="space-y-3 rounded-md bg-muted/50 p-3 text-sm">
                  {match.details && (
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <Info className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>
                          Écart montant :{" "}
                          <span className="font-mono font-medium">
                            {formatCurrency(match.details.amountDiff, item.currency)}
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Info className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span>Nombre de factures : {match.details.invoiceCount}</span>
                      </div>
                    </div>
                  )}

                  {!!match.reasons?.length && (
                    <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                      {match.reasons.map((reason) => (
                        <span
                          key={reason}
                          className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </>
        )}
      </div>
    </Collapsible>
  );
})}

            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleUnreconcile(item.transactionId)}
              >
                Annuler
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  ))}
</div>
    )}
     </>
)}
  </CardContent>
</Card>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rapprochement bancaire</h1>
          <p className="text-muted-foreground">
            {unreconciled.length} opération(s) non rapprochée(s) · {reconciled.length} rapprochée(s)
          </p>
        </div>

        <Card className="border-0 shadow-sm xl:min-w-[520px]">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Filtres</p>
                <p className="text-xs text-muted-foreground">
                  Filtrer les opérations bancaires, prélèvements et lots SEPA par devise ou par type.
                </p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                {activeFiltersCount} filtre(s) actif(s)
              </span>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Devise</p>
              <div className="flex flex-wrap gap-2">
                {(["all", "EUR", "MAD", "USD"] as const).map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={currencyFilter === value ? "default" : "outline"}
                    onClick={() => setCurrencyFilter(value)}
                  >
                    {value === "all" ? "Toutes" : getAccountBadge(value).short}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Portée</p>
              <div className="flex flex-wrap gap-2">
                {([
                  ["all", "Tout"],
                  ["bank", "Banque hors SEPA"],
                  ["sepa", "SEPA décaissements"],
                  ["prelevement", "Prélèvements"],
                ] as const).map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={scopeFilter === value ? "default" : "outline"}
                    onClick={() => setScopeFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Opérations non rapprochées"
          value={`${unreconciledNonSepa.length}`}
          subtitle={`${formatCurrency(unreconciledNonSepa.reduce((sum, t) => sum + Math.abs(t.amount), 0), currencyFilter === "all" ? "EUR" : currencyFilter)} total`}
          icon={ArrowLeftRight}
          variant="destructive"
          onClick={() => scrollToSection(unreconciledRef)}
        />

        <StatCard
          title="Opérations rapprochées"
          value={`${reconciledNonSepa.length}`}
          subtitle={`${formatCurrency(reconciledNonSepa.reduce((sum, t) => sum + Math.abs(t.amount), 0), currencyFilter === "all" ? "EUR" : currencyFilter)} total`}
          icon={Check}
          variant="success"
          onClick={() => scrollToSection(reconciledRef)}
        />

        <StatCard
          title="SEPA décaissements en attente"
          value={`${sepaUnreconciled.length}`}
          subtitle="Décaissements à traiter"
          icon={AlertTriangle}
          variant="warning"
          onClick={() => scrollToSection(sepaPendingRef)}
        />

        <StatCard
          title="SEPA décaissements rapprochés"
          value={`${sepaReconciledTxns.length}`}
          subtitle="Lots validés"
          icon={Info}
          variant="info"
          onClick={() => scrollToSection(sepaReconciledRef)}
        />
      </div>

      <div className="space-y-4" ref={unreconciledRef}>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ArrowLeftRight className="h-5 w-5 text-primary" />
          Opérations non rapprochées
        </h2>

        {unreconciledNonSepa.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <p className="font-medium">Aucune opération non rapprochée hors SEPA pour ce filtre.</p>
            </CardContent>
          </Card>
        ) : (
          unreconciledNonSepa.map((txn) => {
            const matches = suggestions.get(txn.id) || [];
            const txnCurrency = getTransactionCurrency(txn);

            return (
              <Card key={txn.id} className="animate-fade-in">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <div className="space-y-1 rounded-lg bg-muted p-3 lg:w-1/3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{formatDate(txn.txnDate)}</span>
                        <span className="font-mono text-xs text-muted-foreground">{txn.reference}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{txn.label}</p>
                        {renderCurrencyBadge(txnCurrency, true)}
                      </div>
                      <p className={`font-mono text-lg font-bold ${txn.amount < 0 ? "text-destructive" : "text-success"}`}>
                        {formatCurrency(txn.amount, getTransactionCurrency(txn))}
                      </p>
                      {txn.balance !== undefined && (
                        <p className="text-xs text-muted-foreground">Solde après : {formatCurrency(txn.balance, txnCurrency)}</p>
                      )}
                    </div>

                    <ArrowRight className="mt-6 hidden h-5 w-5 shrink-0 text-muted-foreground lg:block" />

                    <div className="flex-1 space-y-2">
                      {matches.length === 0 ? (
                        <p className="py-4 text-sm text-muted-foreground">Aucune suggestion trouvée</p>
                      ) : rejectedSuggestionTxns.has(txn.id) ? (
                        <div className="space-y-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                          <div className="flex items-center justify-between gap-2">
                            <span>Aucune proposition n&apos;a été retenue pour cette opération.</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() =>
                                setRejectedSuggestionTxns((prev) => {
                                  const next = new Set(prev);
                                  next.delete(txn.id);
                                  return next;
                                })
                              }
                            >
                              Réafficher les propositions
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {matches.map(({ invoice, score }) => {
                            const expandKey = `${txn.id}-${invoice.id}`;
                            const isExpanded = expandedSuggestions.has(expandKey);
                            const details = getMatchDetails(txn, invoice);

                            return (
                              <Collapsible key={invoice.id} open={isExpanded} onOpenChange={() => toggleExpand(expandKey)}>
                                <div className="rounded-lg border transition-colors hover:bg-accent/50">
                                  <div className="flex items-center justify-between p-3">
                                    <CollapsibleTrigger asChild>
                                      <button className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                        {isExpanded ? (
                                          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        ) : (
                                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        )}
                                        <div className="min-w-0 space-y-0.5">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-medium">{invoice.vendorCustomer}</span>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openInvoicePdf(invoice);
                                              }}
                                              className="font-mono text-xs text-primary hover:underline"
                                            >
                                              {invoice.invoiceNumber}
                                            </button>
                                            
                                          </div>
                                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span>{formatDate(invoice.invoiceDate)}</span>
                                            <span className="font-mono">{formatCurrency(invoice.amountGross, getInvoiceCurrency(invoice))}</span>
                                            <span
                                              className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                                                score >= 70
                                                  ? "bg-success/15 text-success"
                                                  : score >= 40
                                                    ? "bg-warning/15 text-warning"
                                                    : "bg-muted text-muted-foreground"
                                              }`}
                                            >
                                              {score}% match
                                            </span>
                                          </div>
                                        </div>
                                      </button>
                                    </CollapsibleTrigger>

                                    <Button size="sm" variant="outline" className="ml-2 shrink-0" onClick={() => handleReconcile(txn.id, invoice.id)}>
                                      <Check className="mr-1 h-3.5 w-3.5" />
                                      Rapprocher
                                    </Button>
                                  </div>

                                  <CollapsibleContent>
                                    <div className="px-3 pb-3 pt-0">
                                      <div className="space-y-3 rounded-md bg-muted/50 p-3 text-sm">
                                        <div>
                                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Détail facture
                                          </p>
                                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                            <div className="flex items-center gap-1.5">
                                              <Hash className="h-3 w-3 text-muted-foreground" />
                                              <span className="text-muted-foreground">N° :</span>
                                              <span className="font-mono font-medium">{invoice.invoiceNumber}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                              <Tag className="h-3 w-3 text-muted-foreground" />
                                              <span className="text-muted-foreground">Type :</span>
                                              <span className="font-medium">{invoice.type === "purchase" ? "Achat" : "Vente"}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                              <CalendarDays className="h-3 w-3 text-muted-foreground" />
                                              <span className="text-muted-foreground">Date :</span>
                                              <span>{formatDate(invoice.invoiceDate)}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                              <CalendarDays className="h-3 w-3 text-muted-foreground" />
                                              <span className="text-muted-foreground">Échéance :</span>
                                              <span>{formatDate(invoice.dueDate)}</span>
                                            </div>
                                          </div>
                                        </div>

                                        <div className="space-y-1.5 text-xs">
                                          <div className="flex items-center gap-2">
                                            {details.amountDiff === 0 ? (
                                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                                            ) : (
                                              <Info className="h-3.5 w-3.5 shrink-0 text-primary" />
                                            )}
                                            <span>Écart montant : <span className="font-mono font-medium">{formatCurrency(details.amountDiff, txnCurrency)}</span></span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {details.directionMatch ? (
                                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                                            ) : (
                                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                                            )}
                                            <span>
                                              Sens : {details.directionMatch ? "cohérent" : "incohérent"}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-3 border-t border-border pt-1 text-xs">
                                          <span className="text-muted-foreground">Catégorie :</span>
                                          <span className="font-medium">{invoice.category}</span>
                                          <span className="ml-2 text-muted-foreground">Statut :</span>
                                          <StatusBadge status={invoice.status} />
                                        </div>
                                      </div>
                                    </div>
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            );
                          })}

                          <div className="flex justify-end pt-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() =>
                                setRejectedSuggestionTxns((prev) => {
                                  const next = new Set(prev);
                                  next.add(txn.id);
                                  return next;
                                })
                              }
                            >
                              Rejeter toutes les propositions
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <div className="space-y-4" ref={sepaPendingRef}>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <AlertTriangle className="h-5 w-5 text-warning" />
          SEPA décaissements en attente
        </h2>

        {sepaUnreconciled.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <p className="font-medium">Aucun lot SEPA en attente pour ce filtre.</p>
            </CardContent>
          </Card>
        ) : (
          sepaUnreconciled.map((txn) => {
            const batch = getSepaBatchForTransaction(txn);
            return (
              <Card key={txn.id} className="animate-fade-in">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <div className="space-y-1 rounded-2xl bg-muted/60 p-4 lg:w-1/3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{formatDate(txn.txnDate)}</span>
                        <span className="font-mono text-xs text-muted-foreground">{txn.reference}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{txn.label}</p>
                        {renderCurrencyBadge(getTransactionCurrency(txn), true)}
                      </div>
                      <p className={`font-mono text-lg font-bold ${txn.amount < 0 ? "text-destructive" : "text-success"}`}>
                        {formatCurrency(txn.amount, getTransactionCurrency(txn))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {batch?.operations.length ?? 0} opération(s) dans le lot
                      </p>
                    </div>

                    <div className="flex-1 rounded-2xl border bg-background p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold">Traitement du lot SEPA</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Chaque opération du lot est à traiter individuellement avec ses factures suggérées.
                          </p>
                        </div>
                        <Button onClick={() => openSepaDialog(txn)}>
                          Traiter le lot
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {reconciledNonSepa.length > 0 && (
        <div className="space-y-3" ref={reconciledRef}>
          <h2 className="text-lg font-semibold">Opérations rapprochées</h2>

          {reconciledNonSepa.map((txn) => {
            const matchedInvs = (txn.matchedInvoiceIds ?? [])
              .map((id) => invoices.find((i) => i.id === id))
              .filter((i): i is Invoice => Boolean(i));

            return (
              <Card
                key={txn.id}
                className="cursor-pointer border-success/30 transition-colors hover:bg-accent/30"
                onClick={() => setDetailsTxnId(txn.id)}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <StatusBadge status={txn.reconciledStatus} />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{txn.label}</p>
                        {renderCurrencyBadge(getTransactionCurrency(txn), true)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(txn.txnDate)} · {formatCurrency(txn.amount, getTransactionCurrency(txn))}
                        {matchedInvs.length === 1 && ` → ${matchedInvs[0].vendorCustomer} (${matchedInvs[0].invoiceNumber})`}
                        {matchedInvs.length > 1 && ` → ${matchedInvs.length} factures`}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnreconcile(txn.id);
                    }}
                  >
                    <Undo2 className="mr-1 h-3.5 w-3.5" />
                    Annuler
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {sepaReconciledTxns.length > 0 && (
        <div className="space-y-3" ref={sepaReconciledRef}>
          <h2 className="text-lg font-semibold">SEPA décaissements rapprochés</h2>

          {sepaReconciledTxns.map((txn) => {
            const matchedInvs = (txn.matchedInvoiceIds ?? [])
              .map((id) => invoices.find((i) => i.id === id))
              .filter((i): i is Invoice => Boolean(i));

            return (
              <Card
                key={txn.id}
                className="cursor-pointer border-success/30 transition-colors hover:bg-accent/30"
                onClick={() => setDetailsTxnId(txn.id)}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <StatusBadge status={txn.reconciledStatus} />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{txn.label}</p>
                        {renderCurrencyBadge(getTransactionCurrency(txn), true)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(txn.txnDate)} · {formatCurrency(txn.amount, getTransactionCurrency(txn))}
                        {matchedInvs.length > 0 && ` → ${matchedInvs.length} facture(s)`}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnreconcile(txn.id);
                    }}
                  >
                    <Undo2 className="mr-1 h-3.5 w-3.5" />
                    Annuler
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={detailsTxnId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailsTxnId(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Détails du rapprochement</DialogTitle>
            <DialogDescription>
              {selectedDetailsTxn ? `Opération du ${formatDate(selectedDetailsTxn.txnDate)}` : "—"}
            </DialogDescription>
          </DialogHeader>

          {!selectedDetailsTxn ? (
            <div className="text-sm text-muted-foreground">Aucun rapprochement sélectionné.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Opération bancaire
                  </p>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Date</span>
                      <span className="font-medium">{formatDate(selectedDetailsTxn.txnDate)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Référence</span>
                      <span className="font-mono text-xs">{selectedDetailsTxn.reference}</span>
                    </div>
                    <div className="pt-1">
                      <p className="text-xs text-muted-foreground">Libellé</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="font-medium">{selectedDetailsTxn.label}</p>
                        {renderCurrencyBadge(getTransactionCurrency(selectedDetailsTxn), true)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <span className="text-muted-foreground">Montant</span>
                      <span className={`font-mono font-bold ${selectedDetailsTxn.amount < 0 ? "text-destructive" : "text-success"}`}>
                        {formatCurrency(selectedDetailsTxn.amount, getTransactionCurrency(selectedDetailsTxn))}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Facture(s) liée(s)
                  </p>

                  {selectedDetailsInvoices.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Aucune facture associée.</div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      {selectedDetailsInvoices.map((inv) => (
                        <div key={inv.id} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => openInvoicePdf(inv)} className="font-mono text-xs text-primary hover:underline">
                                {inv.invoiceNumber}
                              </button>
                              <span className="font-medium">{inv.vendorCustomer}</span>
                              
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span>{formatDate(inv.invoiceDate)}</span>
                              <span>Éch. {formatDate(inv.dueDate)}</span>
                              <span className="font-mono">{formatCurrency(inv.amountGross, getInvoiceCurrency(inv))}</span>
                            </div>
                          </div>
                          <StatusBadge status={inv.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (selectedDetailsTxn) handleUnreconcile(selectedDetailsTxn.id);
                    setDetailsTxnId(null);
                  }}
                >
                  <Undo2 className="mr-1.5 h-4 w-4" />
                  Annuler le rapprochement
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
<Dialog
  open={previewPdfUrl !== null}
  onOpenChange={(open) => {
    if (!open) {
      setPreviewPdfUrl(null);
      setPreviewPdfTitle("");
    }
  }}
>
  <DialogContent className="max-w-7xl h-[92vh] p-0 overflow-hidden">
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1.4fr_0.9fr]">
      <div className="h-full border-r bg-muted/20">
        {previewPdfUrl ? (
          <iframe
            src={previewPdfUrl}
            title={previewPdfTitle}
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Aucun PDF sélectionné.
          </div>
        )}
      </div>

      <div className="flex h-full flex-col">
        <div className="border-b px-6 py-4">
          <h2 className="text-xl font-semibold">Aperçu de la facture</h2>
          <p className="text-sm text-muted-foreground">{previewPdfTitle}</p>
        </div>

        <div className="space-y-4 overflow-auto p-6">
          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Document</p>
            <p className="font-medium">{previewPdfTitle}</p>
          </div>

          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Statut</p>
            <p className="font-medium">Disponible</p>
          </div>

          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Source</p>
            <p className="font-medium">Backend / uploads</p>
          </div>
        </div>
      </div>
    </div>
  </DialogContent>
</Dialog>
      <Dialog
        open={sepaDialogTxnId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSepaDialogTxnId(null);
            setSepaCurrentOperationIndex(0);
          }
        }}
      >
        <DialogContent className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Rapprochement SEPA</DialogTitle>
            <DialogDescription>
              {sepaDialogTxn
                ? `${formatDate(sepaDialogTxn.txnDate)} · ${sepaDialogTxn.label} · ${formatCurrency(sepaDialogTxn.amount, getTransactionCurrency(sepaDialogTxn))}`
                : "—"}
            </DialogDescription>
          </DialogHeader>

          {!sepaDialogTxn || !sepaBatch ? (
            <div className="text-sm text-muted-foreground">Aucun lot SEPA sélectionné.</div>
          ) : (
            <ScrollArea className="max-h-[82vh] pr-4">
              <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
                <div className="space-y-4">
                  <Card className="border-0 shadow-sm">
                    <CardContent className="space-y-4 p-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lot banque</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{sepaBatch.label}</p>
                          {renderCurrencyBadge(getTransactionCurrency(sepaDialogTxn), true)}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(sepaDialogTxn.txnDate)} · Réf. {sepaDialogTxn.reference}
                        </p>
                      </div>

                      <div className="grid gap-2 rounded-2xl border bg-muted/30 p-3 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Montant banque</span>
                          <span className="font-mono font-semibold">{formatCurrency(sepaDialogTxn.amount, getTransactionCurrency(sepaDialogTxn))}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Sous-opérations</span>
                          <span className="font-medium">{sepaBatch.operations.length}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Factures retenues</span>
                          <span className="font-mono font-semibold">{formatCurrency(sepaInvoicesTotal, getTransactionCurrency(sepaDialogTxn))}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl border p-3">
                          <p className="text-muted-foreground">Rapprochées</p>
                          <p className="mt-1 text-lg font-semibold">{sepaSummary.approved}</p>
                        </div>
                        <div className="rounded-xl border p-3">
                          <p className="text-muted-foreground">Rejetées</p>
                          <p className="mt-1 text-lg font-semibold">{sepaSummary.rejected}</p>
                        </div>
                        <div className="rounded-xl border p-3">
                          <p className="text-muted-foreground">À revoir</p>
                          <p className="mt-1 text-lg font-semibold">{sepaSummary.review}</p>
                        </div>
                        <div className="rounded-xl border p-3">
                          <p className="text-muted-foreground">En attente</p>
                          <p className="mt-1 text-lg font-semibold">{sepaSummary.pending}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">Opérations du lot</p>
                        <span className="text-xs text-muted-foreground">
                          {sepaCurrentOperationIndex + 1}/{sepaBatch.operations.length}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {sepaBatch.operations.map((op, index) => {
                          const decision = sepaLineDecisions[op.id] ?? { status: "pending", selectedInvoiceIds: [] };
                          const selectedAmount = getSepaDecisionAmount(decision, invoices);
                          const isCurrent = sepaCurrentOperation?.id === op.id;

                          return (
                            <button
                              key={op.id}
                              type="button"
                              onClick={() => setSepaCurrentOperationIndex(index)}
                              className={`w-full rounded-2xl border p-3 text-left transition ${
                                isCurrent ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{op.creditorName}</p>
                                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{op.remittanceInfo}</p>
                                </div>
                                <div className="text-right">
                                  <p className="font-mono text-xs font-medium">{formatCurrency(sepaDialogTxn.amount < 0 ? -op.amount : op.amount, getTransactionCurrency(sepaDialogTxn))}</p>
                                  <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${getDecisionBadgeClass(decision.status)}`}>
                                    {getDecisionLabel(decision.status)}
                                  </span>
                                </div>
                              </div>

                              {decision.selectedInvoiceIds.length > 0 && (
                                <div className="mt-2 text-[11px] text-muted-foreground">
                                  {decision.selectedInvoiceIds.length} facture(s) · {formatCurrency(selectedAmount, getTransactionCurrency(sepaDialogTxn))}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-4">
                  {!sepaCurrentOperation ? (
                    <Card>
                      <CardContent className="p-6 text-sm text-muted-foreground">Aucune opération SEPA de décaissement.</CardContent>
                    </Card>
                  ) : (
                    <>
                      <Card className="border-0 shadow-sm">
                        <CardContent className="p-5">
                          <div className="grid gap-4 lg:grid-cols-[320px,1fr] lg:items-start">
                            <div className="rounded-3xl bg-muted/50 p-5">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-xs text-muted-foreground">{formatDate(sepaDialogTxn.txnDate)}</span>
                                <span className="font-mono text-xs text-muted-foreground">{sepaCurrentOperation.endToEndId}</span>
                              </div>
                              <p className="mt-3 text-xl font-semibold leading-tight">{sepaCurrentOperation.creditorName}</p>
                              <p className="mt-2 text-sm text-muted-foreground">{sepaCurrentOperation.remittanceInfo}</p>
                              <div className="mt-3">{renderCurrencyBadge(getTransactionCurrency(sepaDialogTxn), true)}</div>
                              <p className={`mt-5 font-mono text-2xl font-bold ${sepaDialogTxn.amount < 0 ? "text-destructive" : "text-success"}`}>
                                {formatCurrency(sepaDialogTxn.amount < 0 ? -sepaCurrentOperation.amount : sepaCurrentOperation.amount, getTransactionCurrency(sepaDialogTxn))}
                              </p>
                            </div>

                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <h3 className="text-base font-semibold">Factures suggérées</h3>
                                  <p className="text-sm text-muted-foreground">
                                    Structure prête pour l&apos;IA : score, raisons de match et validation manuelle.
                                  </p>
                                </div>
                                <span className={`rounded-full px-3 py-1 text-xs font-medium ${getDecisionBadgeClass(sepaLineDecisions[sepaCurrentOperation.id]?.status ?? "pending")}`}>
                                  {getDecisionLabel(sepaLineDecisions[sepaCurrentOperation.id]?.status ?? "pending")}
                                </span>
                              </div>

                              {sepaCurrentCandidates.length === 0 ? (
                                <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                                  Aucune facture suggérée pour cette opération. Tu peux la rejeter, la marquer à revoir, ou la traiter plus tard.
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {sepaCurrentCandidates.map((candidate) => {
                                    const selectedIds = sepaLineDecisions[sepaCurrentOperation.id]?.selectedInvoiceIds ?? [];
                                    const isSelected = selectedIds.includes(candidate.invoice.id);
                                    const diff = Math.abs(sepaCurrentOperation.amount - candidate.invoice.amountGross);

                                    return (
                                      <div
                                        key={candidate.invoice.id}
                                        className={`rounded-2xl border p-4 transition ${
                                          isSelected ? "border-primary bg-primary/5 shadow-sm" : "hover:bg-muted/30"
                                        }`}
                                      >
                                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                          <button
                                            type="button"
                                            onClick={() => toggleSepaInvoiceSelection(sepaCurrentOperation.id, candidate.invoice.id)}
                                            className="flex-1 text-left"
                                          >
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="text-lg font-semibold">{candidate.invoice.vendorCustomer}</span>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  openInvoicePdf(candidate.invoice);
                                                }}
                                                className="font-mono text-sm text-primary hover:underline"
                                              >
                                                {candidate.invoice.invoiceNumber}
                                              </button>
                                              
                                            </div>
                                            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                                              <span>{formatDate(candidate.invoice.invoiceDate)}</span>
                                              <span className="font-mono">{formatCurrency(candidate.invoice.amountGross, getInvoiceCurrency(candidate.invoice))}</span>
                                              <span
                                                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                                  candidate.score >= 75
                                                    ? "bg-success/15 text-success"
                                                    : candidate.score >= 45
                                                      ? "bg-warning/15 text-warning"
                                                      : "bg-muted text-muted-foreground"
                                                }`}
                                              >
                                                {candidate.score}% match
                                              </span>
                                            </div>

                                            {candidate.reasons.length > 0 && (
                                              <div className="mt-3 flex flex-wrap gap-2">
                                                {candidate.reasons.map((reason) => (
                                                  <span key={reason} className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                                                    {reason}
                                                  </span>
                                                ))}
                                              </div>
                                            )}
                                          </button>

                                          <div className="flex flex-col items-stretch gap-2 lg:w-[160px]">
                                            <Button
                                              variant={isSelected ? "default" : "outline"}
                                              onClick={() => toggleSepaInvoiceSelection(sepaCurrentOperation.id, candidate.invoice.id)}
                                            >
                                              {isSelected ? "Sélectionnée" : "Sélectionner"}
                                            </Button>
                                            <div className="rounded-xl bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
                                              Écart {formatCurrency(diff, getTransactionCurrency(sepaDialogTxn))}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-5 grid gap-3 md:grid-cols-3">
                            <div className="rounded-xl border p-3">
                              <p className="text-xs text-muted-foreground">Factures sélectionnées</p>
                              <p className="mt-1 text-lg font-semibold">
                                {sepaLineDecisions[sepaCurrentOperation.id]?.selectedInvoiceIds.length ?? 0}
                              </p>
                            </div>
                            <div className="rounded-xl border p-3">
                              <p className="text-xs text-muted-foreground">Montant sélectionné</p>
                              <p className="mt-1 font-mono text-lg font-semibold">
                                {formatCurrency(getSepaDecisionAmount(sepaLineDecisions[sepaCurrentOperation.id] ?? { status: "pending", selectedInvoiceIds: [] }, invoices), getTransactionCurrency(sepaDialogTxn))}
                              </p>
                            </div>
                            <div className="rounded-xl border p-3">
                              <p className="text-xs text-muted-foreground">Écart restant</p>
                              <p className="mt-1 font-mono text-lg font-semibold">
                                {formatCurrency(
                                  Math.abs(
                                    sepaCurrentOperation.amount -
                                      getSepaDecisionAmount(
                                        sepaLineDecisions[sepaCurrentOperation.id] ?? { status: "pending", selectedInvoiceIds: [] },
                                        invoices,
                                      ),
                                  ),
                                  getTransactionCurrency(sepaDialogTxn),
                                )}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" disabled={sepaCurrentOperationIndex === 0} onClick={goToPreviousSepaOperation}>
                            Précédente
                          </Button>
                          <Button variant="outline" onClick={() => rejectSepaOperationAndNext(sepaCurrentOperation.id)}>
                            Rejeter & suivant
                          </Button>
                          <Button variant="outline" onClick={() => markSepaOperationForReviewAndNext(sepaCurrentOperation.id)}>
                            À revoir & suivant
                          </Button>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={() => setSepaDialogTxnId(null)}>
                            Fermer
                          </Button>
                          <Button onClick={() => approveSepaOperationAndNext(sepaCurrentOperation.id)}>
                            Rapprocher & suivant
                          </Button>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <Button
                          disabled={!sepaCanFinalize}
                          onClick={() => {
                            if (!sepaCanFinalize || !sepaDialogTxn) {
                              toast.error("Chaque opération doit être rapprochée, rejetée ou marquée à revoir.");
                              return;
                            }

                            const hasNonApproved = sepaBatch.operations.some((op) => {
                              const status = sepaLineDecisions[op.id]?.status;
                              return status === "rejected" || status === "review";
                            });

                            const finalStatus = hasNonApproved ? ("partiel" as const) : ("rapproché" as const);
                            handleReconcileBatch(sepaDialogTxn.id, sepaApprovedInvoiceIds, finalStatus);
                            setSepaDialogTxnId(null);
                          }}
                        >
                          <Check className="mr-1.5 h-4 w-4" />
                          Finaliser le lot
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
    
  );
}
