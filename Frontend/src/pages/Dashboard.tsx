import {
  useState,
  useEffect,
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
  TrendingUp,
  TrendingDown,
  Button,
} from "./imports";
import type { Invoice } from "@/lib/mock-data";

type DashboardLayout = "complet" | "essentiel" | "liste";

type DashboardTxn = {
  id: string;
  txnDate: string;
  label: string;
  reference: string;
  amount: number;
  currency: string;
  reconciledStatus: "non_rapproché" | "partiel" | "rapproché";
};

const RECONCILIATION_CACHE_KEY = "banque_reconciliation_cache_v1";

function readLocalReconciliationCache(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(RECONCILIATION_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const makeRecoCacheKey = (sourceDocumentId: string, operationId: string) =>
  `${sourceDocumentId}::${operationId}`;

function invoiceReconciledForTva(status?: string | null): boolean {
  const s = String(status || "").toLowerCase();
  return (
    s === "rapprochée" ||
    s === "rapprochee" ||
    s === "rapproché" ||
    s === "reconciled"
  );
}

/** Tri décroissant par date d'opération */
function sortTxnsDesc(txns: DashboardTxn[]): DashboardTxn[] {
  return [...txns].sort((a, b) => {
    const ta = new Date(a.txnDate || 0).getTime();
    const tb = new Date(b.txnDate || 0).getTime();
    return tb - ta;
  });
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [layout, setLayout] = useState<DashboardLayout>("complet");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [transactions, setTransactions] = useState<DashboardTxn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const localCache = readLocalReconciliationCache();

        const [invRes, impRes] = await Promise.all([
          fetch("/api/invoices", { credentials: "include" }),
          fetch("/api/imports", { credentials: "include" }),
        ]);

        const invPayload = await invRes.json().catch(() => ({}));
        const nextInvoices: Invoice[] =
          invRes.ok && Array.isArray(invPayload?.invoices) ? invPayload.invoices : [];
        setInvoices(nextInvoices);

        const impPayload = await impRes.json().catch(() => ({}));
        const importedDocs = Array.isArray(impPayload?.documents) ? impPayload.documents : [];

        const scanned: DashboardTxn[] = [];

        importedDocs.forEach((doc: Record<string, unknown>) => {
          const docId = String(doc.id || (doc as { _id?: string })._id || "");
          const structured = doc.structuredData as Record<string, unknown> | undefined;
          const docType = String(
            (structured?.documentType as string) || (doc.documentType as string) || ""
          );
          const persistedOps =
            (structured?.reconciliation as { operations?: Record<string, unknown> })?.operations ||
            {};

          if (docType === "bank_statement" && Array.isArray(structured?.operations)) {
            const ops = structured!.operations as Array<Record<string, unknown>>;
            const accountCurrency = String(
              (structured as { account?: { currency?: string } })?.account?.currency || "EUR"
            );

            ops.forEach((op, index) => {
              if (!op?.txnDate || typeof op.amount !== "number") return;
              const opType = String(op.operationType || "").toLowerCase();
              const hay = `${op.label || ""} ${op.reference || ""} ${op.bankOperationType || ""}`.toLowerCase();
              const absAmount = Math.abs(Number(op.amount || 0));
              let normalizedAmount = Number(op.amount || 0);
              if (normalizedAmount >= 0) {
                if (opType === "decaissement") normalizedAmount = -absAmount;
                else if (opType === "encaissement") normalizedAmount = absAmount;
                else if (
                  /\bvir\.?\s*re[çc]u\b|\bencaissement\b|\bversement\b|\bcr[eé]dit\b/.test(hay)
                ) {
                  normalizedAmount = absAmount;
                } else if (
                  /\brem\s+vir\s+sepa\b|\bfourn\b|\bvir\.?\s*[eé]mis\b|\bpr[eé]l[eè]v|\bcb\b|\bcarte\b|\bd[eé]bit\b/.test(
                    hay
                  )
                ) {
                  normalizedAmount = -absAmount;
                } else {
                  normalizedAmount = -absAmount;
                }
              }
              const opId = String(op.id || `${docId}-op-${index + 1}`);
              const localPersisted =
                (localCache[makeRecoCacheKey(docId, opId)] as Record<string, unknown>) || {};
              const persisted = {
                ...((persistedOps[opId] || {}) as Record<string, unknown>),
                ...localPersisted,
              };
              const reco = String(persisted.reconciledStatus || "non_rapproché") as DashboardTxn["reconciledStatus"];
              scanned.push({
                id: opId,
                txnDate: String(op.txnDate),
                label: String(op.label || "Opération"),
                reference: String(op.reference || `${docId}-${index + 1}`),
                amount: normalizedAmount,
                currency: String(op.currency || accountCurrency || "EUR"),
                reconciledStatus:
                  reco === "rapproché" || reco === "partiel" || reco === "non_rapproché"
                    ? reco
                    : "non_rapproché",
              });
            });
          }
        });

        const existingIds = new Set(scanned.map((t) => t.id));

        try {
          const bridgeAccountsRes = await fetch("/api/bridge/accounts", {
            credentials: "include",
          });
          const bridgeAccountsData = await bridgeAccountsRes.json().catch(() => ({}));
          const bridgeAccounts = Array.isArray(bridgeAccountsData?.resources)
            ? bridgeAccountsData.resources
            : [];

          for (const account of bridgeAccounts) {
            const accountId = String((account as { id?: string })?.id || "");
            if (!accountId) continue;
            const txRes = await fetch(
              `/api/bridge/transactions?account_id=${encodeURIComponent(accountId)}`,
              { credentials: "include" }
            );
            const txData = await txRes.json().catch(() => ({}));
            const resources = Array.isArray(txData?.resources) ? txData.resources : [];
            resources.forEach((tx: Record<string, unknown>, index: number) => {
              const amount = Number(tx?.amount || 0);
              const txnDate = String(
                tx?.date ||
                  tx?.transaction_date ||
                  tx?.booking_date ||
                  new Date().toISOString().slice(0, 10)
              );
              const id = `bridge-${accountId}-${String(tx?.id || index + 1)}`;
              if (existingIds.has(id)) return;
              existingIds.add(id);
              scanned.push({
                id,
                txnDate,
                label: String(
                  tx?.clean_description || tx?.label || tx?.description || "Opération bancaire"
                ),
                reference: String(tx?.id || id),
                amount,
                currency: String(tx?.currency_code || tx?.currency || "EUR"),
                reconciledStatus: "non_rapproché",
              });
            });
          }
        } catch {
          /* Bridge optionnel */
        }

        setTransactions(scanned);
      } catch (e) {
        console.error("Dashboard load error:", e);
        setInvoices([]);
        setTransactions([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const invoicesAPayer = invoices.filter((i) => i.type === "purchase");
  const invoicesAEncaisser = invoices.filter((i) => i.type === "sales");

  const nonRapprochees = transactions.filter((t) => t.reconciledStatus === "non_rapproché");
  const rapprochees = transactions.filter((t) => t.reconciledStatus === "rapproché");

  const reconciledInvoices = invoices.filter((i) => invoiceReconciledForTva(i.status));

  const tvaCollectee = reconciledInvoices
    .filter((i) => i.type === "sales")
    .reduce((s, i) => s + Number(i.vatAmount || 0), 0);
  const tvaDeductible = reconciledInvoices
    .filter((i) => i.type === "purchase")
    .reduce((s, i) => s + Number(i.vatAmount || 0), 0);
  const tvaNette = tvaCollectee - tvaDeductible;

  const latestInvoices = invoices.slice(0, 5);
  const latestTxns = sortTxnsDesc(transactions).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tableau de bord</h1>
          <p className="text-muted-foreground">Vue d'ensemble de votre activité comptable</p>
          {loading && (
            <p className="text-xs text-muted-foreground mt-1">Chargement des données…</p>
          )}
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
          <Button
            variant={layout === "complet" ? "default" : "ghost"}
            size="sm"
            onClick={() => setLayout("complet")}
            className="gap-2 text-xs"
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Complet
          </Button>
          <Button
            variant={layout === "essentiel" ? "default" : "ghost"}
            size="sm"
            onClick={() => setLayout("essentiel")}
            className="gap-2 text-xs"
          >
            <Minimize2 className="h-3.5 w-3.5" /> Essentiel
          </Button>
          <Button
            variant={layout === "liste" ? "default" : "ghost"}
            size="sm"
            onClick={() => setLayout("liste")}
            className="gap-2 text-xs"
          >
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

      {layout === "complet" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Dettes"
            value={formatCurrency(
              invoicesAPayer.reduce((s, i) => s + Number(i.amountGross || 0), 0)
            )}
            subtitle={`${invoicesAPayer.length} facture(s)`}
            icon={FileText}
            variant="warning"
          />
          <StatCard
            title="Créances"
            value={formatCurrency(
              invoicesAEncaisser.reduce((s, i) => s + Number(i.amountGross || 0), 0)
            )}
            subtitle={`${invoicesAEncaisser.length} facture(s)`}
            icon={Landmark}
            variant="info"
          />
          <StatCard
            title="Non rapprochées"
            value={`${nonRapprochees.length}`}
            subtitle="Opérations bancaires"
            icon={ArrowLeftRight}
            variant="destructive"
          />
          <StatCard
            title="TVA nette (factures rapprochées)"
            value={formatCurrency(tvaNette)}
            subtitle={`Collectée ${formatCurrency(tvaCollectee)} − Déductible ${formatCurrency(
              tvaDeductible
            )}`}
            icon={Receipt}
            variant={tvaNette >= 0 ? "default" : "success"}
          />
        </div>
      )}

      {layout === "essentiel" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="relative overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Non rapprochées</p>
                  <p className="text-4xl font-bold tracking-tight text-foreground">
                    {nonRapprochees.length}
                  </p>
                  <p className="text-sm text-muted-foreground">Opérations bancaires en attente</p>
                  <div className="pt-2 space-y-1">
                    {sortTxnsDesc(nonRapprochees)
                      .slice(0, 3)
                      .map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between text-xs text-muted-foreground"
                        >
                          <span className="truncate max-w-[180px]">{t.label}</span>
                          <span className="font-mono">
                            {formatCurrency(t.amount, t.currency || "EUR")}
                          </span>
                        </div>
                      ))}
                    {nonRapprochees.length > 3 && (
                      <p className="text-xs text-muted-foreground/60">
                        +{nonRapprochees.length - 3} autres…
                      </p>
                    )}
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
                  <p className="text-sm font-medium text-muted-foreground">
                    TVA nette (factures rapprochées)
                  </p>
                  <p className="text-4xl font-bold tracking-tight text-foreground">
                    {formatCurrency(tvaNette)}
                  </p>
                  <div className="pt-2 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Collectée</p>
                      <p className="text-sm font-semibold font-mono text-foreground">
                        {formatCurrency(tvaCollectee)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Déductible</p>
                      <p className="text-sm font-semibold font-mono text-foreground">
                        {formatCurrency(tvaDeductible)}
                      </p>
                    </div>
                  </div>
                </div>
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                    tvaNette >= 0 ? "bg-primary/10 text-primary" : "bg-success/10 text-success"
                  }`}
                >
                  <Receipt className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {layout === "liste" && (
        <div className="space-y-6">
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
                  <p className="text-lg font-bold font-mono tracking-tight">{transactions.length}</p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">TVA — Résumé (factures rapprochées)</h2>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-primary font-semibold">TVA collectée</p>
                  <p className="text-lg font-bold font-mono tracking-tight">
                    {formatCurrency(tvaCollectee)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10">
                  <TrendingDown className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-xs text-warning font-semibold">TVA déductible</p>
                  <p className="text-lg font-bold font-mono tracking-tight">
                    {formatCurrency(tvaDeductible)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${tvaNette >= 0 ? "bg-destructive/10" : "bg-success/10"}`}
                >
                  <Receipt
                    className={`h-5 w-5 ${tvaNette >= 0 ? "text-destructive" : "text-success"}`}
                  />
                </div>
                <div>
                  <p
                    className={`text-xs font-semibold ${tvaNette >= 0 ? "text-destructive" : "text-success"}`}
                  >
                    {tvaNette >= 0 ? "TVA à reverser" : "Crédit de TVA"}
                  </p>
                  <p className="text-lg font-bold font-mono tracking-tight">
                    {formatCurrency(Math.abs(tvaNette))}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">Opérations non rapprochées</h2>
            <div className="space-y-3">
              {nonRapprochees.map((txn) => (
                <div
                  key={txn.id}
                  className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                      txn.amount < 0 ? "bg-destructive/10" : "bg-success/10"
                    }`}
                  >
                    {txn.amount < 0 ? (
                      <TrendingDown className="h-5 w-5 text-destructive" />
                    ) : (
                      <TrendingUp className="h-5 w-5 text-success" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{txn.label}</p>
                    <p className="text-xs text-muted-foreground">{txn.reference}</p>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-nowrap hidden sm:block">
                    {formatDate(txn.txnDate)}
                  </p>
                  <p
                    className={`text-sm font-bold font-mono whitespace-nowrap ${
                      txn.amount < 0 ? "text-destructive" : "text-success"
                    }`}
                  >
                    {formatCurrency(txn.amount, txn.currency || "EUR")}
                  </p>
                </div>
              ))}
              {nonRapprochees.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Toutes les opérations chargées sont rapprochées ou aucune opération importée.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {layout !== "liste" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Dernières factures</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N°</TableHead>
                    <TableHead>Tiers</TableHead>
                    <TableHead className="text-right">TTC</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestInvoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm">{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.vendorCustomer}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(inv.amountGross, inv.currency || "EUR")}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && latestInvoices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        Aucune facture en base.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Dernières opérations bancaires</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Libellé</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestTxns.map((txn) => (
                    <TableRow key={txn.id}>
                      <TableCell className="text-sm">{formatDate(txn.txnDate)}</TableCell>
                      <TableCell className="text-sm">{txn.label}</TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          txn.amount < 0 ? "text-destructive" : "text-success"
                        }`}
                      >
                        {formatCurrency(txn.amount, txn.currency || "EUR")}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={txn.reconciledStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && latestTxns.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        Aucune opération (importez un relevé ou connectez Bridge).
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
