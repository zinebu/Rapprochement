import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  toast,
} from "./imports";
import {
  Plug,
  RefreshCcw,
  Settings,
  CheckCircle2,
  AlertCircle,
  Clock3,
  Database,
  Link2,
  ShieldCheck,
} from "lucide-react";

type ConnectorStatus = "connected" | "disconnected" | "error" | "syncing";

interface ConnectorItem {
  id: string;
  name: string;
  type: string;
  description: string;
  status: ConnectorStatus;
  lastSync: string | null;
  syncedData: string[];
}

const initialConnectors: ConnectorItem[] = [
  {
    id: "openclaw",
    name: "OpenClaw",
    type: "Plateforme métier",
    description:
      "Connexion à une plateforme métier pour récupérer des documents et opérations.",
    status: "connected",
    lastSync: "12/03/2026 10:42",
    syncedData: ["Documents", "Opérations", "Référentiels"],
  },
  {
    id: "crm-jupiter",
    name: "CRM Jupiter",
    type: "CRM",
    description:
      "Synchronisation des clients, ventes et informations commerciales.",
    status: "disconnected",
    lastSync: null,
    syncedData: ["Clients", "Ventes", "Contacts"],
  },
  {
    id: "bank-api",
    name: "Banque",
    type: "API bancaire",
    description:
      "Récupération des mouvements bancaires pour faciliter le suivi comptable.",
    status: "error",
    lastSync: "11/03/2026 16:05",
    syncedData: ["Transactions", "Paiements", "Soldes"],
  },
];

const syncHistory = [
  {
    id: 1,
    connector: "OpenClaw",
    date: "12/03/2026 10:42",
    result: "Succès",
    detail: "24 documents synchronisés",
  },
  {
    id: 2,
    connector: "Banque",
    date: "11/03/2026 16:05",
    result: "Échec",
    detail: "Authentification expirée",
  },
  {
    id: 3,
    connector: "OpenClaw",
    date: "10/03/2026 09:20",
    result: "Succès",
    detail: "12 opérations importées",
  },
];

function getStatusLabel(status: ConnectorStatus) {
  switch (status) {
    case "connected":
      return "Connecté";
    case "disconnected":
      return "Non connecté";
    case "error":
      return "Erreur";
    case "syncing":
      return "Synchronisation";
    default:
      return "Inconnu";
  }
}

function getStatusBadgeClass(status: ConnectorStatus) {
  switch (status) {
    case "connected":
      return "bg-success/10 text-success border-success/20";
    case "disconnected":
      return "bg-muted text-muted-foreground border-border";
    case "error":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "syncing":
      return "bg-info/10 text-info border-info/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function getStatusIcon(status: ConnectorStatus) {
  switch (status) {
    case "connected":
      return <CheckCircle2 className="h-4 w-4" />;
    case "disconnected":
      return <Clock3 className="h-4 w-4" />;
    case "error":
      return <AlertCircle className="h-4 w-4" />;
    case "syncing":
      return <RefreshCcw className="h-4 w-4" />;
    default:
      return <Plug className="h-4 w-4" />;
  }
}

export default function Connecteurs() {
  const [connectors, setConnectors] = useState<ConnectorItem[]>(initialConnectors);

  const stats = useMemo(() => {
    return {
      total: connectors.length,
      connected: connectors.filter((c) => c.status === "connected").length,
      disconnected: connectors.filter((c) => c.status === "disconnected").length,
      error: connectors.filter((c) => c.status === "error").length,
    };
  }, [connectors]);

  const handleConnect = (id: string) => {
    setConnectors((prev) =>
      prev.map((connector) =>
        connector.id === id
          ? {
              ...connector,
              status: "connected",
              lastSync: new Date().toLocaleString("fr-FR"),
            }
          : connector
      )
    );
    toast.success("Connecteur activé avec succès.");
  };

  const handleSync = (id: string) => {
    setConnectors((prev) =>
      prev.map((connector) =>
        connector.id === id
          ? {
              ...connector,
              status: "syncing",
            }
          : connector
      )
    );

    setTimeout(() => {
      setConnectors((prev) =>
        prev.map((connector) =>
          connector.id === id
            ? {
                ...connector,
                status: "connected",
                lastSync: new Date().toLocaleString("fr-FR"),
              }
            : connector
        )
      );
      toast.success("Synchronisation terminée.");
    }, 1200);
  };

  const handleConfigure = (name: string) => {
    toast.info(`Ouverture de la configuration de ${name}.`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Connecteurs</h1>
        <p className="text-muted-foreground">
          Gérez les connexions avec vos systèmes externes pour synchroniser
          automatiquement vos clients, documents, ventes, paiements et autres
          données métier.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Plug className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total connecteurs</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Connectés</p>
                <p className="text-2xl font-bold">{stats.connected}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Clock3 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Non connectés</p>
                <p className="text-2xl font-bold">{stats.disconnected}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">En erreur</p>
                <p className="text-2xl font-bold">{stats.error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Connector cards */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {connectors.map((connector) => (
          <Card key={connector.id} className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{connector.name}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {connector.type}
                  </p>
                </div>

                <div
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
                    connector.status
                  )}`}
                >
                  {getStatusIcon(connector.status)}
                  {getStatusLabel(connector.status)}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {connector.description}
              </p>

              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Données synchronisées</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {connector.syncedData.map((item) => (
                    <span
                      key={item}
                      className="rounded-md bg-background px-2 py-1 text-xs text-muted-foreground border"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Dernière synchronisation</span>
                </div>
                <p className="text-muted-foreground">
                  {connector.lastSync ?? "Jamais synchronisé"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {connector.status === "disconnected" ? (
                  <Button size="sm" onClick={() => handleConnect(connector.id)}>
                    Connecter
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSync(connector.id)}
                  >
                    <RefreshCcw className="mr-1.5 h-4 w-4" />
                    Synchroniser
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleConfigure(connector.name)}
                >
                  <Settings className="mr-1.5 h-4 w-4" />
                  Configurer
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Why useful */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Utilité du module</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <Plug className="h-4 w-4 text-primary" />
                <p className="font-medium">Connexion aux outils externes</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Relie l’application à des systèmes comme un CRM, une plateforme
                métier ou une banque.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <RefreshCcw className="h-4 w-4 text-primary" />
                <p className="font-medium">Synchronisation automatique</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Évite les imports manuels répétés et garde les données à jour.
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <p className="font-medium">Fiabilité des données</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Réduit les doublons, les erreurs de ressaisie et améliore la
                cohérence comptable.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sync history */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Historique des synchronisations
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connecteur</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Résultat</TableHead>
                <TableHead>Détail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {syncHistory.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.connector}</TableCell>
                  <TableCell>{item.date}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        item.result === "Succès"
                          ? "border-success/20 bg-success/10 text-success"
                          : "border-destructive/20 bg-destructive/10 text-destructive"
                      }
                    >
                      {item.result}
                    </Badge>
                  </TableCell>
                  <TableCell>{item.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}