import { useEffect, useState, useRef, useMemo } from "react";
import {
  ArrowRight,
  Info,
  AlertTriangle,
  CheckCircle2,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from "./imports";

import { CurrencySummary, MetricCard, SectionCard } from "@/features/banque/components";
import {
  initialTransactions,
  localAccounts,
  localInvoices,
  sepaBatchesByReference as defaultSepaBatchesByReference,
  unreconciledCategoryLabels
} from "@/features/banque/data";

import type {
  BankViewMode,
  CurrencyCode,
  InvoiceFilter,
  LocalBankAccount,
  LocalInvoice,
  LocalTransaction,
  OperationType,
  PaymentMethod,
  ReconciliationFilter,
  SepaOperationCandidate,
  SepaOperationDecision,
  SepaOperationDecisionStatus,
  UnreconciledCategory,
  SepaBatchTemplate,
} from "@/features/banque/types";

import {
  amountMatchesRange,
  buildCandidateReasons,
  computeMatchScore,
  formatCompactAmount,
  formatDisplayDate,
  formatMoney,
  formatOperationLabel,
  getAccountById,
  getAvailableInvoicesForSepaOperation,
  getAvailableInvoicesForTxn,
  getCurrencyBadgeClass,
  getDecisionBadgeClass,
  getDecisionLabel,
  getInvoicesByIds,
  getMatchDetails,
  getSepaBadgeConfig,
  getSepaDecisionAmount,
  getTxnInvoiceIds,
  isPayrollCharge,
  isSepaBatchTransaction,
  normalizeText,
} from "@/features/banque/utils";

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
  updated_at?: string;
  category?: string | number;
  category_id?: number;
};

type BridgeCategory = {
  id: number;
  name?: string;
  categories?: {
    id: number;
    name?: string;
  }[];
};

type ImportedBankOperation = {
  id?: string;
  txnDate?: string;
  valueDate?: string;
  label?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  operationType?: OperationType;
  paymentMethod?: PaymentMethod;
  counterpartyName?: string | null;
  source?: string;
};

type ImportedDocumentDto = {
  _id?: string;
  id?: string;
  documentType?: string;
  structuredData?: {
    documentType?: string;
    account?: {
      iban?: string;
      currency?: string;
      closingBalance?: number;
    };
    operations?: ImportedBankOperation[];
    sepaBatch?: SepaBatchTemplate;
    summarizedOperation?: ImportedBankOperation;
  };
};

