import {
  useState,
  useMemo,
  useEffect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  formatCurrency,
  type Invoice,
  Eye,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Layers,
  Search,
  RotateCcw,
  CalendarClock,
  Receipt,
  Wallet,
  StatusBadge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  toast,
} from "./imports";

interface CurrencyTotal {
  currency: string;
  amount: number;
}

interface InvoiceBlock {
  id: string;
  label: string;
  invoices: Invoice[];
  totalGrossByCurrency: CurrencyTotal[];
  totalPendingByCurrency: CurrencyTotal[];
  overdueCount: number;
  allReconciled: boolean;
}

interface ReviewDocument {
  _id: string;
  id?: string;
  originalName?: string;
  fileName?: string;
  fileUrl?: string | null;
  destination?: string | null;
  extractedText?: string | null;
  structuredData?: any;
  classification?: any;
  invoiceNature?: string | null;
  documentType?: string | null;
  createdAt?: string;
}

interface ReviewItem {
  _id: string;
  id?: string;
  reason?: string | null;
  status: string;
  documentId: ReviewDocument | null;
  createdAt?: string;
}

type FacturesTab = "purchases" | "sales" | "review";
type CurrencyCode = "EUR" | "MAD" | "USD";

const API_BASE_URL = "";

const monthLabels = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

function isInvoiceReconciled(invoice: Invoice): boolean {
  return invoice.status === "rapprochée";
}

