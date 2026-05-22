import {
  useEffect,
  useMemo,
  useState,
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
  Eye,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Layers,
  Search,
  RotateCcw,
  Receipt,
  Wallet,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  toast,
} from "./imports";

type ImportedDocumentDto = {
  _id?: string;
  id?: string;
  originalName?: string;
  fileName?: string;
  fileUrl?: string | null;
  documentType?: string | null;
  createdAt?: string;
  structuredData?: any;
  classification?: any;
};

type ExpenseNote = {
  id: string;
  number: string;
  date: string;
  employeeName: string;
  requestName: string;
  supplier: string;
  category: string;
  paymentMethod: string;
  amountNet: number;
  vatAmount: number;
  vatRate?: string;
  amountGross: number;
  currency: string;
  receiptName?: string;
  fileUrl?: string | null;
  sourceName?: string;
  source: "import" | "exemple";
};

type ExpenseBlock = {
  id: string;
  label: string;
  notes: ExpenseNote[];
  totalGross: number;
  totalVat: number;
};

type RealInvoice = {
  id: string;
  type: "sales" | "purchase";
  invoiceNumber: string;
  invoiceDate: string;
  status?: string | null;
  amountNet?: number | null;
  vatAmount?: number | null;
  amountGross?: number | null;
};

type CombinedPeriod = {
  tvaCollectee: number;
  tvaParticuliers: number;
  tvaARendre: number;
};

const RECOVERABLE_VAT_RATE = 0.2;
const RECOVERABLE_VAT_RATE_LABEL = "20%";

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

const fallbackExpenseNotes: ExpenseNote[] = [];

function parseAppDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeFormatDate(value?: string | null) {
  const d = parseAppDate(value);
  return d ? d.toLocaleDateString("fr-FR") : "—";
}

