import {
  useMemo,
  useState,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  mockInvoices,
  formatCurrency,
  formatDate,
  FileText,
  TrendingUp,
  Shield,
  ArrowUpRight,
  Info,
  Eye,
  toast,
} from "./imports";

type QuittanceStatus = "ouverte" | "financée" | "clôturée";

interface Quittance {
  id: string;
  reference: string;
  cessionDate: string;
  status: QuittanceStatus;
  invoiceIds: string[];
}

interface FactorVirement {
  id: string;
  quittanceId: string;
  date: string;
  amount: number;
  type: "avance" | "règlement_final";
}

interface FactorRetention {
  id: string;
  quittanceId: string;
  date: string;
  amount: number;
  type: "retenue" | "restitution";
}

const initialQuittances: Quittance[] = [
  {
    id: "q-2026-01",
    reference: "Q-2026-001",
    cessionDate: "2026-02-10",
    status: "clôturée",
    invoiceIds: ["inv-5", "inv-9"],
  },
  {
    id: "q-2026-02",
    reference: "Q-2026-002",
    cessionDate: "2026-03-05",
    status: "financée",
    invoiceIds: ["inv-6", "inv-7", "inv-6b"],
  },
  {
    id: "q-2026-03",
    reference: "Q-2026-003",
    cessionDate: "2026-04-12",
    status: "ouverte",
    invoiceIds: ["inv-8", "inv-13"],
  },
];

const initialVirements: FactorVirement[] = [
  {
    id: "v-1",
    quittanceId: "q-2026-01",
    date: "2026-02-11",
    amount: 9000,
    type: "avance",
  },
  {
    id: "v-2",
    quittanceId: "q-2026-01",
    date: "2026-03-15",
    amount: 2500,
    type: "règlement_final",
  },
  {
    id: "v-3",
    quittanceId: "q-2026-02",
    date: "2026-03-06",
    amount: 15000,
    type: "avance",
  },
  {
    id: "v-4",
    quittanceId: "q-2026-03",
    date: "2026-04-18",
    amount: 4200,
    type: "avance",
  },
];

const initialRetentions: FactorRetention[] = [
  {
    id: "r-1",
    quittanceId: "q-2026-01",
    date: "2026-02-10",
    amount: 1500,
    type: "retenue",
  },
  {
    id: "r-2",
    quittanceId: "q-2026-02",
    date: "2026-03-05",
    amount: 2800,
    type: "retenue",
  },
  {
    id: "r-3",
    quittanceId: "q-2026-01",
    date: "2026-03-20",
    amount: 500,
    type: "restitution",
  },
  {
    id: "r-4",
    quittanceId: "q-2026-03",
    date: "2026-04-12",
    amount: 650,
    type: "retenue",
  },
];

function getMonthKey(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(key: string) {
  if (!key) return "—";
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function diffInDays(start: string, end?: string | null) {
  if (!end) return null;
  const d1 = new Date(start);
  const d2 = new Date(end);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400000));
}