function parseAppDate(value?: string) {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const frMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (frMatch) {
    const [, dd, mm, yyyy] = frMatch;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function safeFormatDate(value?: string) {
  const d = parseAppDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("fr-FR");
}

function isOverdue(invoice: Invoice): boolean {
  if (invoice.status === "rapprochée") return false;

  const due = parseAppDate(invoice.dueDate);
  const today = new Date();

  if (!due) return false;

  const dueDateOnly = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate()
  );
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  return dueDateOnly < todayOnly;
}

function sumByCurrency(invoices: Invoice[]): CurrencyTotal[] {
  const totals = new Map<string, number>();

  for (const invoice of invoices) {
    const currency = invoice.currency || "UNKNOWN";
    const amount = Number(invoice.amountGross || 0);

    totals.set(currency, (totals.get(currency) || 0) + amount);
  }

  return Array.from(totals.entries()).map(([currency, amount]) => ({
    currency,
    amount,
  }));
}

function formatCurrencyGroups(groups: CurrencyTotal[]) {
  if (!groups.length) return "—";

  return groups
    .map(({ currency, amount }) =>
      currency === "UNKNOWN"
        ? `${amount.toFixed(2)} devise inconnue`
        : formatCurrency(amount, currency)
    )
    .join(" · ");
}

function buildMonthlyBlocks(invoices: Invoice[]): InvoiceBlock[] {
  const groups = new Map<string, { label: string; invoices: Invoice[] }>();

  invoices.forEach((inv) => {
    const d = parseAppDate(inv.invoiceDate);
    if (!d) return;

    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${monthLabels[d.getMonth()]} ${d.getFullYear()}`;

    if (!groups.has(key)) {
      groups.set(key, { label, invoices: [] });
    }

    groups.get(key)!.invoices.push(inv);
  });

  const blocks: InvoiceBlock[] = [];

  groups.forEach((value, key) => {
    const invs = [...value.invoices].sort((a, b) => {
      const da = parseAppDate(a.invoiceDate);
      const db = parseAppDate(b.invoiceDate);
      return (db?.getTime() || 0) - (da?.getTime() || 0);
    });

    const pendingInvoices = invs.filter((i) => i.status !== "rapprochée");

    blocks.push({
      id: key,
      label: value.label,
      invoices: invs,
      totalGrossByCurrency: sumByCurrency(invs),
      totalPendingByCurrency: sumByCurrency(pendingInvoices),
      overdueCount: invs.filter(isOverdue).length,
      allReconciled: invs.every((i) => isInvoiceReconciled(i)),
    });
  });

  return blocks.sort((a, b) => b.id.localeCompare(a.id));
}

function getFullPdfUrl(pdfUrl?: string | null) {
  if (!pdfUrl) return null;
  if (pdfUrl.startsWith("http://") || pdfUrl.startsWith("https://")) {
    return pdfUrl;
  }
  return `${API_BASE_URL}${pdfUrl}`;
}

function getDocumentTypeLabel(type?: string | null) {
  switch (type) {
    case "invoice":
      return "Facture";
    case "receipt":
      return "Reçu";
    case "bank_statement":
      return "Relevé bancaire";
    case "sepa_xml":
      return "Fichier SEPA";
    case "unknown":
      return "Inconnu";
    default:
      return "—";
  }
}

export default function Factures() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<FacturesTab>("purchases");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);

  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [loadingReview, setLoadingReview] = useState(true);
  const [processingReviewId, setProcessingReviewId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manualCurrencies, setManualCurrencies] = useState<Record<string, CurrencyCode | "">>({});

  const loadInvoices = async () => {
    try {
      setLoadingInvoices(true);

      const response = await fetch(`${API_BASE_URL}/api/invoices`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erreur chargement factures");
      }

      setInvoices(data.invoices || []);
    } catch (error) {
      console.error("Erreur chargement factures:", error);
      toast.error("Impossible de charger les factures.");
    } finally {
      setLoadingInvoices(false);
    }
  };

  const loadReviewQueue = async () => {
    try {
      setLoadingReview(true);

      const response = await fetch(`${API_BASE_URL}/api/review`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erreur chargement éléments à valider");
      }

      setReviewItems(data.items || []);

      const initialCurrencies: Record<string, CurrencyCode | ""> = {};
      for (const item of data.items || []) {
        const detected = item?.documentId?.classification?.fields?.currency;
        if (detected && ["EUR", "MAD", "USD"].includes(detected)) {
          initialCurrencies[item._id] = detected as CurrencyCode;
        } else {
          initialCurrencies[item._id] = "";
        }
      }
      setManualCurrencies(initialCurrencies);
    } catch (error) {
      console.error("Erreur chargement review:", error);
      toast.error("Impossible de charger les éléments à valider.");
    } finally {
      setLoadingReview(false);
    }
  };

  const classifyReviewItem = async (
    reviewItemId: string,
    decision: "purchase" | "sales"
  ) => {
    try {
      const selectedCurrency = manualCurrencies[reviewItemId];

      if (!selectedCurrency) {
        toast.error("Sélectionne d'abord la devise réelle de la facture.");
        return;
      }

      setProcessingReviewId(reviewItemId);

      const response = await fetch(
        `${API_BASE_URL}/api/review/${reviewItemId}/classify`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            decision,
            currency: selectedCurrency,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erreur pendant la validation");
      }

      toast.success(
        decision === "purchase"
          ? "Document classé en facture d'achat."
          : "Document classé en facture de vente."
      );

      await Promise.all([loadReviewQueue(), loadInvoices()]);
    } catch (error) {
      console.error("Erreur classification review:", error);
      toast.error("Impossible de classer ce document.");
    } finally {
      setProcessingReviewId(null);
    }
  };

  const deleteInvoice = async (invoice: Invoice) => {
    const confirmed = window.confirm(
      `Supprimer définitivement la facture ${invoice.invoiceNumber || ""} ?`
    );

    if (!confirmed) return;

    try {
      setDeletingId(invoice.id);

      const response = await fetch(`${API_BASE_URL}/api/invoices/${invoice.id}`, {
        method: "DELETE",
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Erreur pendant la suppression");
      }

      toast.success("Facture supprimée.");
      await loadInvoices();
    } catch (error) {
      console.error("Erreur suppression facture:", error);
      toast.error("Impossible de supprimer cette facture.");
    } finally {
      setDeletingId(null);
    }
  };

  const deleteReviewItem = async (item: ReviewItem) => {
    const confirmed = window.confirm(
      `Supprimer définitivement cet élément à valider (${item.documentId?.originalName || item.documentId?.fileName || "document"}) ?`
    );

    if (!confirmed) return;

    try {
      setDeletingId(item._id);

      const response = await fetch(`${API_BASE_URL}/api/review/${item._id}`, {
        method: "DELETE",
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Erreur pendant la suppression");
      }

      toast.success("Élément supprimé.");
      await loadReviewQueue();
    } catch (error) {
      console.error("Erreur suppression review:", error);
      toast.error("Impossible de supprimer cet élément.");
    } finally {
      setDeletingId(null);
    }
  };

  const setManualCurrency = (reviewItemId: string, currency: CurrencyCode) => {
    setManualCurrencies((prev) => ({
      ...prev,
      [reviewItemId]: currency,
    }));
  };

  useEffect(() => {
    void Promise.all([loadInvoices(), loadReviewQueue()]);
  }, []);

  const lowerFilter = filter.trim().toLowerCase();

  const years = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach((inv) => {
      const d = parseAppDate(inv.invoiceDate);
      if (d) set.add(String(d.getFullYear()));
    });
    return Array.from(set).sort().reverse();
  }, [invoices]);

  const applyFilters = (inv: Invoice) => {
    if (
      lowerFilter &&
      !inv.vendorCustomer.toLowerCase().includes(lowerFilter) &&
      !inv.invoiceNumber.toLowerCase().includes(lowerFilter) &&
      !inv.category.toLowerCase().includes(lowerFilter)
    ) {
      return false;
    }

    if (statusFilter !== "all" && inv.status !== statusFilter) return false;

    const d = parseAppDate(inv.invoiceDate);
    if (d) {
      if (yearFilter !== "all" && String(d.getFullYear()) !== yearFilter) {
        return false;
      }
      if (monthFilter !== "all" && String(d.getMonth()) !== monthFilter) {
        return false;
      }
    }

    return true;
  };

  const filteredInvoices = useMemo(
    () => invoices.filter(applyFilters),
    [invoices, lowerFilter, statusFilter, monthFilter, yearFilter]
  );

  const purchaseInvoices = useMemo(
    () => filteredInvoices.filter((i) => i.type === "purchase"),
    [filteredInvoices]
  );

  const salesInvoices = useMemo(
    () => filteredInvoices.filter((i) => i.type === "sales"),
    [filteredInvoices]
  );

  const purchaseBlocks = useMemo(
    () => buildMonthlyBlocks(purchaseInvoices),
    [purchaseInvoices]
  );

  const salesBlocks = useMemo(
    () => buildMonthlyBlocks(salesInvoices),
    [salesInvoices]
  );

  const purchaseCount = invoices.filter((i) => i.type === "purchase").length;
  const salesCount = invoices.filter((i) => i.type === "sales").length;
  const reviewCount = reviewItems.filter((item) => item.status === "pending").length;

  const visibleInvoices =
    activeTab === "purchases"
      ? purchaseInvoices
      : activeTab === "sales"
      ? salesInvoices
      : [];

  const summary = useMemo(() => {
    const pendingInvoices = visibleInvoices.filter(
      (inv) => inv.status !== "rapprochée"
    );
    const reconciledInvoices = visibleInvoices.filter(
      (inv) => inv.status === "rapprochée"
    );
    const overdue = visibleInvoices.filter(isOverdue).length;

    return {
      count: visibleInvoices.length,
      totalByCurrency: sumByCurrency(visibleInvoices),
      pendingByCurrency: sumByCurrency(pendingInvoices),
      reconciledByCurrency: sumByCurrency(reconciledInvoices),
      overdue,
    };
  }, [visibleInvoices]);

  const openInvoicePdf = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setShowPreviewDialog(true);
  };

  const openReviewDocument = (item: ReviewItem) => {
    const doc = item.documentId;
    const fields = doc?.classification?.fields || {};
    const selectedCurrency = manualCurrencies[item._id];

    const previewInvoice: Invoice = {
      id: item._id,
      type:
        doc?.invoiceNature === "sales" ||
        doc?.classification?.invoiceNature === "sales"
          ? "sales"
          : "purchase",
      vendorCustomer:
        fields.vendorCustomer ||
        fields.issuerName ||
        fields.recipientName ||
        doc?.originalName ||
        "Document à valider",
      invoiceNumber: fields.invoiceNumber || "—",
      invoiceDate: fields.invoiceDate || "",
      dueDate: fields.dueDate || "",
      status: "non_rapprochée",
      amountNet: Number(fields.amountNet || 0),
      vatAmount: Number(fields.vatAmount || 0),
      amountGross: Number(fields.amountInclVat || 0),
      currency: selectedCurrency || undefined,
      category: "À valider",
      pdfUrl: doc?.fileUrl || null,
    };

    setSelectedInvoice(previewInvoice);
    setShowPreviewDialog(true);
  };

  const toggleBlock = (blockId: string) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  };

  const expandAllBlocks = (blocks: InvoiceBlock[]) => {
    setExpandedBlocks(new Set(blocks.map((b) => b.id)));
  };

  const collapseAllBlocks = () => {
    setExpandedBlocks(new Set());
  };

  const resetFilters = () => {
    setFilter("");
    setStatusFilter("all");
    setMonthFilter("all");
    setYearFilter("all");
    toast.success("Filtres réinitialisés.");
  };

  const refreshAll = async () => {
    await Promise.all([loadInvoices(), loadReviewQueue()]);
  };

  const renderBlocks = (blocks: InvoiceBlock[], typeLabel: string) => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
        <div>
          <p className="text-sm font-medium text-foreground">Vue mensuelle</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => expandAllBlocks(blocks)}>
            Tout déplier
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAllBlocks}>
            Tout replier
          </Button>
        </div>
      </div>

      {blocks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center text-muted-foreground">
            <Layers className="mx-auto mb-3 h-12 w-12 text-muted-foreground/40" />
            <p className="font-medium">Aucun résultat</p>
            <p className="text-sm">
              Aucune facture {typeLabel} ne correspond aux filtres actuels.
            </p>
          </CardContent>
        </Card>
      ) : (
        blocks.map((block) => {
          const isExpanded = expandedBlocks.has(block.id);

          return (
            <Card key={block.id} className="overflow-hidden border shadow-sm">
              <Collapsible
                open={isExpanded}
                onOpenChange={() => toggleBlock(block.id)}
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between bg-card px-4 py-4 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="rounded-lg bg-primary/10 p-2">
                        <Layers className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {block.label}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{block.invoices.length} facture(s)</span>
                          <span>
                            Total : {formatCurrencyGroups(block.totalGrossByCurrency)}
                          </span>
                          <span>
                            À rapprocher : {formatCurrencyGroups(
                              block.totalPendingByCurrency
                            )}
                          </span>
                          {block.overdueCount > 0 && (
                            <span className="font-medium text-warning">
                              {block.overdueCount} échéance(s) dépassée(s)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="ml-4 flex shrink-0 items-center gap-2">
                      {block.allReconciled ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Tout rapproché
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-medium text-warning">
                          <AlertCircle className="h-3.5 w-3.5" />
                          À traiter
                        </span>
                      )}
                    </div>
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="border-t bg-muted/10 p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/20">
                          <TableHead>
                            {typeLabel === "d'achat" ? "Fournisseur" : "Client"}
                          </TableHead>
                          <TableHead>N° facture</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Échéance</TableHead>
                          <TableHead className="text-right">TTC</TableHead>
                          <TableHead>Catégorie</TableHead>
                          <TableHead>Statut</TableHead>
                          <TableHead className="text-center">Pièce</TableHead>
                          <TableHead className="text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {block.invoices.map((inv) => {
                          const overdue = isOverdue(inv);

                          return (
                            <TableRow key={inv.id} className="hover:bg-muted/30">
                              <TableCell className="max-w-[220px]">
                                <div className="truncate text-sm font-medium">
                                  {inv.vendorCustomer}
                                </div>
                              </TableCell>

                              <TableCell className="font-mono text-sm">
                                {inv.invoiceNumber}
                              </TableCell>

                              <TableCell className="text-sm">
                                {safeFormatDate(inv.invoiceDate)}
                              </TableCell>

                              <TableCell>
                                <div className="flex items-center gap-2 text-sm">
                                  <span>{safeFormatDate(inv.dueDate)}</span>
                                  {overdue && (
                                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                                      En retard
                                    </span>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="text-right font-mono font-semibold">
                                {inv.currency
                                  ? formatCurrency(inv.amountGross, inv.currency)
                                  : "Devise inconnue"}
                              </TableCell>

                              <TableCell>
                                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">
                                  {inv.category}
                                </span>
                              </TableCell>

                              <TableCell>
                                <StatusBadge status={inv.status} />
                              </TableCell>

                              <TableCell className="text-center">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1.5"
                                  onClick={() => openInvoicePdf(inv)}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  Voir
                                </Button>
                              </TableCell>

                              <TableCell className="text-center">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8"
                                  disabled={deletingId === inv.id}
                                  onClick={() => deleteInvoice(inv)}
                                >
                                  {deletingId === inv.id ? "Suppression..." : "Supprimer"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })
      )}
    </div>
  );

  const renderReviewItems = () => (
    <Card className="overflow-hidden border shadow-sm">
      <CardContent className="p-0">
        {loadingReview ? (
          <div className="p-8 text-center text-muted-foreground">
            Chargement des éléments à valider...
          </div>
        ) : reviewItems.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Aucun document à valider.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Raison</TableHead>
                <TableHead>Type détecté</TableHead>
                <TableHead>Devise</TableHead>
                <TableHead>Montant</TableHead>
                <TableHead>Pièce</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {reviewItems.map((item) => {
                const doc = item.documentId;
                const fields = doc?.classification?.fields || {};
                const amount =
                  Number(fields.amountInclVat || 0) ||
                  Number(doc?.structuredData?.amountInclVat || 0) ||
                  0;

                const selectedCurrency = manualCurrencies[item._id];
                const hasDetectedCurrency =
                  !!fields.currency &&
                  ["EUR", "MAD", "USD"].includes(fields.currency);

                return (
                  <TableRow key={item._id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium">
                          {doc?.originalName || doc?.fileName || "Document"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fields.invoiceNumber || "N° inconnu"}
                        </p>
                      </div>
                    </TableCell>

                    <TableCell className="max-w-[280px]">
                      <div className="space-y-2">
                        <span className="block text-xs font-medium text-red-500">
                          {item.reason || "À valider"}
                        </span>
                        {!hasDetectedCurrency && (
                          <span className="block text-xs text-muted-foreground">
                            Sélectionne la devise réelle avant classification.
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      {getDocumentTypeLabel(doc?.documentType || doc?.classification?.label)}
                    </TableCell>

                    <TableCell>
                      <Select
                        value={selectedCurrency || ""}
                        onValueChange={(value) =>
                          setManualCurrency(item._id, value as CurrencyCode)
                        }
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue placeholder="Devise" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="MAD">MAD</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>

                    <TableCell className="font-mono">
                      {amount
                        ? selectedCurrency
                          ? formatCurrency(amount, selectedCurrency)
                          : "Devise inconnue"
                        : "—"}
                    </TableCell>

                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openReviewDocument(item)}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        Voir
                      </Button>
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button
                          size="sm"
                          disabled={
                            processingReviewId === item._id ||
                            !manualCurrencies[item._id]
                          }
                          onClick={() => classifyReviewItem(item._id, "purchase")}
                        >
                          Achat
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            processingReviewId === item._id ||
                            !manualCurrencies[item._id]
                          }
                          onClick={() => classifyReviewItem(item._id, "sales")}
                        >
                          Vente
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          disabled={deletingId === item._id}
                          onClick={() => deleteReviewItem(item)}
                        >
                          {deletingId === item._id ? "Suppression..." : "Supprimer"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  if (loadingInvoices) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Factures</h1>
          <p className="text-muted-foreground">Chargement des factures...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Factures</h1>
        <p className="text-muted-foreground">
          Suivi des factures d’achat et de vente, rapprochement et échéances.
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as FacturesTab)}
        className="space-y-5"
      >
        <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="grid w-full max-w-xl grid-cols-3">
              <TabsTrigger value="purchases">
                Achats ({purchaseCount})
              </TabsTrigger>
              <TabsTrigger value="sales">
                Ventes ({salesCount})
              </TabsTrigger>
              <TabsTrigger value="review">
                À valider ({reviewCount})
              </TabsTrigger>
            </TabsList>

            <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-wrap">
              <Card className="border bg-muted/20 shadow-none">
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Receipt className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Factures visibles</p>
                    <p className="text-sm font-semibold">{summary.count}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border bg-muted/20 shadow-none">
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="rounded-lg bg-success/10 p-2">
                    <Wallet className="h-4 w-4 text-success" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total rapproché</p>
                    <p className="text-sm font-semibold">
                      {formatCurrencyGroups(summary.reconciledByCurrency)}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border bg-muted/20 shadow-none">
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="rounded-lg bg-warning/10 p-2">
                    <AlertCircle className="h-4 w-4 text-warning" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">À rapprocher</p>
                    <p className="text-sm font-semibold">
                      {formatCurrencyGroups(summary.pendingByCurrency)}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border bg-muted/20 shadow-none">
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="rounded-lg bg-warning/10 p-2">
                    <CalendarClock className="h-4 w-4 text-warning" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Échéances en retard</p>
                    <p className="text-sm font-semibold">{summary.overdue}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid gap-4 rounded-xl border bg-muted/20 p-4 lg:grid-cols-[1.5fr_repeat(3,180px)_auto]">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Recherche</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Fournisseur, client, numéro, catégorie..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Statut</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Tous les statuts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="rapprochée">Rapprochée</SelectItem>
                  <SelectItem value="non_rapprochée">Non rapprochée</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Année</Label>
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Toutes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {years.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Mois</Label>
              <Select value={monthFilter} onValueChange={setMonthFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  {monthLabels.map((m, idx) => (
                    <SelectItem key={idx} value={String(idx)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button variant="outline" onClick={refreshAll}>
              Actualiser
            </Button>

            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={resetFilters}>
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Réinitialiser
              </Button>
            </div>
          </div>
        </div>

        <TabsContent value="purchases" className="mt-0">
          {renderBlocks(purchaseBlocks, "d'achat")}
        </TabsContent>

        <TabsContent value="sales" className="mt-0">
          {renderBlocks(salesBlocks, "de vente")}
        </TabsContent>

        <TabsContent value="review" className="mt-0">
          {renderReviewItems()}
        </TabsContent>
      </Tabs>

      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] p-0">
          <div className="h-full flex flex-col min-h-0">
            <DialogHeader className="px-6 pt-6 pb-2 border-b shrink-0">
              <DialogTitle className="text-2xl font-bold">
                Suivi de la facture {selectedInvoice?.invoiceNumber || ""}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {selectedInvoice?.vendorCustomer || "—"}
              </p>
            </DialogHeader>

            <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_0.9fr] gap-0 flex-1 min-h-0">
              <div className="border-r bg-muted/20 h-full min-h-0 overflow-hidden">
                {selectedInvoice?.pdfUrl ? (
                  <iframe
                    src={getFullPdfUrl(selectedInvoice.pdfUrl) || ""}
                    title={`PDF ${selectedInvoice.invoiceNumber}`}
                    className="w-full h-full border-0"
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Aperçu PDF non disponible
                  </div>
                )}
              </div>

              <div className="h-full min-h-0 overflow-y-auto p-6 space-y-6">
                <div>
                  <h3 className="text-xl font-semibold mb-4">Généralités</h3>
                  <div className="rounded-xl border p-5 space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Type</p>
                      <p className="font-medium">
                        {selectedInvoice?.type === "purchase"
                          ? "Facture d'achat"
                          : "Facture de vente"}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground">
                        {selectedInvoice?.type === "purchase"
                          ? "Fournisseur"
                          : "Client"}
                      </p>
                      <p className="font-medium">
                        {selectedInvoice?.vendorCustomer || "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground">N° facture</p>
                      <p className="font-medium">
                        {selectedInvoice?.invoiceNumber || "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground">Date facture</p>
                      <p className="font-medium">
                        {safeFormatDate(selectedInvoice?.invoiceDate)}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground">Échéance</p>
                      <p className="font-medium">
                        {safeFormatDate(selectedInvoice?.dueDate)}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground">Montant HT</p>
                      <p className="font-medium">
                        {selectedInvoice
                          ? selectedInvoice.currency
                            ? formatCurrency(
                                selectedInvoice.amountNet,
                                selectedInvoice.currency
                              )
                            : "Devise inconnue"
                          : "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground">TVA</p>
                      <p className="font-medium">
                        {selectedInvoice
                          ? selectedInvoice.currency
                            ? formatCurrency(
                                selectedInvoice.vatAmount,
                                selectedInvoice.currency
                              )
                            : "Devise inconnue"
                          : "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground">Montant TTC</p>
                      <p className="font-medium">
                        {selectedInvoice
                          ? selectedInvoice.currency
                            ? formatCurrency(
                                selectedInvoice.amountGross,
                                selectedInvoice.currency
                              )
                            : "Devise inconnue"
                          : "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground">Statut</p>
                      <div className="mt-1">
                        {selectedInvoice ? (
                          <StatusBadge status={selectedInvoice.status} />
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground">Catégorie</p>
                      <p className="font-medium">
                        {selectedInvoice?.category || "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}