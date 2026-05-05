import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "./imports";
import { Landmark, Link2, RefreshCcw } from "lucide-react";

type BridgeAccount = {
  id: string;
  name?: string;
  display_name?: string;
  iban?: string;
  balance?: number;
  currency_code?: string;
  currency?: string;
  data_access?: string;
};

type BridgeTransaction = {
  id: string;
  account_id?: string;
  amount?: number;
  currency_code?: string;
  currency?: string;
  clean_description?: string;
  label?: string;
  description?: string;
  date?: string;
  booking_date?: string;
  transaction_date?: string;
};

export default function Connecteurs() {
  const [bridgeAccounts, setBridgeAccounts] = useState<BridgeAccount[]>([]);
  const [bridgeTransactions, setBridgeTransactions] = useState<BridgeTransaction[]>([]);
  const [selectedBridgeAccountId, setSelectedBridgeAccountId] = useState<string>("");
  const [bridgeError, setBridgeError] = useState("");
  const [bridgeLoading, setBridgeLoading] = useState(false);

  const [jupiterApiUrl, setJupiterApiUrl] = useState("");
  const [jupiterApiKey, setJupiterApiKey] = useState("");
  const [jupiterConnected, setJupiterConnected] = useState(false);

  const handleConnectBank = async () => {
    try {
      setBridgeError("");
      const callbackUrl = `${window.location.origin}/connecteurs`;
      const res = await fetch("/api/bridge/connect-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callbackUrl,
          account_types: "payment",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        const detail =
          typeof data?.details === "string"
            ? data.details
            : data?.details?.message || data?.details?.error || "";
        setBridgeError(
          detail
            ? `${data?.error || "Échec d'initialisation de session d'agrégation"}: ${detail}`
            : (data?.error || "Échec d'initialisation de session d'agrégation")
        );
        return;
      }
      window.location.href = data.url;
    } catch {
      setBridgeError("Erreur inattendue lors de l'initialisation de session.");
    }
  };

  const loadBridgeAccounts = async () => {
    try {
      setBridgeLoading(true);
      setBridgeError("");
      const res = await fetch("/api/bridge/accounts", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBridgeError(data?.error || "Impossible de charger le référentiel de comptes");
        setBridgeAccounts([]);
        return;
      }
      const loaded = Array.isArray(data?.resources) ? data.resources : [];
      setBridgeAccounts(loaded);
      if (loaded[0]) setSelectedBridgeAccountId(String(loaded[0].id));
    } catch {
      setBridgeError("Erreur lors du chargement du référentiel de comptes.");
    } finally {
      setBridgeLoading(false);
    }
  };

  const loadBridgeTransactions = async (accountId?: string) => {
    try {
      setBridgeLoading(true);
      setBridgeError("");
      const target = accountId || selectedBridgeAccountId;
      if (!target) return;
      const res = await fetch(`/api/bridge/transactions?account_id=${encodeURIComponent(target)}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBridgeError(data?.error || "Impossible d'extraire les écritures bancaires");
        setBridgeTransactions([]);
        return;
      }
      setBridgeTransactions(Array.isArray(data?.resources) ? data.resources : []);
    } catch {
      setBridgeError("Erreur lors de l'extraction des écritures bancaires.");
    } finally {
      setBridgeLoading(false);
    }
  };

  const disconnectBridge = async () => {
    try {
      setBridgeLoading(true);
      setBridgeError("");
      const res = await fetch("/api/bridge/disconnect", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBridgeError(data?.error || "Impossible de déconnecter la banque");
        return;
      }
      setBridgeAccounts([]);
      setBridgeTransactions([]);
      setSelectedBridgeAccountId("");
      toast.success("Banque déconnectée.");
    } catch {
      setBridgeError("Erreur lors de la déconnexion bancaire.");
    } finally {
      setBridgeLoading(false);
    }
  };

  const handleConnectJupiter = () => {
    if (!jupiterApiUrl.trim() || !jupiterApiKey.trim()) {
      toast.error("Renseigne l'URL API et la clé API Jupiter.");
      return;
    }
    // Placeholder ready for real API integration.
    setJupiterConnected(true);
    toast.success("Jupiter prêt: configuration enregistrée.");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Connecteurs</h1>
          <p className="text-sm text-slate-600">
            Pilotage centralisé des flux financiers et des intégrations externes.
          </p>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pipeline d'Agrégation Financière</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {bridgeError ? (
            <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{bridgeError}</p>
          ) : null}
          <div className="grid gap-2 md:grid-cols-4">
            <Button onClick={handleConnectBank}>Initialiser la session</Button>
            <Button variant="outline" onClick={loadBridgeAccounts} disabled={bridgeLoading}>
              Charger les comptes
            </Button>
            <Button
              variant="outline"
              onClick={() => loadBridgeTransactions()}
              disabled={bridgeLoading || !selectedBridgeAccountId}
            >
              Charger les transactions
            </Button>
            <Button
              variant="destructive"
              onClick={disconnectBridge}
              disabled={bridgeLoading}
            >
              Déconnecter la banque
            </Button>
          </div>
          {bridgeAccounts.length > 0 ? (
            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              {bridgeAccounts.map((acc) => (
                <Button
                  key={String(acc.id)}
                  size="sm"
                  variant={selectedBridgeAccountId === String(acc.id) ? "default" : "outline"}
                  onClick={() => {
                    const id = String(acc.id);
                    setSelectedBridgeAccountId(id);
                    void loadBridgeTransactions(id);
                  }}
                >{acc.display_name || acc.name || acc.iban || id}</Button>
              ))}
            </div>
          ) : null}
          {bridgeTransactions.length > 0 ? (
            <div className="rounded-xl border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Date</TableHead>
                    <TableHead>Libellé</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bridgeTransactions.slice(0, 20).map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>{tx.date || tx.booking_date || tx.transaction_date || "—"}</TableCell>
                      <TableCell>{tx.clean_description || tx.label || tx.description || tx.id}</TableCell>
                      <TableCell className="text-right">
                        {tx.amount ?? "—"} {tx.currency_code || tx.currency || "EUR"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Connecteur Jupiter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Module prêt pour liaison API (endpoint + secret) et synchronisation pilotée.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              value={jupiterApiUrl}
              onChange={(e) => setJupiterApiUrl(e.target.value)}
              placeholder="Endpoint API"
            />
            <Input
              value={jupiterApiKey}
              onChange={(e) => setJupiterApiKey(e.target.value)}
              placeholder="Secret API"
              type="password"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleConnectJupiter}>
              <Landmark className="mr-1.5 h-4 w-4" />
              Valider la configuration
            </Button>
            <Button variant="outline" disabled>
              <RefreshCcw className="mr-1.5 h-4 w-4" />
              Exécuter la synchronisation (à implémenter)
            </Button>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Link2 className="h-3.5 w-3.5" />
              {jupiterConnected ? "Statut : configuré" : "Statut : en attente"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}