export default function Affacturage() {
  const [quittances] = useState<Quittance[]>(initialQuittances);
  const [virements] = useState<FactorVirement[]>(initialVirements);
  const [retentions] = useState<FactorRetention[]>(initialRetentions);
  const [selectedQuittanceId, setSelectedQuittanceId] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<string>("all");

  const monthOptions = useMemo(() => {
    const keys = Array.from(new Set(quittances.map((q) => getMonthKey(q.cessionDate)).filter(Boolean))).sort();
    return keys.map((key) => ({ key, label: getMonthLabel(key) }));
  }, [quittances]);

  const quittanceRows = useMemo(() => {
    return quittances.map((q) => {
      const invoices = q.invoiceIds
        .map((id) => mockInvoices.find((i) => i.id === id))
        .filter((i): i is NonNullable<typeof i> => Boolean(i));

      const totalQuittance = invoices.reduce((sum, inv) => sum + inv.amountGross, 0);
      const qVirements = virements
        .filter((v) => v.quittanceId === q.id)
        .sort((a, b) => a.date.localeCompare(b.date));
      const qRetentions = retentions.filter((r) => r.quittanceId === q.id);

      const totalImporte = qVirements.reduce((sum, v) => sum + v.amount, 0);
      const reliquat = qRetentions.reduce(
        (sum, r) => sum + (r.type === "retenue" ? r.amount : -r.amount),
        0,
      );
      const importDate = qVirements[0]?.date ?? null;
      const nbJoursCedeImporte = diffInDays(q.cessionDate, importDate);
      const monthKey = getMonthKey(q.cessionDate);

      return {
        quittance: q,
        invoices,
        virements: qVirements,
        retentions: qRetentions,
        totalQuittance,
        totalImporte,
        reliquat,
        importDate,
        nbJoursCedeImporte,
        nbFactures: invoices.length,
        monthKey,
      };
    });
  }, [quittances, virements, retentions]);

  const filteredRows = useMemo(() => {
    if (monthFilter === "all") return quittanceRows;
    return quittanceRows.filter((row) => row.monthKey === monthFilter);
  }, [quittanceRows, monthFilter]);

  const kpi = useMemo(() => {
    const totalQuittance = filteredRows.reduce((sum, row) => sum + row.totalQuittance, 0);
    const totalImporte = filteredRows.reduce((sum, row) => sum + row.totalImporte, 0);
    const totalReliquat = filteredRows.reduce((sum, row) => sum + Math.max(row.reliquat, 0), 0);
    const rowsWithDelay = filteredRows.filter((row) => row.nbJoursCedeImporte !== null);
    const delaiMoyen = rowsWithDelay.length
      ? Math.round(
          rowsWithDelay.reduce((sum, row) => sum + (row.nbJoursCedeImporte ?? 0), 0) / rowsWithDelay.length,
        )
      : 0;

    const latestImport = filteredRows
      .filter((row) => row.importDate)
      .sort((a, b) => String(b.importDate).localeCompare(String(a.importDate)))[0] ?? null;

    return {
      totalQuittance,
      totalImporte,
      totalReliquat,
      delaiMoyen,
      latestImport,
    };
  }, [filteredRows]);

  const monthlyRows = useMemo(() => {
    const map = new Map<string, { totalQuittance: number; totalImporte: number; totalReliquat: number; delays: number[] }>();

    quittanceRows.forEach((row) => {
      const current = map.get(row.monthKey) ?? {
        totalQuittance: 0,
        totalImporte: 0,
        totalReliquat: 0,
        delays: [],
      };

      current.totalQuittance += row.totalQuittance;
      current.totalImporte += row.totalImporte;
      current.totalReliquat += Math.max(row.reliquat, 0);
      if (row.nbJoursCedeImporte !== null) current.delays.push(row.nbJoursCedeImporte);
      map.set(row.monthKey, current);
    });

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, vals]) => ({
        key,
        label: getMonthLabel(key),
        totalQuittance: vals.totalQuittance,
        totalImporte: vals.totalImporte,
        totalReliquat: vals.totalReliquat,
        delaiMoyen: vals.delays.length
          ? Math.round(vals.delays.reduce((sum, value) => sum + value, 0) / vals.delays.length)
          : 0,
      }));
  }, [quittanceRows]);

  const selectedRow = filteredRows.find((row) => row.quittance.id === selectedQuittanceId) ?? null;

  const statusClasses: Record<QuittanceStatus, string> = {
    ouverte: "bg-info/15 text-info",
    financée: "bg-primary/15 text-primary",
    clôturée: "bg-success/15 text-success",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Affacturage</h1>
          <p className="text-muted-foreground">
            Filtrage par mois, suivi cédé / importé / retenue par quittance
          </p>
        </div>

        <div className="w-full sm:w-[260px]">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Mois de cession</label>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">Tous les mois</option>
            {monthOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10">
                <FileText className="h-5 w-5 text-info" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total quittance</p>
                <p className="text-lg font-bold">{formatCurrency(kpi.totalQuittance)}</p>
                
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <ArrowUpRight className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total encaissé</p>
                <p className="text-lg font-bold">{formatCurrency(kpi.totalImporte)}</p>
             
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                <Shield className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reliquat</p>
                <p className="text-lg font-bold">{formatCurrency(kpi.totalReliquat)}</p>
                <p className="text-xs text-muted-foreground">Retenue</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Délai moyen</p>
                <p className="text-lg font-bold">{kpi.delaiMoyen} j</p>
                
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Synthèse mensuelle</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mois</TableHead>
                <TableHead className="text-right">Total quittance</TableHead>
                <TableHead className="text-right">Encaissé</TableHead>
                <TableHead className="text-right">Reliquat</TableHead>
                <TableHead className="text-right">Délai moyen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthlyRows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(row.totalQuittance)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(row.totalImporte)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(row.totalReliquat)}</TableCell>
                  <TableCell className="text-right">{row.delaiMoyen} j</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quittances</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Référence</TableHead>
                <TableHead>Date cession</TableHead>
                <TableHead>Date import</TableHead>
                <TableHead className="text-right">Jours</TableHead>
                <TableHead className="text-right">Total quittance</TableHead>
                <TableHead className="text-right">Encaissé</TableHead>
                <TableHead className="text-right">Reliquat</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="w-[90px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    Aucune quittance pour ce filtre.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((row) => (
                  <TableRow key={row.quittance.id}>
                    <TableCell className="font-medium">{row.quittance.reference}</TableCell>
                    <TableCell>{formatDate(row.quittance.cessionDate)}</TableCell>
                    <TableCell>{row.importDate ? formatDate(row.importDate) : "—"}</TableCell>
                    <TableCell className="text-right">{row.nbJoursCedeImporte !== null ? `${row.nbJoursCedeImporte} j` : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(row.totalQuittance)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(row.totalImporte)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(Math.max(row.reliquat, 0))}</TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClasses[row.quittance.status]}`}>
                        {row.quittance.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedQuittanceId(row.quittance.id)}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Voir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={selectedQuittanceId !== null} onOpenChange={(open) => !open && setSelectedQuittanceId(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Détail de la quittance</DialogTitle>
          </DialogHeader>

          {!selectedRow ? (
            <div className="text-sm text-muted-foreground">Aucune quittance sélectionnée.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Référence</p>
                  <p className="font-medium">{selectedRow.quittance.reference}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Date cession</p>
                  <p className="font-medium">{formatDate(selectedRow.quittance.cessionDate)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Date import</p>
                  <p className="font-medium">{selectedRow.importDate ? formatDate(selectedRow.importDate) : "—"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Délai</p>
                  <p className="font-medium">{selectedRow.nbJoursCedeImporte !== null ? `${selectedRow.nbJoursCedeImporte} jour(s)` : "—"}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Total quittance</p>
                  <p className="font-mono text-lg font-bold">{formatCurrency(selectedRow.totalQuittance)}</p>
                  <p className="text-xs text-muted-foreground">Montant cédé</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Importé</p>
                  <p className="font-mono text-lg font-bold">{formatCurrency(selectedRow.totalImporte)}</p>
                  <p className="text-xs text-muted-foreground">Montant reçu du factor</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Reliquat</p>
                  <p className="font-mono text-lg font-bold">{formatCurrency(Math.max(selectedRow.reliquat, 0))}</p>
                  <p className="text-xs text-muted-foreground">Retenue nette</p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Factures de la quittance</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Facture</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Montant</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedRow.invoices.map((inv) => (
                          <TableRow key={inv.id}>
                            <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                            <TableCell>{inv.vendorCustomer}</TableCell>
                            <TableCell>{formatDate(inv.invoiceDate)}</TableCell>
                            <TableCell className="text-right font-mono">{formatCurrency(inv.amountGross)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Historique import / retenue</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Virements importés</p>
                      <div className="space-y-2">
                        {selectedRow.virements.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Aucun import enregistré.</p>
                        ) : (
                          selectedRow.virements.map((v) => (
                            <div key={v.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                              <div>
                                <p className="font-medium">{v.type === "avance" ? "Avance" : "Règlement final"}</p>
                                <p className="text-xs text-muted-foreground">{formatDate(v.date)}</p>
                              </div>
                              <span className="font-mono font-semibold">{formatCurrency(v.amount)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Retenues / restitutions</p>
                      <div className="space-y-2">
                        {selectedRow.retentions.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Aucune retenue enregistrée.</p>
                        ) : (
                          selectedRow.retentions.map((r) => (
                            <div key={r.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                              <div>
                                <p className="font-medium">{r.type === "retenue" ? "Retenue" : "Restitution"}</p>
                                <p className="text-xs text-muted-foreground">{formatDate(r.date)}</p>
                              </div>
                              <span className="font-mono font-semibold">{formatCurrency(r.amount)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    toast.info("Vue quittance mise à jour.");
                    setSelectedQuittanceId(null);
                  }}
                >
                  <Info className="mr-2 h-4 w-4" />
                  Fermer
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
