import { notifyInvoicesChanged } from "@/lib/invoices-sync";
import { useState } from "react";
import {
  useNavigate,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
  Button,
  Input,
  Label,
  toast,
  Cloud,
  Eye,
  CheckCircle2,
} from "./imports";

type DetectedCategory =
  | "Relevé bancaire"
  | "Facture"
  | "Bulletin de paie"
  | "Quittance"
  | "SEPA XML"
  | "SEPA salaires"
  | "Document inconnu";

type PayrollImportSummary = {
  numberOfSlips?: number;
  periodLabel?: string | null;
  companyName?: string | null;
  totalNet?: number | null;
  currency?: string;
};

function mapPayrollSummary(structured: unknown): PayrollImportSummary | undefined {
  const batch = (structured as { payrollBatch?: PayrollImportSummary & { slips?: unknown[] } })
    ?.payrollBatch;
  if (!batch) return undefined;
  return {
    numberOfSlips: batch.numberOfSlips ?? (Array.isArray(batch.slips) ? batch.slips.length : undefined),
    periodLabel: batch.periodLabel ?? null,
    companyName: batch.companyName ?? null,
    totalNet: batch.totalNet ?? null,
    currency: batch.currency ?? "EUR",
  };
}

function destinationSuccessMessage(destination?: string | null) {
  if (destination === "banque") return "Le document a été envoyé dans Banque.";
  if (destination === "bulletins_paie") {
    return "Le document a été envoyé dans Bulletins de paie (fiches salariés extraites).";
  }
  return "Le document a été envoyé dans Factures.";
}

function destinationSentToast(destination?: string | null) {
  if (destination === "banque") return "Document envoyé dans Banque.";
  if (destination === "bulletins_paie") return "Document envoyé dans Bulletins de paie.";
  return "Document envoyé dans Factures.";
}

type ExtractedFields = {
  issuerName?: string | null;
  issuerSiret?: string | null;
  recipientName?: string | null;
  recipientSiret?: string | null;
  counterpartyRole?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  vatNumber?: string | null;
  iban?: string | null;
  swift?: string | null;
  reasonOfPayment?: string | null;
  amountNet?: string | number | null;
  vatAmount?: string | number | null;
  amountInclVat?: string | number | null;
  vendorCustomer?: string | null;
  currency?: string | null;
};

function mapStructuredInvoiceToFields(structured: any): ExtractedFields {
  if (!structured || structured.documentType !== "invoice") return {};
  return {
    vendorCustomer: structured.vendorCustomer ?? null,
    issuerName: structured.issuer?.name ?? null,
    issuerSiret: structured.issuer?.siret ?? null,
    recipientName: structured.recipient?.name ?? null,
    recipientSiret: structured.recipient?.siret ?? null,
    invoiceNumber: structured.invoiceNumber ?? null,
    invoiceDate: structured.invoiceDate ?? null,
    dueDate: structured.dueDate ?? null,
    amountInclVat: structured.amountInclVat ?? null,
    amountNet: structured.amountNet ?? null,
    vatAmount: structured.vatAmount ?? null,
    vatNumber: structured.vatNumber ?? null,
    reasonOfPayment: structured.reasonOfPayment ?? null,
    iban: structured.iban ?? null,
    swift: structured.swift ?? null,
    counterpartyRole: structured.counterpartyRole ?? null,
    currency: structured.currency ?? null,
  };
}

function sanitizePartyNameValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  const cut = str
    .split(
      /\b(?:total|montant|tva|ht\b|ttc\b|siret|siren|iban|bic|swift|r[èe]glement|date|facture|n[°º]|t[ée]l|email|@|adresse|page|esplanade|rue|avenue|boulevard)\b/i
    )[0]
    .trim();
  const cleaned = cut
    .replace(/[^A-Za-zÀ-ÿ0-9&'().,\-\/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > 90) return cleaned.slice(0, 90).trim();
  return cleaned;
}

function mergeInvoiceFields(
  structured: ExtractedFields,
  classification: ExtractedFields
): ExtractedFields {
  const merged: ExtractedFields = { ...classification, ...structured };
  const keysToStripIfEmpty: (keyof ExtractedFields)[] = [
    "issuerName",
    "recipientName",
    "vendorCustomer",
    "invoiceNumber",
    "invoiceDate",
    "iban",
  ];
  for (const key of keysToStripIfEmpty) {
    if (!merged[key] && classification[key]) {
      (merged as any)[key] = classification[key];
    }
  }
  for (const key of ["issuerName", "recipientName", "vendorCustomer"] as const) {
    const sanitized = sanitizePartyNameValue(merged[key]);
    (merged as any)[key] = sanitized;
  }
  return merged;
}

type ImportedFileItem = {
  id: string;
  file: File;
  detectedCategory: DetectedCategory | null;
  localReady: boolean;
  analyzing: boolean;
  analyzed: boolean;
  sending: boolean;
  sent: boolean;
  error: string | null;
  serverDocumentId?: string | null;
  backendStatus?: string | null;
  destination?: string | null;
  extractedType?: string | null;
  invoiceNature?: string | null;
  extractedFields?: ExtractedFields;
  payrollSummary?: PayrollImportSummary;
  sepaSummary?: SepaImportSummary;
};

const API_BASE_URL = "";

const FIELD_LABELS: Record<string, string> = {
  vendorCustomer: "Tiers",
  issuerName: "Émetteur",
  issuerSiret: "SIRET émetteur",
  recipientName: "Destinataire",
  recipientSiret: "SIRET destinataire",
  invoiceNumber: "N° facture",
  invoiceDate: "Date facture",
  dueDate: "Échéance",
  amountInclVat: "Montant TTC",
  amountNet: "Montant net",
  vatAmount: "Montant TVA",
  vatNumber: "TVA",
  reasonOfPayment: "Motif",
  iban: "IBAN",
  swift: "SWIFT",
  counterpartyRole: "Rôle tiers",
  currency: "Devise",
};

const FIELD_ORDER: (keyof ExtractedFields)[] = [
  "vendorCustomer",
  "issuerName",
  "recipientName",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "amountInclVat",
  "amountNet",
  "vatAmount",
  "vatNumber",
  "reasonOfPayment",
  "issuerSiret",
  "recipientSiret",
  "iban",
  "swift",
  "counterpartyRole",
  "currency",
];

function formatMoney(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNature(value?: string | null) {
  if (!value) return "—";
  if (value === "purchase") return "Achat";
  if (value === "sales") return "Vente";
  if (value === "unknown") return "Inconnue";
  return value;
}

function formatBackendType(value?: string | null) {
  if (!value) return "—";
  if (value === "invoice") return "Facture";
  if (value === "bank_statement") return "Relevé bancaire";
  if (value === "receipt") return "Quittance";
  if (value === "sepa_xml") return "SEPA XML";
  if (value === "payroll_bulk") return "Bulletin de paie";
  return value;
}

type SepaImportSummary = {
  batchType?: string;
  label?: string;
  numberOfTransactions?: number;
  totalAmount?: number | null;
  linkedSlipCount?: number;
  periodLabel?: string | null;
};

function mapSepaSummary(structured: unknown): SepaImportSummary | undefined {
  const batch = (structured as { sepaBatch?: SepaImportSummary & { type?: string } })?.sepaBatch;
  if (!batch?.label && !batch?.numberOfTransactions) return undefined;
  return {
    batchType: batch.type,
    label: batch.label,
    numberOfTransactions: batch.numberOfTransactions,
    totalAmount: batch.totalAmount ?? null,
    linkedSlipCount: (batch as { linkedSlipCount?: number }).linkedSlipCount,
    periodLabel: batch.periodLabel ?? null,
  };
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isNaN(value) ? null : value;
  }

  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .replace(/\u00A0/g, " ")
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(/EUR/gi, "")
    .replace(/MAD/gi, "")
    .replace(/DHS?/gi, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function isDisplayableValue(value: unknown) {
  if (value === null || value === undefined) return false;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed.toLowerCase() === "unknown") return false;
    return true;
  }

  return true;
}

function formatFieldValue(
  key: keyof ExtractedFields,
  value: unknown,
  fields: ExtractedFields
) {
  if (!isDisplayableValue(value)) return "—";

  if (key === "amountNet" || key === "vatAmount" || key === "amountInclVat") {
    const parsed = parseAmount(value);
    const currency = fields.currency?.trim();

    if (parsed !== null) {
      return `${formatMoney(parsed)}${currency ? ` ${currency}` : ""}`;
    }
  }

  return String(value);
}

function getDocumentStatusLabel(item: ImportedFileItem) {
  if (item.error) return "Erreur";
  if (item.sent) {
    if (item.destination === "banque") return "Envoyé vers Banque";
    if (item.destination === "bulletins_paie") return "Envoyé vers Bulletins de paie";
    return "Envoyé vers Factures";
  }
  if (item.sending) return "Envoi en cours";
  if (item.analyzing) return "Importation en cours ...";
  if (item.analyzed) return "Analyse terminée";
  if (item.localReady) return "Import prêt";
  return "Préparation...";
}

function getDocumentStatusClass(item: ImportedFileItem) {
  if (item.error) return "text-red-600";
  if (item.sent) return "text-emerald-600";
  if (item.sending || item.analyzing) return "text-blue-600";
  if (item.analyzed) return "text-violet-600";
  return "text-muted-foreground";
}

export default function ImportPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<ImportedFileItem[]>([]);

  const detectCategory = (file: File): DetectedCategory => {
    const name = file.name.toLowerCase();

    if (name.endsWith(".csv")) return "Relevé bancaire";
    if (name.endsWith(".xml")) {
      if (/salaire|paie|payroll|menisys|PAIE-/i.test(name)) return "SEPA salaires";
      return "SEPA XML";
    }
    if (name.includes("quittance")) return "Quittance";
    if (/bulletin|menisys|paie|payroll|fiche.?paie|salari|bulletins/i.test(name)) {
      return "Bulletin de paie";
    }
    if (
      name.includes("facture") ||
      name.endsWith(".pdf") ||
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".webp")
    ) {
      return "Facture";
    }

    return "Document inconnu";
  };

  const updateFile = (
    id: string,
    updater: (item: ImportedFileItem) => ImportedFileItem
  ) => {
    setFiles((prev) => prev.map((item) => (item.id === id ? updater(item) : item)));
  };

  const handleAnalyze = async (id: string) => {
    const item = files.find((f) => f.id === id);

    if (!item || !item.localReady) return;

    try {
      updateFile(id, (current) => ({
        ...current,
        analyzing: true,
        error: null,
      }));

      const formData = new FormData();
      formData.append("file", item.file);

      const response = await fetch(`${API_BASE_URL}/api/import/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Session expirée. Reconnecte-toi puis réessaie.");
        }
        throw new Error(data?.error || "Analyse échouée");
      }

      const extractedType =
        data?.classification?.label ??
        data?.document?.documentType ??
        (item.detectedCategory === "Facture" ? "invoice" : null);

      const fieldsFromClassification: ExtractedFields = data?.classification?.fields ?? {};
      const fieldsFromStructured: ExtractedFields = mapStructuredInvoiceToFields(data?.structuredData);
      const fields: ExtractedFields = mergeInvoiceFields(fieldsFromStructured, fieldsFromClassification);
      const invoiceNature =
        data?.classification?.invoiceNature ?? data?.document?.invoiceNature ?? null;

      const serverDocumentId = data?.document?.id ?? data?.document?._id ?? null;
      const destination = data?.document?.destination ?? data?.destination ?? null;
      const payrollSummary = mapPayrollSummary(data?.structuredData);
      const sepaSummary = mapSepaSummary(data?.structuredData);

      updateFile(id, (current) => ({
        ...current,
        analyzing: false,
        analyzed: true,
        sent: (data?.document?.status ?? null) === "sent",
        error: null,
        serverDocumentId,
        backendStatus: data?.document?.status ?? null,
        destination,
        extractedType,
        invoiceNature,
        extractedFields: fields,
        payrollSummary,
        sepaSummary,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur pendant l'analyse";

      updateFile(id, (current) => ({
        ...current,
        analyzing: false,
        analyzed: false,
        error: message,
      }));

      toast.error(`Échec de l'analyse : ${item.file.name}`);
    }
  };

  const handleSend = async (id: string) => {
    const item = files.find((f) => f.id === id);

    if (!item?.serverDocumentId) {
      toast.error("Document introuvable côté serveur.");
      return;
    }

    try {
      updateFile(id, (current) => ({
        ...current,
        sending: true,
        error: null,
      }));

      const response = await fetch(
        `${API_BASE_URL}/api/imports/${item.serverDocumentId}/send`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Session expirée. Reconnecte-toi puis réessaie.");
        }
        throw new Error(data?.error || "Erreur pendant l'envoi");
      }

      updateFile(id, (current) => ({
        ...current,
        sending: false,
        sent: true,
        destination: data?.document?.destination ?? "factures",
        backendStatus: data?.document?.status ?? "sent",
        error: null,
      }));

      const dest = data?.document?.destination ?? null;
      toast.success(destinationSentToast(dest));
      if (dest !== "banque" && dest !== "bulletins_paie") {
        notifyInvoicesChanged();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur pendant l'envoi";

      updateFile(id, (current) => ({
        ...current,
        sending: false,
        error: message,
      }));

      toast.error("Impossible d'envoyer ce document.");
    }
  };

  const handleFilesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) return;

    const newItems: ImportedFileItem[] = selectedFiles.map((file, index) => ({
      id: `${file.name}-${Date.now()}-${index}`,
      file,
      detectedCategory: null,
      localReady: false,
      analyzing: false,
      analyzed: false,
      sending: false,
      sent: false,
      error: null,
      serverDocumentId: null,
      backendStatus: null,
      destination: null,
      extractedType: null,
      invoiceNature: null,
      extractedFields: {},
    }));

    setFiles((prev) => [...prev, ...newItems]);

    newItems.forEach((item) => {
      setTimeout(async () => {
        const category = detectCategory(item.file);

        setFiles((prev) =>
          prev.map((current) =>
            current.id === item.id
              ? {
                  ...current,
                  detectedCategory: category,
                  localReady: true,
                }
              : current
          )
        );

        const formData = new FormData();
        formData.append("file", item.file);

        try {
          setFiles((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? {
                    ...current,
                    analyzing: true,
                    error: null,
                  }
                : current
            )
          );

          const response = await fetch(`${API_BASE_URL}/api/import/upload`, {
            method: "POST",
            credentials: "include",
            body: formData,
          });

          const data = await response.json();

          if (!response.ok) {
            if (response.status === 401) {
              throw new Error("Session expirée. Reconnecte-toi puis réessaie.");
            }
            throw new Error(data?.error || "Analyse échouée");
          }

          const extractedType =
            data?.classification?.label ??
            data?.document?.documentType ??
            (category === "Facture" ? "invoice" : null);

          const fieldsFromClassification: ExtractedFields = data?.classification?.fields ?? {};
          const fieldsFromStructured: ExtractedFields = mapStructuredInvoiceToFields(data?.structuredData);
          const fields: ExtractedFields = mergeInvoiceFields(fieldsFromStructured, fieldsFromClassification);
          const invoiceNature =
            data?.classification?.invoiceNature ?? data?.document?.invoiceNature ?? null;

          const serverDocumentId = data?.document?.id ?? data?.document?._id ?? null;
          const destination = data?.document?.destination ?? data?.destination ?? null;
          const payrollSummary = mapPayrollSummary(data?.structuredData);
          const sepaSummary = mapSepaSummary(data?.structuredData);

          setFiles((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? {
                    ...current,
                    analyzing: false,
                    analyzed: true,
                    sent: (data?.document?.status ?? null) === "sent",
                    error: null,
                    serverDocumentId,
                    backendStatus: data?.document?.status ?? null,
                    destination,
                    extractedType,
                    invoiceNature,
                    extractedFields: fields,
                    payrollSummary,
                    sepaSummary,
                  }
                : current
            )
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Erreur pendant l'analyse";

          setFiles((prev) =>
            prev.map((current) =>
              current.id === item.id
                ? {
                    ...current,
                    analyzing: false,
                    analyzed: false,
                    error: message,
                  }
                : current
            )
          );

          toast.error(`Échec de l'analyse : ${item.file.name}`);
        }
      }, 250);
    });

    event.target.value = "";
  };

  const handleRemove = async (id: string) => {
    const item = files.find((f) => f.id === id);

    if (item?.serverDocumentId) {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/imports/${item.serverDocumentId}`,
          {
            method: "DELETE",
            credentials: "include",
          }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok && response.status !== 404) {
          throw new Error(data?.error || "Suppression serveur impossible");
        }
      } catch (error) {
        toast.error("Impossible de supprimer cet import côté serveur.");
        return;
      }
    }

    setFiles((prev) => prev.filter((f) => f.id !== id));
    toast.success("Import supprimé.");
  };

  const handleReset = () => {
    setFiles([]);
  };

  const analyzedCount = files.filter((f) => f.analyzed).length;
  const sentCount = files.filter((f) => f.sent).length;
  const errorCount = files.filter((f) => !!f.error).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Import de documents</h1>
         
        </div>

        <Button variant="outline" onClick={() => navigate("/")}>
          Retour
        </Button>
      </div>

      <Card className="border-0 shadow-sm rounded-2xl">
        <CardContent className="pt-8">
          <div className="border-2 border-dashed rounded-2xl p-10 text-center bg-muted/20">
            <div className="flex justify-center mb-4">
              <Cloud className="h-10 w-10" />
            </div>

            <h2 className="text-lg font-semibold">Déposer vos documents</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Factures, bulletins de paie (PDF multi-salariés), relevés ou SEPA. Les données
              extraites s&apos;affichent automatiquement après l&apos;import.
            </p>

            <div className="max-w-md mx-auto mt-6 space-y-2">
              <Label>Sélectionner des documents</Label>
              <Input type="file" multiple onChange={handleFilesChange} />
            </div>
          </div>
        </CardContent>
      </Card>

      {files.length > 0 && (
        <Card className="border-0 shadow-sm rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Documents importés</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {files.length} document(s) • {analyzedCount} analysé(s) • {sentCount} envoyé(s)
                {errorCount > 0 ? ` • ${errorCount} en erreur` : ""}
              </p>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {files.map((item) => {
              const fields = item.extractedFields ?? {};
              const extractedEntries = FIELD_ORDER.map((key) => ({
                key,
                label: FIELD_LABELS[key],
                value: fields[key],
              })).filter((entry) => entry.label && isDisplayableValue(entry.value));

              return (
                <div
                  key={item.id}
                  className="border rounded-2xl p-4 flex flex-col gap-4 bg-white md:flex-row md:items-start md:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="space-y-1">
                      <p className="font-medium truncate">{item.file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Catégorie détectée localement : {item.detectedCategory || "Analyse locale..."}
                      </p>
                      <p className={`text-sm font-medium ${getDocumentStatusClass(item)}`}>
                        Statut : {getDocumentStatusLabel(item)}
                      </p>
                    </div>

                    {item.analyzed && (
                      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Eye className="h-4 w-4" />
                          Données extraites
                        </div>

                        <div className="grid gap-2 text-sm md:grid-cols-2">
                          <p>
                            <span className="font-medium">Type détecté :</span>{" "}
                            {formatBackendType(item.extractedType)}
                          </p>
                          {item.extractedType !== "payroll_bulk" ? (
                            <p>
                              <span className="font-medium">Nature détectée :</span>{" "}
                              {formatNature(item.invoiceNature)}
                            </p>
                          ) : null}
                        </div>

                        {item.sepaSummary ? (
                          <div
                            className={`rounded-lg border p-3 text-sm space-y-1 ${
                              item.sepaSummary.batchType === "payroll"
                                ? "border-violet-200 bg-violet-50/80 text-violet-950"
                                : "border-sky-200 bg-sky-50/80 text-sky-950"
                            }`}
                          >
                            <p className="font-medium">
                              {item.sepaSummary.batchType === "payroll"
                                ? "SEPA salaires"
                                : "Fichier SEPA"}
                            </p>
                            <p>{item.sepaSummary.label}</p>
                            <p>
                              {item.sepaSummary.numberOfTransactions ?? "—"} virement
                              {(item.sepaSummary.numberOfTransactions ?? 0) > 1 ? "s" : ""}
                              {item.sepaSummary.periodLabel
                                ? ` • ${item.sepaSummary.periodLabel}`
                                : ""}
                              {item.sepaSummary.totalAmount != null
                                ? ` • Total ${formatMoney(item.sepaSummary.totalAmount)} EUR`
                                : ""}
                            </p>
                            {item.sepaSummary.batchType === "payroll" ? (
                              <p className="text-xs opacity-90">
                                {typeof item.sepaSummary.linkedSlipCount === "number"
                                  ? `${item.sepaSummary.linkedSlipCount} fiche(s) reliée(s) aux bulletins de paie`
                                  : "Importez les bulletins du même mois pour relier automatiquement les salariés."}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {item.payrollSummary ? (
                          <div className="rounded-lg border border-violet-200 bg-violet-50/80 p-3 text-sm text-violet-950 space-y-1">
                            <p className="font-medium">Bulletin de paie éclaté</p>
                            <p>
                              {item.payrollSummary.numberOfSlips ?? "—"} fiche
                              {(item.payrollSummary.numberOfSlips ?? 0) > 1 ? "s" : ""} salarié
                              {(item.payrollSummary.numberOfSlips ?? 0) > 1 ? "s" : ""}
                              {item.payrollSummary.periodLabel
                                ? ` • Période ${item.payrollSummary.periodLabel}`
                                : ""}
                            </p>
                            {item.payrollSummary.companyName ? (
                              <p className="text-violet-800">{item.payrollSummary.companyName}</p>
                            ) : null}
                            {item.payrollSummary.totalNet != null ? (
                              <p>
                                Net total : {formatMoney(item.payrollSummary.totalNet)}
                                {item.payrollSummary.currency
                                  ? ` ${item.payrollSummary.currency}`
                                  : ""}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="grid gap-2 text-sm md:grid-cols-2">
                          {extractedEntries.length > 0 ? (
                            extractedEntries.map((entry) => (
                              <p key={String(entry.key)}>
                                <span className="font-medium">{entry.label} :</span>{" "}
                                {formatFieldValue(entry.key, entry.value, fields)}
                              </p>
                            ))
                          ) : (
                            <p className="text-muted-foreground">
                              Aucune donnée exploitable détectée.
                            </p>
                          )}
                        </div>

                        {item.sent && (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex gap-2">
                            <CheckCircle2 className="h-4 w-4 mt-0.5" />
                            <p>{destinationSuccessMessage(item.destination)}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {item.error && <p className="text-sm text-red-600">{item.error}</p>}
                  </div>

                  <div className="flex gap-2 flex-wrap md:justify-end md:max-w-[220px]">
                    <Button
                      onClick={() => handleSend(item.id)}
                      disabled={
                        !item.analyzed ||
                        item.sending ||
                        item.sent ||
                        item.backendStatus === "sent"
                      }
                    >
                      {item.sending ? "Envoi..." : item.sent ? "Envoyé" : "Envoyer"}
                    </Button>

                    <Button
                      variant="ghost"
                      onClick={() => handleRemove(item.id)}
                      disabled={item.analyzing || item.sending}
                    >
                      Supprimer
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>

          <CardFooter className="flex justify-between gap-3">
            <Button variant="secondary" onClick={handleReset}>
              Réinitialiser
            </Button>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate("/factures")}>
                Ouvrir Factures
              </Button>
              <Button variant="outline" onClick={() => navigate("/bulletins")}>
                Ouvrir Bulletins de paie
              </Button>
            </div>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}