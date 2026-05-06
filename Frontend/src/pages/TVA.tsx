import {
  useState,
  useMemo,
  useEffect,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatCurrency,
  formatDate,
  Download,
  Receipt,
  TrendingUp,
  TrendingDown,
  BarChart3,
  ChevronDown,
  ChevronRight,
  FileText,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  RechartsTooltip,
  toast,
  StatusBadge,
} from "./imports";
import { Fragment } from "react";

const months = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];

interface PeriodRow {
  label: string;
  startMonth: number;
  endMonth: number;
  tvaCollectee: number;
  tvaDeductible: number;
  tvaNette: number;
  htVentes: number;
  htAchats: number;
  ttcVentes: number;
  ttcAchats: number;
  invoices: RealInvoice[];
}

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

export default function TVA() {
  const currentYear = new Date().getFullYear().toString();
  const [year, setYear] = useState(currentYear);
  const [frequency, setFrequency] = useState<"mensuel" | "trimestriel">("mensuel");
  const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set());
  const [reconciledInvoices, setReconciledInvoices] = useState<RealInvoice[]>([]);
  const [loading, setLoading] = useState(false);

  const togglePeriod = (label: string) => {
    setExpandedPeriods(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  useEffect(() => {
    const loadInvoices = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/invoices", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setReconciledInvoices([]);
          return;
        }
        const allInvoices: RealInvoice[] = Array.isArray(data?.invoices) ? data.invoices : [];
        const rec = allInvoices.filter((inv) => {
          const status = String(inv?.status || "").toLowerCase();
          return status === "rapprochée" || status === "rapprochee" || status === "rapproché" || status === "reconciled";
        });
        setReconciledInvoices(rec);
      } catch {
        setReconciledInvoices([]);
      } finally {
        setLoading(false);
      }
    };
    void loadInvoices();
  }, []);

  const periodData: PeriodRow[] = useMemo(() => {
    const periods = frequency === "mensuel"
      ? Array.from({ length: 12 }, (_, i) => ({ label: months[i], startMonth: i, endMonth: i }))
      : Array.from({ length: 4 }, (_, i) => ({ label: `T${i + 1}`, startMonth: i * 3, endMonth: i * 3 + 2 }));

    return periods.map(p => {
      const periodInvoices = reconciledInvoices.filter(inv => {
        if (!inv.invoiceDate) return false;
        const d = new Date(inv.invoiceDate);
        if (Number.isNaN(d.getTime())) return false;
        return d.getFullYear().toString() === year && d.getMonth() >= p.startMonth && d.getMonth() <= p.endMonth;
      });
      const sales = periodInvoices.filter(i => i.type === "sales");
      const purchases = periodInvoices.filter(i => i.type === "purchase");

      const getNet = (i: RealInvoice) => Number(i.amountNet || 0);
      const getGross = (i: RealInvoice) => Number(i.amountGross || 0);
      const getVat = (i: RealInvoice) => {
        const vat = Number(i.vatAmount || 0);
        if (vat > 0) return vat;
        const gross = getGross(i);
        const net = getNet(i);
        if (gross > 0 && net > 0 && gross >= net) return gross - net;
        return 0;
      };

      const tvaCollectee = sales.reduce((s, i) => s + getVat(i), 0);
      const tvaDeductible = purchases.reduce((s, i) => s + getVat(i), 0);

      return {
        label: p.label,
        startMonth: p.startMonth,
        endMonth: p.endMonth,
        tvaCollectee,
        tvaDeductible,
        tvaNette: tvaCollectee - tvaDeductible,
        htVentes: sales.reduce((s, i) => s + getNet(i), 0),
        htAchats: purchases.reduce((s, i) => s + getNet(i), 0),
        ttcVentes: sales.reduce((s, i) => s + getGross(i), 0),
        ttcAchats: purchases.reduce((s, i) => s + getGross(i), 0),
        invoices: periodInvoices,
      };
    });
  }, [year, frequency, reconciledInvoices]);

  const totals = useMemo(() => ({
    tvaCollectee: periodData.reduce((s, p) => s + p.tvaCollectee, 0),
    tvaDeductible: periodData.reduce((s, p) => s + p.tvaDeductible, 0),
    tvaNette: periodData.reduce((s, p) => s + p.tvaNette, 0),
    htVentes: periodData.reduce((s, p) => s + p.htVentes, 0),
    htAchats: periodData.reduce((s, p) => s + p.htAchats, 0),
  }), [periodData]);

  const chartData = periodData.filter(p => p.tvaCollectee > 0 || p.tvaDeductible > 0);

  const handleExport = () => {
    const header = "Période;TVA Collectée;TVA Déductible;TVA Nette;HT Ventes;HT Achats";
    const rows = periodData.map(p =>
      `${p.label};${p.tvaCollectee.toFixed(2)};${p.tvaDeductible.toFixed(2)};${p.tvaNette.toFixed(2)};${p.htVentes.toFixed(2)};${p.htAchats.toFixed(2)}`
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tva_${year}_${frequency}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export CSV téléchargé.");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">TVA</h1>
          <p className="text-muted-foreground">Calcul basé uniquement sur les factures rapprochées</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="2024">2024</SelectItem>
              <SelectItem value="2025">2025</SelectItem>
              <SelectItem value="2026">2026</SelectItem>
              <SelectItem value="2027">2027</SelectItem>
            </SelectContent>
          </Select>
          <Select value={frequency} onValueChange={(v) => setFrequency(v as "mensuel" | "trimestriel")}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mensuel">Mensuel</SelectItem>
              <SelectItem value="trimestriel">Trimestriel</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {loading
          ? "Chargement des factures rapprochées..."
          : `${reconciledInvoices.length} facture(s) rapprochée(s) utilisée(s) pour ce calcul.`}
      </p>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-info/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">TVA Collectée</p>
                <p className="text-xl font-bold">{formatCurrency(totals.tvaCollectee)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">TVA Déductible</p>
                <p className="text-xl font-bold">{formatCurrency(totals.tvaDeductible)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Receipt className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">TVA Nette</p>
                <p className={`text-xl font-bold ${totals.tvaNette >= 0 ? "text-destructive" : "text-success"}`}>
                  {formatCurrency(totals.tvaNette)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {totals.tvaNette >= 0 ? "À reverser" : "Crédit de TVA"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detail table with expandable rows */}

      {/* Detail table with expandable rows */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Détail par période — cliquez sur une période pour voir les factures</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Période</TableHead>
                <TableHead className="text-right">HT Ventes</TableHead>
                <TableHead className="text-right">HT Achats</TableHead>
                <TableHead className="text-right">TVA Collectée</TableHead>
                <TableHead className="text-right">TVA Déductible</TableHead>
                <TableHead className="text-right">TVA Nette</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periodData.map(p => {
                const isExpanded = expandedPeriods.has(p.label);
                const hasInvoices = p.invoices.length > 0;
                return (
                  <Fragment key={p.label}>
                    <TableRow
                      className={hasInvoices ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                      onClick={() => hasInvoices && togglePeriod(p.label)}
                    >
                      <TableCell className="w-8 px-2">
                        {hasInvoices && (
                          isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {p.label}
                        {hasInvoices && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({p.invoices.length} facture{p.invoices.length > 1 ? "s" : ""})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(p.htVentes)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(p.htAchats)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(p.tvaCollectee)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(p.tvaDeductible)}</TableCell>
                      <TableCell className={`text-right font-mono font-medium ${p.tvaNette >= 0 ? "text-destructive" : "text-success"}`}>
                        {formatCurrency(p.tvaNette)}
                      </TableCell>
                    </TableRow>
                   {isExpanded && p.invoices.map(inv => (
  <TableRow key={`${p.label}-${inv.id}`} className="bg-muted/30">
    <TableCell></TableCell>
    <TableCell colSpan={6}>
      <div className="grid grid-cols-[20px_140px_90px_110px_120px_120px_120px] items-center gap-4 py-2 text-sm">
  <FileText className="h-3.5 w-3.5 text-muted-foreground" />

  <span className="font-mono text-xs">
    {inv.invoiceNumber}
  </span>

  <span
    className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-xs ${
      inv.type === "sales" ? "bg-info/10 text-info" : "bg-warning/10 text-warning"
    }`}
  >
    {inv.type === "sales" ? "Vente" : "Achat"}
  </span>

  <span className="text-xs text-muted-foreground">
    {formatDate(inv.invoiceDate)}
  </span>

  <span className="font-mono text-xs text-right text-muted-foreground">
    HT {formatCurrency(inv.amountNet)}
  </span>

  <span className="font-mono text-xs text-right font-medium">
    TVA {formatCurrency(inv.vatAmount)}
  </span>

  <span className="font-mono text-xs text-right">
    TTC {formatCurrency(inv.amountGross)}
  </span>
</div>
    </TableCell>
  </TableRow>
))}
                  </Fragment>
                );
              })}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell></TableCell>
                <TableCell>Total</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(totals.htVentes)}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(totals.htAchats)}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(totals.tvaCollectee)}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(totals.tvaDeductible)}</TableCell>
                <TableCell className={`text-right font-mono ${totals.tvaNette >= 0 ? "text-destructive" : "text-success"}`}>
                  {formatCurrency(totals.tvaNette)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Évolution par période
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <RechartsTooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                  />
                  <Legend />
                  <Bar dataKey="tvaCollectee" name="TVA Collectée" fill="hsl(var(--info))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="tvaDeductible" name="TVA Déductible" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="tvaNette" name="TVA Nette" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