export default function Banque() {
  const [accounts] = useState<LocalBankAccount[]>(localAccounts);
  const [transactions, setTransactions] = useState<LocalTransaction[]>(initialTransactions);
  const [sepaBatchesByReference, setSepaBatchesByReference] = useState<Record<string, SepaBatchTemplate>>(
    defaultSepaBatchesByReference
  );

  const [bridgeCategories, setBridgeCategories] = useState<BridgeCategory[]>([]);
  const [bridgeLoadingCategories, setBridgeLoadingCategories] = useState(false);

  const [bridgeAccounts, setBridgeAccounts] = useState<BridgeAccount[]>([]);
  const [bridgeTransactions, setBridgeTransactions] = useState<BridgeTransaction[]>([]);
  const [bridgeLoadingAccounts, setBridgeLoadingAccounts] = useState(false);
  const [bridgeLoadingTransactions, setBridgeLoadingTransactions] = useState(false);
  const [bridgeError, setBridgeError] = useState<string>("");

  const [selectedBridgeAccountId, setSelectedBridgeAccountId] = useState<string>("");
  const [currentBridgeItemId, setCurrentBridgeItemId] = useState<string>("");

  const [selectedAccount, setSelectedAccount] = useState<string>("ba-eur");
  const [accountViewMode, setAccountViewMode] = useState<BankViewMode>("merged");

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReconciliationFilter>("all");
  const [currencyFilter, setCurrencyFilter] = useState<"" | CurrencyCode>("");
  const [operationTypeFilter, setOperationTypeFilter] = useState<"" | OperationType>("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<"" | PaymentMethod>("");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [counterpartyFilter, setCounterpartyFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sepaOnly, setSepaOnly] = useState(false);
  const [payrollOnly, setPayrollOnly] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [detailsSepaReference, setDetailsSepaReference] = useState<string | null>(null);
  const [detailsTxnId, setDetailsTxnId] = useState<string | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewPdfTitle, setPreviewPdfTitle] = useState("");

  const [manualInvoiceSelection, setManualInvoiceSelection] = useState<string[]>([]);
  const [manualCategory, setManualCategory] = useState<"" | UnreconciledCategory>("");
  const [manualComment, setManualComment] = useState("");
  const [manualReviewFlag, setManualReviewFlag] = useState(false);
  const [manualRejectAllSuggestions, setManualRejectAllSuggestions] = useState(false);

  const [sepaLineDecisions, setSepaLineDecisions] = useState<Record<string, SepaOperationDecision>>({});
  const [sepaCurrentOperationIndex, setSepaCurrentOperationIndex] = useState(0);

  const [autoload, setAutoload] = useState(true);

  const detailSectionRef = useRef<HTMLDivElement | null>(null);

  const getBridgeAccountName = (account: BridgeAccount) =>
    account.display_name || account.name || "Compte Bridge";

  const getBridgeTransactionLabel = (tx: BridgeTransaction) =>
    tx.clean_description || tx.label || tx.description || "Opération Bridge";

  const getBridgeTransactionDate = (tx: BridgeTransaction) =>
    tx.date || tx.transaction_date || tx.booking_date || tx.updated_at || "";

  const getBridgeTransactionCurrency = (tx: BridgeTransaction) =>
    tx.currency_code || tx.currency || "EUR";

  const resolveBankAccountId = (
    scannedIban: string | undefined,
    scannedCurrency: string | undefined
  ) => {
    if (scannedIban) {
      const byIban = accounts.find((a) => a.iban.replace(/\s/g, "") === scannedIban.replace(/\s/g, ""));
      if (byIban) return byIban.id;
    }
    if (scannedCurrency) {
      const byCurrency = accounts.find((a) => a.currency === scannedCurrency);
      if (byCurrency) return byCurrency.id;
    }
    return "ba-eur";
  };

  const handleDeleteImportedDocument = async (txn: LocalTransaction) => {
    if (!txn.sourceDocumentId) {
      toast?.error?.("Cette ligne n'est pas liée à un import supprimable.");
      return;
    }

    try {
      const response = await fetch(`/dev-imports/${encodeURIComponent(txn.sourceDocumentId)}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok && response.status !== 404) {
        throw new Error(payload?.error || "Suppression impossible");
      }

      const removedRefs = transactions
        .filter((t) => t.sourceDocumentId === txn.sourceDocumentId)
        .map((t) => t.reference);

      // Désactiver le rechargement automatique temporairement
      setAutoload(false);
      
      // Supprimer localement sans recharger depuis le backend
      setTransactions((prev) =>
        prev.filter((t) => t.sourceDocumentId !== txn.sourceDocumentId)
      );
      setSepaBatchesByReference((prev) => {
        const next = { ...prev };
        removedRefs.forEach((ref) => {
          delete next[ref];
        });
        return next;
      });
      if (detailsTxnId && detailsTxnId === txn.id) {
        setDetailsTxnId(null);
        setDetailsSepaReference(null);
      }
      toast?.success?.("Import supprimé depuis Banque.");
    } catch (error) {
      console.error("Erreur suppression import depuis Banque:", error);
      toast?.error?.("Impossible de supprimer l'import.");
    }
  };

  const resetFilters = () => {
    setSearchText("");
    setStatusFilter("all");
    setCurrencyFilter("");
    setOperationTypeFilter("");
    setPaymentMethodFilter("");
    setInvoiceFilter("all");
    setAccountFilter("all");
    setCounterpartyFilter("");
    setDateFrom("");
    setDateTo("");
    setMinAmount("");
    setMaxAmount("");
    setSepaOnly(false);
    setPayrollOnly(false);
  };

  const toggleAutoload = () => {
    setAutoload(prev => !prev);
  };

  const openInvoicePdf = (inv: LocalInvoice) => {
    if (inv.pdfUrl) {
      setPreviewPdfUrl(inv.pdfUrl);
      setPreviewPdfTitle(`${inv.invoiceNumber} — ${inv.vendorCustomer}`);
      return;
    }
    toast?.info?.("Visualisation PDF non disponible pour cette facture.");
  };

  const reconciledCount = transactions.filter((t) => t.reconciledStatus === "rapproché").length;
  const unreconciledCount = transactions.filter((t) => t.reconciledStatus === "non_rapproché").length;
  const currentViewCount = transactions.length;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-[1700px] space-y-6 p-4 md:p-6">
        <div className="rounded-[28px] bg-gradient-to-br from-white to-slate-100 p-6 shadow-sm ring-1 ring-black/5">
          <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Banque</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-500">
                Interface unifiée pour les comptes, les opérations, le rapprochement et les lots SEPA.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Recharger les données
              </button>

              <button
                onClick={toggleAutoload}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  autoload 
                    ? "bg-green-600 text-white hover:bg-green-700" 
                    : "bg-gray-600 text-white hover:bg-gray-700"
                }`}
              >
                {autoload ? "Auto-rechargement ON" : "Auto-rechargement OFF"}
              </button>
            </div>

            <div className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
              {(["merged", "EUR", "MAD", "USD"] as BankViewMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`rounded-xl px-4 py-2 text-sm transition ${
                    accountViewMode === mode
                      ? "bg-slate-900 font-semibold text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                  onClick={() => {
                    setAccountViewMode(mode);
                    if (mode !== "merged") {
                      const firstAccount = accounts.find((a) => a.currency === mode);
                      if (firstAccount) setSelectedAccount(firstAccount.id);
                    }
                  }}
                >
                  {mode === "merged" ? "Vue globale" : mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Opérations affichées"
            value={String(currentViewCount)}
            hint="Total des opérations"
            icon={<Info className="h-4 w-4 text-slate-400" />}
          />
          <MetricCard
            label="Rapprochées"
            value={String(reconciledCount)}
            hint="Dans la vue courante"
            icon={<CheckCircle2 className="h-4 w-4 text-slate-400" />}
          />
          <MetricCard
            label="À traiter"
            value={String(unreconciledCount)}
            hint="Non rapprochées"
            icon={<AlertTriangle className="h-4 w-4 text-slate-400" />}
          />
          <MetricCard
            label="Auto-rechargement"
            value={autoload ? "Activé" : "Désactivé"}
            hint="Rechargement automatique des imports"
            icon={<Info className="h-4 w-4 text-slate-400" />}
          />
        </div>

        <div className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-black/5">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Opérations bancaires</h2>
          
          {transactions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500">Aucune opération bancaire à afficher.</p>
              <p className="text-sm text-slate-400 mt-2">
                Importez des relevés bancaires pour voir les opérations ici.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((txn) => (
                <div
                  key={txn.id}
                  className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-slate-900">
                        {formatOperationLabel(txn.label)}
                      </div>
                      <div className="text-sm text-slate-500">
                        {txn.reference} • {formatDisplayDate(txn.txnDate)}
                      </div>
                      {txn.counterpartyName && (
                        <div className="text-sm text-slate-600">
                          {txn.counterpartyName}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 text-xs rounded-full ${getCurrencyBadgeClass(txn.currency)}`}>
                        {txn.currency}
                      </span>
                      <span className={`px-2 py-1 text-xs rounded-full ${getDecisionBadgeClass(txn.reconciledStatus)}`}>
                        {txn.reconciledStatus === "rapproché" ? "Rapproché" : "Non rapproché"}
                      </span>
                      {txn.sourceDocumentId && (
                        <button
                          onClick={() => handleDeleteImportedDocument(txn)}
                          className="px-2 py-1 text-xs bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
                        >
                          Supprimer
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
