import {
  useState,
  useNavigate,
  StatCard,
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
  StatusBadge,
  mockInvoices,
  mockTransactions,
  formatCurrency,
  formatDate,
  FileText,
  Landmark,
  ArrowLeftRight,
  Receipt,
  LayoutGrid,
  Minimize2,
  LayoutList,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Button,
} from "./imports";

type DashboardLayout = "complet" | "essentiel" | "liste";

const statusConfig: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  "encaissée": { icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
  "payée": { icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
  "à payer": { icon: Clock, color: "text-warning", bg: "bg-warning/10" },
  "en retard": { icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" },
};

export default function Dashboard() {
  const [layout, setLayout] = useState<DashboardLayout>("complet");

  const invoicesAPayer = mockInvoices.filter(i => i.type === "purchase");
  const invoicesAEncaisser = mockInvoices.filter(i => i.type === "sales");
  const nonRapprochees = mockTransactions.filter(t => t.reconciledStatus === "non_rapproché");
  const rapprochees = mockTransactions.filter(t => t.reconciledStatus === "rapproché");

  const tvaCollectee = mockInvoices.filter(i => i.type === "sales").reduce((s, i) => s + i.vatAmount, 0);
  const tvaDeductible = mockInvoices.filter(i => i.type === "purchase").reduce((s, i) => s + i.vatAmount, 0);
  const tvaNette = tvaCollectee - tvaDeductible;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tableau de bord</h1>
          <p className="text-muted-foreground">Vue d'ensemble de votre activité comptable</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
          <Button variant={layout === "complet" ? "default" : "ghost"} size="sm" onClick={() => setLayout("complet")} className="gap-2 text-xs">
            <LayoutGrid className="h-3.5 w-3.5" /> Complet
          </Button>
          <Button variant={layout === "essentiel" ? "default" : "ghost"} size="sm" onClick={() => setLayout("essentiel")} className="gap-2 text-xs">
            <Minimize2 className="h-3.5 w-3.5" /> Essentiel
          </Button>
          <Button variant={layout === "liste" ? "default" : "ghost"} size="sm" onClick={() => setLayout("liste")} className="gap-2 text-xs">
            <LayoutList className="h-3.5 w-3.5" /> Liste
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="cursor-pointer hover:shadow-md" onClick={() => navigate("/rapprochement")}> 
          <CardContent className="text-center">
            <p className="text-sm font-semibold">Rapprochement bancaire</p>
            <p className="text-xs text-muted-foreground">Accéder au module juste sous le tableau</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md" onClick={() => navigate("/import")}>
          <CardContent className="text-center">
            <p className="text-sm font-semibold">Import des données</p>
            <p className="text-xs text-muted-foreground">Tous les formats disponibles</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md" onClick={() => navigate("/banque")}>
          <CardContent className="text-center">
            <p className="text-sm font-semibold">Banque</p>
            <p className="text-xs text-muted-foreground">Suivi des comptes et opérations</p>
          </CardContent>
        </Card>
      </div>

      {/* ── COMPLET ── */}
      {layout === "complet" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Dettes" value={formatCurrency(invoicesAPayer.reduce((s, i) => s + i.amountGross, 0))} subtitle={`${invoicesAPayer.length} facture(s)`} icon={FileText} variant="warning" />
          <StatCard title="Créances" value={formatCurrency(invoicesAEncaisser.reduce((s, i) => s + i.amountGross, 0))} subtitle={`${invoicesAEncaisser.length} facture(s)`} icon={Landmark} variant="info" />
          <StatCard title="Non rapprochées" value={`${nonRapprochees.length}`} subtitle="Opérations bancaires" icon={ArrowLeftRight} variant="destructive" />
          <StatCard title="TVA nette (période)" value={formatCurrency(tvaNette)} subtitle={`Collectée ${formatCurrency(tvaCollectee)} − Déductible ${formatCurrency(tvaDeductible)}`} icon={Receipt} variant={tvaNette >= 0 ? "default" : "success"} />
        </div>
      )}

      {/* ── ESSENTIEL ── */}
      {layout === "essentiel" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="relative overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Non rapprochées</p>
                  <p className="text-4xl font-bold tracking-tight text-foreground">{nonRapprochees.length}</p>
                  <p className="text-sm text-muted-foreground">Opérations bancaires en attente</p>
                  <div className="pt-2 space-y-1">
                    {nonRapprochees.slice(0, 3).map(t => (
                      <div key={t.id} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="truncate max-w-[180px]">{t.label}</span>
                        <span className="font-mono">{formatCurrency(t.amount)}</span>
                      </div>
                    ))}
                    {nonRapprochees.length > 3 && <p className="text-xs text-muted-foreground/60">+{nonRapprochees.length - 3} autres…</p>}
                  </div>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                  <ArrowLeftRight className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="relative overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">TVA nette (période)</p>
                  <p className="text-4xl font-bold tracking-tight text-foreground">{formatCurrency(tvaNette)}</p>
                  <div className="pt-2 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Collectée</p>
                      <p className="text-sm font-semibold font-mono text-foreground">{formatCurrency(tvaCollectee)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Déductible</p>
                      <p className="text-sm font-semibold font-mono text-foreground">{formatCurrency(tvaDeductible)}</p>
                    </div>
                  </div>
                </div>
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${tvaNette >= 0 ? "bg-primary/10 text-primary" : "bg-success/10 text-success"}`}>
                  <Receipt className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── LISTE (centré rapprochement + TVA) ── */}
      {layout === "liste" && (
        <div className="space-y-6">
          {/* Rapprochement summary */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Rapprochement bancaire</h2>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10">
                  <ArrowLeftRight className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="text-xs text-destructive font-semibold">Non rapprochées</p>
                  <p className="text-lg font-bold font-mono tracking-tight">{nonRapprochees.length}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-xs text-success font-semibold">Rapprochées</p>
                  <p className="text-lg font-bold font-mono tracking-tight">{rapprochees.length}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm col-span-2 lg:col-span-1">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <Landmark className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-primary font-semibold">Total opérations</p>
                  <p className="text-lg font-bold font-mono tracking-tight">{mockTransactions.length}</p>
                </div>
              </div>
            </div>
          </div>

          {/* TVA summary */}
          <div>
            <h2 className="text-lg font-semibold mb-4">TVA — Résumé de la période</h2>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-primary font-semibold">TVA collectée</p>
                  <p className="text-lg font-bold font-mono tracking-tight">{formatCurrency(tvaCollectee)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10">
                  <TrendingDown className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-xs text-warning font-semibold">TVA déductible</p>
                  <p className="text-lg font-bold font-mono tracking-tight">{formatCurrency(tvaDeductible)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tvaNette >= 0 ? "bg-destructive/10" : "bg-success/10"}`}>
                  <Receipt className={`h-5 w-5 ${tvaNette >= 0 ? "text-destructive" : "text-success"}`} />
                </div>
                <div>
                  <p className={`text-xs font-semibold ${tvaNette >= 0 ? "text-destructive" : "text-success"}`}>{tvaNette >= 0 ? "TVA à reverser" : "Crédit de TVA"}</p>
                  <p className="text-lg font-bold font-mono tracking-tight">{formatCurrency(Math.abs(tvaNette))}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Opérations non rapprochées list */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Opérations non rapprochées</h2>
            <div className="space-y-3">
              {nonRapprochees.map(txn => (
                <div key={txn.id} className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${txn.amount < 0 ? "bg-destructive/10" : "bg-success/10"}`}>
                    {txn.amount < 0 ? <TrendingDown className="h-5 w-5 text-destructive" /> : <TrendingUp className="h-5 w-5 text-success" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{txn.label}</p>
                    <p className="text-xs text-muted-foreground">{txn.reference}</p>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-nowrap hidden sm:block">{formatDate(txn.txnDate)}</p>
                  <p className={`text-sm font-bold font-mono whitespace-nowrap ${txn.amount < 0 ? "text-destructive" : "text-success"}`}>{formatCurrency(txn.amount)}</p>
                </div>
              ))}
              {nonRapprochees.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Toutes les opérations sont rapprochées ✓</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tables (hidden in liste mode) */}
      {layout !== "liste" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Dernières factures</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>N°</TableHead><TableHead>Tiers</TableHead><TableHead className="text-right">TTC</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
                <TableBody>
                  {mockInvoices.slice(0, 5).map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm">{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.vendorCustomer}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(inv.amountGross)}</TableCell>
                      <TableCell><StatusBadge status={inv.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Dernières opérations bancaires</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Libellé</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
                <TableBody>
                  {mockTransactions.slice(-5).reverse().map(txn => (
                    <TableRow key={txn.id}>
                      <TableCell className="text-sm">{formatDate(txn.txnDate)}</TableCell>
                      <TableCell className="text-sm">{txn.label}</TableCell>
                      <TableCell className={`text-right font-mono ${txn.amount < 0 ? "text-destructive" : "text-success"}`}>{formatCurrency(txn.amount)}</TableCell>
                      <TableCell><StatusBadge status={txn.reconciledStatus} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