function normalizeText(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function asNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function calculateRecoverableVat(rawNet: number, rawGross: number) {
  const amountGross = rawGross > 0 ? rawGross : rawNet > 0 ? rawNet * (1 + RECOVERABLE_VAT_RATE) : 0;
  const amountNet = amountGross > 0 ? amountGross / (1 + RECOVERABLE_VAT_RATE) : rawNet;
  const vatAmount = Math.max(0, amountGross - amountNet);

  return { amountNet, amountGross, vatAmount };
}

function isPersonalCardRefundable(paymentMethod: string) {
  const text = normalizeText(paymentMethod);
  return text.includes("carte") && text.includes("person") && text.includes("rembours");
}

function hasRecoverableVatFlag(...values: unknown[]) {
  return values.some((value) => value === true || value === 1 || normalizeText(String(value ?? "")) === "true");
}

function shouldGoToTvaParticuliers(structured: any, fields: any, paymentMethod: string) {
  return hasRecoverableVatFlag(structured?.recupTVA, fields?.recupTVA) || isPersonalCardRefundable(paymentMethod);
}

function mapImportedDocumentToExpenseNote(doc: ImportedDocumentDto): ExpenseNote | null {
  const structured = doc.structuredData || {};
  const resultats = structured.resultats || {};
  const amount = structured.Amount || resultats.Amount || {};
  const header = structured.Header || resultats.Header || {};
  const fields = doc.classification?.fields || {};
  const paymentMethod = firstText(structured.moyenPaiement, fields.moyenPaiement, fields.paymentMethod);

  if (!shouldGoToTvaParticuliers(structured, fields, paymentMethod)) return null;

  const docId = String(doc._id || doc.id || structured.id || structured.externalId || crypto.randomUUID());
  const currency = firstText(
    structured.montantTTCCurrency,
    structured.montantHTCurrency,
    amount.devise,
    fields.currency,
    "EUR"
  );
  const amounts = calculateRecoverableVat(
    asNumber(structured.montantHT ?? amount.montant_ht ?? fields.amountNet),
    asNumber(structured.montantTTC ?? amount.montant_ttc ?? fields.amountInclVat)
  );

  return {
    id: docId,
    number: firstText(structured.numero, header.numero, fields.invoiceNumber, doc.originalName, "NDF"),
    date: firstText(structured.date, header.date, fields.invoiceDate, doc.createdAt),
    employeeName: firstText(
      structured.demandeurName,
      structured.contactName,
      structured.createdByName,
      structured.missionName,
      "Particulier"
    ),
    requestName: firstText(structured.demandesFraisName, "Demande de frais"),
    supplier: firstText(structured.fournisseur, header.fournisseur, structured.accountName, fields.vendorCustomer, "—"),
    category: firstText(structured.typesFraisName, fields.category, "Frais professionnels"),
    paymentMethod,
    amountNet: amounts.amountNet,
    vatAmount: amounts.vatAmount,
    vatRate: RECOVERABLE_VAT_RATE_LABEL,
    amountGross: amounts.amountGross,
    currency,
    receiptName: firstText(
      structured.nomfichierName,
      Object.values(structured.justificatifNames || {})[0],
      doc.originalName,
      doc.fileName
    ),
    fileUrl: structured.proxyFileUrl || doc.fileUrl || structured.pdfViewUrl || structured.crmDownloadUrl || null,
    sourceName: doc.originalName || doc.fileName,
    source: "import",
  };
}

function isReconciledInvoice(invoice: RealInvoice) {
  const status = normalizeText(invoice.status);
  return status === "rapprochee" || status === "rapproche" || status === "reconciled";
}

function getInvoiceVat(invoice: RealInvoice) {
  const vat = asNumber(invoice.vatAmount);
  if (vat > 0) return vat;
  const gross = asNumber(invoice.amountGross);
  const net = asNumber(invoice.amountNet);
  if (gross > 0 && net > 0 && gross >= net) return gross - net;
  return 0;
}

function buildMonthlyBlocks(notes: ExpenseNote[]): ExpenseBlock[] {
  const groups = new Map<string, { label: string; notes: ExpenseNote[] }>();
  const undated: ExpenseNote[] = [];

  notes.forEach((note) => {
    const d = parseAppDate(note.date);
    if (!d) {
      undated.push(note);
      return;
    }

    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${monthLabels[d.getMonth()]} ${d.getFullYear()}`;
    if (!groups.has(key)) groups.set(key, { label, notes: [] });
    groups.get(key)!.notes.push(note);
  });

  const blocks: ExpenseBlock[] = Array.from(groups.entries()).map(([id, group]) => {
    const sortedNotes = [...group.notes].sort(
      (a, b) => (parseAppDate(b.date)?.getTime() || 0) - (parseAppDate(a.date)?.getTime() || 0)
    );
    return {
      id,
      label: group.label,
      notes: sortedNotes,
      totalGross: sortedNotes.reduce((sum, note) => sum + note.amountGross, 0),
      totalVat: sortedNotes.reduce((sum, note) => sum + note.vatAmount, 0),
    };
  });

  if (undated.length > 0) {
    blocks.push({
      id: "0000-00",
      label: "Sans date",
      notes: undated,
      totalGross: undated.reduce((sum, note) => sum + note.amountGross, 0),
      totalVat: undated.reduce((sum, note) => sum + note.vatAmount, 0),
    });
  }

  return blocks.sort((a, b) => {
    if (a.id === "0000-00") return 1;
    if (b.id === "0000-00") return -1;
    return b.id.localeCompare(a.id);
  });
}

export default function TvaParticuliers() {
  const [importedNotes, setImportedNotes] = useState<ExpenseNote[]>([]);
  const [reconciledInvoices, setReconciledInvoices] = useState<RealInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [selectedNote, setSelectedNote] = useState<ExpenseNote | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [importsRes, invoicesRes] = await Promise.all([
        fetch("/api/imports", { credentials: "include" }),
        fetch("/api/invoices", { credentials: "include" }),
      ]);

      const importsPayload = await importsRes.json().catch(() => ({}));
      if (!importsRes.ok) {
        setImportedNotes([]);
      } else {
        const documents: ImportedDocumentDto[] = Array.isArray(importsPayload?.documents) ? importsPayload.documents : [];
        setImportedNotes(documents.map(mapImportedDocumentToExpenseNote).filter(Boolean) as ExpenseNote[]);
      }

      const invoicesPayload = await invoicesRes.json().catch(() => ({}));
      if (!invoicesRes.ok) {
        setReconciledInvoices([]);
      } else {
        const invoices: RealInvoice[] = Array.isArray(invoicesPayload?.invoices) ? invoicesPayload.invoices : [];
        setReconciledInvoices(invoices.filter(isReconciledInvoice));
      }
    } catch {
      setImportedNotes([]);
      setReconciledInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const notes = (importedNotes.length > 0 ? importedNotes : fallbackExpenseNotes).filter((note) => note.vatAmount > 0);
  const usingFallback = importedNotes.length === 0;

  const years = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((note) => {
      const d = parseAppDate(note.date);
      if (d) set.add(String(d.getFullYear()));
    });
    reconciledInvoices.forEach((invoice) => {
      const d = parseAppDate(invoice.invoiceDate);
      if (d) set.add(String(d.getFullYear()));
    });
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [notes, reconciledInvoices]);

  const filteredNotes = useMemo(() => {
    const query = normalizeText(searchText);
    return notes.filter((note) => {
      if (query) {
        const haystack = normalizeText(
          [
            note.number,
            note.employeeName,
            note.requestName,
            note.supplier,
            note.category,
            note.paymentMethod,
          ].join(" ")
        );
        if (!haystack.includes(query)) return false;
      }

      const d = parseAppDate(note.date);
      if (yearFilter !== "all" && (!d || String(d.getFullYear()) !== yearFilter)) return false;

      return true;
    });
  }, [notes, searchText, yearFilter]);

  const blocks = useMemo(() => buildMonthlyBlocks(filteredNotes), [filteredNotes]);
  const combinedPeriods = useMemo<CombinedPeriod[]>(() => {
    return monthLabels.map((label, monthIndex) => {
      const periodInvoices = reconciledInvoices.filter((invoice) => {
        const d = parseAppDate(invoice.invoiceDate);
        if (!d) return false;
        if (yearFilter !== "all" && String(d.getFullYear()) !== yearFilter) return false;
        return d.getMonth() === monthIndex;
      });
      const periodNotes = filteredNotes.filter((note) => {
        const d = parseAppDate(note.date);
        return d ? d.getMonth() === monthIndex : false;
      });
      const sales = periodInvoices.filter((invoice) => invoice.type === "sales");
      const tvaCollectee = sales.reduce((sum, invoice) => sum + getInvoiceVat(invoice), 0);
      const tvaParticuliers = periodNotes.reduce((sum, note) => sum + note.vatAmount, 0);

      return {
        tvaCollectee,
        tvaParticuliers,
        tvaARendre: tvaCollectee - tvaParticuliers,
      };
    });
  }, [filteredNotes, reconciledInvoices, yearFilter]);

  const summary = useMemo(() => {
    const people = new Set(filteredNotes.map((note) => note.employeeName).filter(Boolean));
    const tvaCollectee = combinedPeriods.reduce((sum, period) => sum + period.tvaCollectee, 0);
    const tvaParticuliers = combinedPeriods.reduce((sum, period) => sum + period.tvaParticuliers, 0);
    return {
      count: filteredNotes.length,
      peopleCount: people.size,
      gross: filteredNotes.reduce((sum, note) => sum + note.amountGross, 0),
      vat: filteredNotes.reduce((sum, note) => sum + note.vatAmount, 0),
      pendingVat: filteredNotes.reduce((sum, note) => sum + note.vatAmount, 0),
      tvaCollectee,
      tvaParticuliers,
      tvaARendre: tvaCollectee - tvaParticuliers,
    };
  }, [combinedPeriods, filteredNotes]);

  const toggleBlock = (blockId: string) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  };

  const resetFilters = () => {
    setSearchText("");
    setYearFilter("all");
    toast.success("Filtres réinitialisés.");
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">TVA particuliers</h1>
        <p className="text-muted-foreground">
          Notes de frais payées par carte personnelle pour un usage professionnel.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">TVA remboursable aux particuliers</p>
            <p className="text-xs text-muted-foreground">
              Vue spéciale comptable : uniquement les frais carte perso remboursables.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:flex lg:flex-wrap">
            <Card className="border bg-muted/20 shadow-none">
              <CardContent className="flex items-center gap-3 p-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Receipt className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Notes visibles</p>
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
                  <p className="text-xs text-muted-foreground">TVA à rembourser</p>
                  <p className="text-sm font-semibold">{formatCurrency(summary.pendingVat)}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border bg-muted/20 shadow-none">
              <CardContent className="flex items-center gap-3 p-3">
                <div className="rounded-lg bg-warning/10 p-2">
                  <AlertCircle className="h-4 w-4 text-warning" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">TTC concerné</p>
                  <p className="text-sm font-semibold">{formatCurrency(summary.gross)}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border bg-muted/20 shadow-none">
              <CardContent className="flex items-center gap-3 p-3">
                <div className="rounded-lg bg-info/10 p-2">
                  <CheckCircle2 className="h-4 w-4 text-info" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Particuliers</p>
                  <p className="text-sm font-semibold">{summary.peopleCount}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid gap-4 rounded-xl border bg-muted/20 p-4 lg:grid-cols-[1.5fr_180px_auto_auto]">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Recherche</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Particulier, NDF, fournisseur, catégorie..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium">Année</Label>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                {years.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" onClick={() => void loadData()}>
            Actualiser
          </Button>

          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={resetFilters}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Réinitialiser
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {loading
            ? "Chargement des notes de frais..."
            : usingFallback
              ? "Aucun import réel de note de frais carte personnelle détecté : affichage d'exemples."
              : `${importedNotes.length} note(s) de frais carte personnelle détectée(s).`}
        </p>
      </div>

      <Card className="overflow-hidden border shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-foreground">Vue combinée TVA + factures</p>
            <p className="text-xs text-muted-foreground">
              TVA collectée sur ventes rapprochées moins TVA récupérable des notes concernées.
              Les notes personnelles sont calculées au taux récupérable fixe de 20%.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Card className="border bg-muted/20 shadow-none">
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">TVA collectée</p>
                <p className="mt-1 text-lg font-bold">{formatCurrency(summary.tvaCollectee)}</p>
                <p className="text-[11px] text-muted-foreground">Factures ventes rapprochées</p>
              </CardContent>
            </Card>

            <Card className="border bg-muted/20 shadow-none">
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">TVA notes perso</p>
                <p className="mt-1 text-lg font-bold">{formatCurrency(summary.tvaParticuliers)}</p>
                <p className="text-[11px] text-muted-foreground">Carte personnelle remboursable</p>
              </CardContent>
            </Card>

            <Card className="border bg-primary/5 shadow-none ring-1 ring-primary/10">
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">TVA à rendre</p>
                <p className={`mt-1 text-lg font-bold ${summary.tvaARendre >= 0 ? "text-primary" : "text-success"}`}>
                  {formatCurrency(summary.tvaARendre)}
                </p>
                <p className="text-[11px] text-muted-foreground">Négatif = crédit de TVA</p>
              </CardContent>
            </Card>
          </div>

        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Vue mensuelle</p>
            <p className="text-xs text-muted-foreground">Contrôle de la TVA à rembourser par période.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setExpandedBlocks(new Set(blocks.map((b) => b.id)))}>
              Tout déplier
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExpandedBlocks(new Set())}>
              Tout replier
            </Button>
          </div>
        </div>

        {blocks.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-14 text-center text-muted-foreground">
              <Layers className="mx-auto mb-3 h-12 w-12 text-muted-foreground/40" />
              <p className="font-medium">Aucune note de frais remboursable</p>
              <p className="text-sm">Aucune note carte personnelle ne correspond aux filtres actuels.</p>
            </CardContent>
          </Card>
        ) : (
          blocks.map((block) => {
            const isExpanded = expandedBlocks.has(block.id);

            return (
              <Card key={block.id} className="overflow-hidden border shadow-sm">
                <Collapsible open={isExpanded} onOpenChange={() => toggleBlock(block.id)}>
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
                          <p className="text-sm font-semibold text-foreground">{block.label}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>{block.notes.length} note(s)</span>
                            <span>Total TTC : {formatCurrency(block.totalGross)}</span>
                            <span>TVA : {formatCurrency(block.totalVat)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="border-t bg-muted/10 p-0">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/20">
                            <TableHead>Particulier</TableHead>
                            <TableHead>N° note</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Fournisseur</TableHead>
                            <TableHead>Catégorie</TableHead>
                            <TableHead className="text-right">TTC</TableHead>
                            <TableHead className="text-right">TVA</TableHead>
                            <TableHead>Taux</TableHead>
                            <TableHead className="text-center">Pièce</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {block.notes.map((note) => (
                            <TableRow key={note.id} className="hover:bg-muted/30">
                              <TableCell className="max-w-[220px]">
                                <div className="truncate text-sm font-medium">{note.employeeName}</div>
                                <div className="truncate text-xs text-muted-foreground">{note.requestName}</div>
                              </TableCell>
                              <TableCell className="font-mono text-sm">{note.number}</TableCell>
                              <TableCell className="text-sm">{safeFormatDate(note.date)}</TableCell>
                              <TableCell className="max-w-[180px]">
                                <div className="truncate text-sm">{note.supplier}</div>
                              </TableCell>
                              <TableCell>
                                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">{note.category}</span>
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold">
                                {formatCurrency(note.amountGross, note.currency)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold text-primary">
                                {formatCurrency(note.vatAmount, note.currency)}
                              </TableCell>
                              <TableCell>
                                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                                  {note.vatRate || "—"}
                                </span>
                              </TableCell>
                              <TableCell className="text-center">
                                <Button variant="outline" size="sm" onClick={() => setSelectedNote(note)}>
                                  <Eye className="mr-1 h-3.5 w-3.5" />
                                  Voir
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
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

      <Dialog open={Boolean(selectedNote)} onOpenChange={(open) => !open && setSelectedNote(null)}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] p-0">
          {selectedNote ? (
            <div className="flex h-full min-h-0 flex-col">
              <DialogHeader className="shrink-0 border-b px-6 pb-2 pt-6">
                <DialogTitle className="text-2xl font-bold">
                  Note de frais {selectedNote.number}
                </DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {selectedNote.employeeName} · {selectedNote.receiptName || "Justificatif"}
                </p>
              </DialogHeader>

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[1.3fr_0.9fr]">
                <div className="h-full min-h-0 overflow-hidden border-r bg-muted/20">
                  {selectedNote.fileUrl ? (
                    <iframe
                      src={selectedNote.fileUrl}
                      title={`Justificatif ${selectedNote.number}`}
                      className="h-full w-full border-0"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      Aperçu justificatif non disponible
                    </div>
                  )}
                </div>

                <div className="h-full min-h-0 space-y-6 overflow-y-auto p-6">
                  <div>
                    <h3 className="mb-4 text-xl font-semibold">Généralités</h3>
                    <div className="space-y-4 rounded-xl border p-5">
                      <div>
                        <p className="text-sm text-muted-foreground">Particulier</p>
                        <p className="font-medium">{selectedNote.employeeName}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Demande</p>
                        <p className="font-medium">{selectedNote.requestName}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">N° note</p>
                        <p className="font-medium">{selectedNote.number}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Date</p>
                        <p className="font-medium">{safeFormatDate(selectedNote.date)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Fournisseur</p>
                        <p className="font-medium">{selectedNote.supplier}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Catégorie</p>
                        <p className="font-medium">{selectedNote.category}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Paiement</p>
                        <p className="font-medium">{selectedNote.paymentMethod}</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-4 text-xl font-semibold">Montants TVA</h3>
                    <div className="space-y-4 rounded-xl border p-5">
                      <div>
                        <p className="text-sm text-muted-foreground">Montant HT</p>
                        <p className="font-medium">{formatCurrency(selectedNote.amountNet, selectedNote.currency)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">TVA récupérable</p>
                        <p className="font-medium text-primary">{formatCurrency(selectedNote.vatAmount, selectedNote.currency)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Taux TVA</p>
                        <p className="font-medium">{selectedNote.vatRate || "—"}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Montant TTC</p>
                        <p className="font-medium">{formatCurrency(selectedNote.amountGross, selectedNote.currency)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
