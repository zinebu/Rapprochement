import {
  useEffect, useMemo, useRef, useState, Card,
  CardContent,
  CardHeader, CardTitle, Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  StatusBadge,
  Landmark,
  Wallet,
  ChevronDown,
  ChevronUp,
  Briefcase,
  Users,
  FileSearch,
  Link2,
  MoreHorizontal,
  Building2,
  Receipt,
  Check,
  Undo2,
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

  const [autoload, setAutoload] = useState(true); // Ajouter un flag pour éviter le rechargement automatique après suppression

  useEffect(() => {
    if (autoload) {
      const loadScannedBankOperations = async () => {
        try {
          const res = await fetch("/api/imports", {
            credentials: "include",
          });

          const payload = await res.json();
          if (!res.ok) return;

          const importedDocs: ImportedDocumentDto[] = Array.isArray(payload?.documents) ? payload.documents : [];
          const scannedTransactions: LocalTransaction[] = [];
          const scannedSepaBatches: Record<string, SepaBatchTemplate> = {};

          importedDocs.forEach((doc) => {
            const docId = doc.id || doc._id || "";
            const structured = doc.structuredData;
            const docType = structured?.documentType || doc.documentType;
            const accountIban = structured?.account?.iban;
            const accountCurrency = structured?.account?.currency || "EUR";
            const bankAccountId = resolveBankAccountId(accountIban, accountCurrency);
            const fallbackBalance = Number(structured?.account?.closingBalance || 0);

            structured.operations.forEach((op, index) => {
              if (!op?.txnDate || typeof op.amount !== "number") return;
              scannedTransactions.push({
                id: op.id || `${docId}-op-${index + 1}`,
                sourceDocumentId: docId,
                bankAccountId,
                txnDate: op.txnDate,
                label: op.label || "Opération scannée",
                rawLabel: (op as any).rawLabel,
                reference: op.reference || `${docId}-${index + 1}`,
                amount: op.amount,
                balance: fallbackBalance,
                reconciledStatus: "non_rapproché",
                currency: (op.currency || accountCurrency || "EUR") as CurrencyCode,
                operationType: op.operationType || (op.amount >= 0 ? "encaissement" : "decaissement"),
                paymentMethod: op.paymentMethod || "AUTRE",
                matchedInvoiceIds: [],
                counterpartyName: op.counterpartyName || "Contrepartie scannée",
                unreconciledComment: "Opération scannée depuis relevé bancaire",
              });
            });

            const sum = structured?.summarizedOperation;
            if (
              scannedTransactions.filter((t) => t.reference === (sum?.reference || "")).length === 0 &&
              sum?.txnDate
            ) {
              scannedTransactions.push({
                id: sum.id || `${docId}-summary`,
                sourceDocumentId: docId,
                bankAccountId,
                txnDate: sum.txnDate,
                label: sum.label || "Relevé bancaire scanné",
                reference: sum.reference || `${docId}-summary`,
                amount: typeof sum.amount === "number" ? sum.amount : 0,
                balance: fallbackBalance,
                reconciledStatus: "non_rapproché",
                currency: (sum.currency || accountCurrency || "EUR") as CurrencyCode,
                operationType: (sum.operationType || "encaissement") as OperationType,
                paymentMethod: (sum.paymentMethod || "AUTRE") as PaymentMethod,
                matchedInvoiceIds: [],
                counterpartyName: sum.counterpartyName || "Relevé bancaire",
                unreconciledComment: "Relevé importé, opérations détaillées non détectées",
              });
            }
          }

          if (docType === "sepa_xml" && structured?.sepaBatch) {
            const batch = structured.sepaBatch;
            scannedSepaBatches[batch.id] = batch;
            const sum = structured?.summarizedOperation;
            if (sum?.txnDate && typeof sum.amount === "number") {
              const bankAccountId = resolveBankAccountId(batch.debtorIban, batch.debtorCurrency);
              scannedTransactions.push({
                id: sum.id || `${docId}-sepa`,
                sourceDocumentId: docId,
                bankAccountId,
                txnDate: sum.txnDate,
                label: sum.label || `SEPA ${batch.id}`,
                reference: sum.reference || batch.id,
                amount: sum.amount,
                balance: 0,
                reconciledStatus: "non_rapproché",
                currency: (sum.currency || batch.debtorCurrency || "EUR") as CurrencyCode,
                operationType: "decaissement",
                paymentMethod: "SEPA",
                matchedInvoiceIds: [],
                counterpartyName: sum.counterpartyName || batch.debtorName || "SEPA scanné",
                unreconciledComment: "Opération SEPA scannée depuis import XML",
              });
            }
          }
        });

          if (Object.keys(scannedSepaBatches).length > 0) {
            setSepaBatchesByReference((prev) => ({ ...prev, ...scannedSepaBatches }));
          }

          if (scannedTransactions.length > 0) {
            setTransactions(scannedTransactions);
          }
        } catch (error) {
          console.error("Erreur chargement opérations scannées:", error);
        }
      };

      void loadScannedBankOperations();
    }
  }, [accounts]);

  const getBridgeCategoryLabel = (tx: BridgeTransaction) => {
    const categoryId =
      tx.category_id ??
      (typeof tx.category === "number" ? tx.category : null);

    if (!categoryId) return "—";

    for (const parent of bridgeCategories) {
      const child = parent.categories?.find(
        (sub) => Number(sub.id) === Number(categoryId)
      );

      if (child) {
        return parent.name
          ? `${parent.name} / ${child.name || `#${categoryId}`}`
          : child.name || `Catégorie #${categoryId}`;
      }

      if (Number(parent.id) === Number(categoryId)) {
        return parent.name || `Catégorie #${categoryId}`;
      }
    }

    return `Catégorie #${categoryId}`;
  };

  const handleConnectBank = async () => {
    try {
      setBridgeError("");

      const callbackUrl = `${window.location.origin}/bridge/callback`;

      const res = await fetch("/api/bridge/connect-session", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "user-123",
          email: "test@gmail.com",
          callbackUrl,
        }),
      });

      const data = await res.json();
      console.log("Bridge response:", data);

      if (!res.ok) {
        setBridgeError(data?.error || "Erreur lors de la création de la session Bridge.");
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        setBridgeError("Pas d'URL retournée par le backend.");
      }
    } catch (error) {
      console.error("Erreur frontend:", error);
      setBridgeError("Erreur inattendue côté frontend.");
    }
  };

  const loadBridgeCategories = async () => {
    try {
      setBridgeLoadingCategories(true);
      setBridgeError("");

      const res = await fetch("/api/bridge/categories", {
        credentials: "include",
      });
      const data = await res.json();
      console.log("categories =", data);

      if (!res.ok) {
        setBridgeError(data?.error || "Impossible de charger les catégories Bridge.");
        setBridgeCategories([]);
        return;
      }

      setBridgeCategories(
        Array.isArray(data?.resources)
          ? data.resources
          : Array.isArray(data?.categories)
          ? data.categories
          : []
      );
    } catch (error) {
      console.error("Erreur chargement catégories:", error);
      setBridgeError("Erreur lors du chargement des catégories Bridge.");
    } finally {
      setBridgeLoadingCategories(false);
    }
  };

  const loadBridgeAccounts = async (itemId?: string) => {
    try {
      setBridgeLoadingAccounts(true);
      setBridgeError("");

      const effectiveItemId = itemId || currentBridgeItemId;

      const url = new URL("/api/bridge/accounts");

      if (effectiveItemId) {
        url.searchParams.set("item_id", effectiveItemId);
      }

      url.searchParams.set("only_enabled", "true");

      console.log("Frontend accounts URL =", url.toString());

      const res = await fetch(url.toString(), {
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) {
        setBridgeError(data?.error || "Impossible de charger les comptes Bridge.");
        return;
      }

      const loadedAccounts = Array.isArray(data?.resources)
        ? data.resources.map((acc: any) => ({
            ...acc,
            id: String(acc.id),
          }))
        : [];

      setBridgeAccounts(loadedAccounts);

      if (loadedAccounts.length > 0) {
        setSelectedBridgeAccountId(String(loadedAccounts[0].id));
      } else {
        setSelectedBridgeAccountId("");
      }
    } catch (error) {
      console.error("Erreur chargement comptes Bridge:", error);
      setBridgeError("Erreur lors du chargement des comptes Bridge.");
    } finally {
      setBridgeLoadingAccounts(false);
    }
  };

  const loadBridgeTransactions = async (accountId?: string) => {
    try {
      setBridgeLoadingTransactions(true);
      setBridgeError("");

      const effectiveAccountId = accountId || selectedBridgeAccountId;
      const url = effectiveAccountId
        ? `/api/bridge/transactions?account_id=${encodeURIComponent(effectiveAccountId)}`
        : "/api/bridge/transactions";

      const res = await fetch(url, {
        credentials: "include",
      });
      const data = await res.json();
      console.log("transactions =", data);

      if (!res.ok) {
        setBridgeError(data?.error || "Impossible de charger les opérations Bridge.");
        setBridgeTransactions([]);
        return;
      }

      const txs = Array.isArray(data?.resources || data?.transactions)
        ? (data?.resources || data?.transactions).map((tx: any) => ({
            ...tx,
            id: String(tx.id),
            account_id: tx.account_id != null ? String(tx.account_id) : undefined,
          }))
        : [];

      setBridgeTransactions(txs);
    } catch (error) {
      console.error("Erreur chargement opérations scannées:", error);
      setBridgeError("Erreur lors du chargement des opérations Bridge.");
    } finally {
      setBridgeLoadingTransactions(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const itemId = params.get("item_id") || "";

    console.log("Banque page item_id =", itemId);

    setCurrentBridgeItemId(itemId);

    if (itemId) {
      void loadBridgeAccounts(itemId);
    }

    void loadBridgeCategories();
  }, []);

  const visibleAccounts = useMemo(() => {
    if (accountViewMode === "merged") return accounts;
    return accounts.filter((a) => a.currency === accountViewMode);
  }, [accounts, accountViewMode]);

  const selectedAccountData = accounts.find((a) => a.id === selectedAccount) ?? null;
  const visibleAccountIds = visibleAccounts.map((a) => a.id);

  const selectedBridgeAccount =
    bridgeAccounts.find((acc) => String(acc.id) === String(selectedBridgeAccountId)) ?? null;

  const baseTransactions = useMemo(() => {
    if (accountViewMode === "merged") {
      return transactions.filter((t) => visibleAccountIds.includes(t.bankAccountId));
    }
    return transactions.filter((t) => t.bankAccountId === selectedAccount);
  }, [transactions, accountViewMode, visibleAccountIds, selectedAccount]);

  const selectedDetailsTxn = useMemo(() => {
    if (!detailsTxnId) return null;
    return transactions.find((txn) => txn.id === detailsTxnId) ?? null;
  }, [transactions, detailsTxnId]);

  const selectedSepaBatch = useMemo(() => {
    if (!detailsSepaReference) return null;
    return sepaBatchesByReference[detailsSepaReference] ?? null;
  }, [detailsSepaReference]);

  useEffect(() => {
    if (!selectedDetailsTxn) return;
    setManualInvoiceSelection(getTxnInvoiceIds(selectedDetailsTxn));
    setManualCategory(selectedDetailsTxn.unreconciledCategory ?? "");
    setManualComment(selectedDetailsTxn.unreconciledComment ?? "");
    setManualReviewFlag(Boolean(selectedDetailsTxn.reviewFlag));
    setManualRejectAllSuggestions(
      (selectedDetailsTxn.unreconciledComment ?? "").includes("Aucune proposition IA retenue")
    );
    setSepaCurrentOperationIndex(0);

    if (isSepaBatchTransaction(selectedDetailsTxn)) {
      setDetailsSepaReference(selectedDetailsTxn.reference);
    } else {
      setDetailsSepaReference(null);
    }
  }, [selectedDetailsTxn]);

  const openDetailsSection = (txn: LocalTransaction) => {
    setDetailsTxnId(txn.id);
    setDetailsSepaReference(isSepaBatchTransaction(txn) ? txn.reference : null);
    requestAnimationFrame(() => {
      detailSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const filteredTxns = useMemo(() => {
    return baseTransactions
      .filter((txn) => {
        const query = normalizeText(searchText);
        if (!query) return true;

        const account = getAccountById(accounts, txn.bankAccountId);
        const invoiceNumbers = getInvoicesByIds(getTxnInvoiceIds(txn))
          .map((inv) => inv.invoiceNumber)
          .join(" ")
          .toLowerCase();

        const haystack = [
          txn.label,
          txn.reference,
          txn.counterpartyName,
          txn.paymentMethod,
          txn.currency,
          txn.operationType,
          txn.reconciledStatus,
          account?.name,
          account?.bankName,
          invoiceNumbers,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      })
      .filter((txn) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "reconciled") return txn.reconciledStatus === "rapproché";
        return txn.reconciledStatus === "non_rapproché";
      })
      .filter((txn) => (currencyFilter ? txn.currency === currencyFilter : true))
      .filter((txn) => (operationTypeFilter ? txn.operationType === operationTypeFilter : true))
      .filter((txn) => (paymentMethodFilter ? txn.paymentMethod === paymentMethodFilter : true))
      .filter((txn) => (accountFilter !== "all" ? txn.bankAccountId === accountFilter : true))
      .filter((txn) => {
        if (!counterpartyFilter.trim()) return true;
        return normalizeText(txn.counterpartyName).includes(normalizeText(counterpartyFilter));
      })
      .filter((txn) => {
        if (!dateFrom) return true;
        return txn.txnDate >= dateFrom;
      })
      .filter((txn) => {
        if (!dateTo) return true;
        return txn.txnDate <= dateTo;
      })
      .filter((txn) => amountMatchesRange(txn.amount, minAmount, maxAmount))
      .filter((txn) => {
        const invoiceCount = getTxnInvoiceIds(txn).length;
        if (invoiceFilter === "all") return true;
        if (invoiceFilter === "with_invoice") return invoiceCount > 0;
        if (invoiceFilter === "without_invoice") return invoiceCount === 0;
        if (invoiceFilter === "multi_invoice") return invoiceCount > 1;
        return true;
      })
      .filter((txn) => (sepaOnly ? txn.paymentMethod === "SEPA" : true))
      .filter((txn) => {
        if (!payrollOnly) return true;
        const batch = sepaBatchesByReference[txn.reference];
        return Boolean(batch && batch.type === "payroll") || isPayrollCharge(txn);
      })
      .sort((a, b) => new Date(b.txnDate).getTime() - new Date(a.txnDate).getTime());
  }, [
    baseTransactions,
    searchText,
    statusFilter,
    currencyFilter,
    operationTypeFilter,
    paymentMethodFilter,
    accountFilter,
    counterpartyFilter,
    dateFrom,
    dateTo,
    minAmount,
    maxAmount,
    invoiceFilter,
    sepaOnly,
    payrollOnly,
    accounts,
  ]);

  const linkedInvoiceIdsAcrossDecisions = useMemo(() => {
    return (Object.values(sepaLineDecisions) as SepaOperationDecision[]).flatMap(
      (decision) => decision.selectedInvoiceIds
    );
  }, [sepaLineDecisions]);

  const selectedDetailInvoices = useMemo(() => {
    return getInvoicesByIds(getTxnInvoiceIds(selectedDetailsTxn));
  }, [selectedDetailsTxn]);

  const manualSuggestions = useMemo(() => {
    if (!selectedDetailsTxn) return [] as SepaOperationCandidate[];
    return getAvailableInvoicesForTxn(selectedDetailsTxn)
      .map((invoice) => {
        const score = computeMatchScore(selectedDetailsTxn, invoice);
        return {
          invoice,
          score,
          details: getMatchDetails(selectedDetailsTxn, invoice),
          reasons: buildCandidateReasons(selectedDetailsTxn, invoice, score),
        };
      })
      .filter((item) => item.score >= 20)
      .slice(0, 8);
  }, [selectedDetailsTxn]);

  const sepaOperations = selectedSepaBatch?.operations ?? [];
  const sepaCurrentOperation = sepaOperations[sepaCurrentOperationIndex] ?? null;
  const sepaCurrentDecision = sepaCurrentOperation
    ? sepaLineDecisions[sepaCurrentOperation.id] ?? {
        status: "pending",
        selectedInvoiceIds: [],
        rejectAllSuggestions: false,
      }
    : null;

  const sepaCurrentCandidates = useMemo(() => {
    if (!selectedDetailsTxn || !sepaCurrentOperation) return [] as SepaOperationCandidate[];
    return getAvailableInvoicesForSepaOperation(
      selectedDetailsTxn,
      sepaCurrentOperation,
      sepaCurrentDecision?.selectedInvoiceIds ?? [],
      linkedInvoiceIdsAcrossDecisions,
    );
  }, [selectedDetailsTxn, sepaCurrentOperation, sepaCurrentDecision, linkedInvoiceIdsAcrossDecisions]);

  const sepaSummary = useMemo(() => {
    const summary = { approved: 0, rejected: 0, review: 0, pending: 0 };
    sepaOperations.forEach((op) => {
      const status = sepaLineDecisions[op.id]?.status ?? "pending";
      summary[status] += 1;
    });
    return summary;
  }, [sepaOperations, sepaLineDecisions]);

  const updateSepaDecision = (
    operationId: string,
    updater: (current: SepaOperationDecision) => SepaOperationDecision
  ) => {
    setSepaLineDecisions((prev) => {
      const current = prev[operationId] ?? {
        status: "pending",
        selectedInvoiceIds: [],
        rejectAllSuggestions: false,
      };
      return { ...prev, [operationId]: updater(current) };
    });
  };

  const toggleManualInvoice = (invoiceId: string) => {
    setManualRejectAllSuggestions(false);
    setManualInvoiceSelection((prev) =>
      prev.includes(invoiceId) ? prev.filter((id) => id !== invoiceId) : [...prev, invoiceId],
    );
  };

  const toggleSepaInvoice = (operationId: string, invoiceId: string) => {
    updateSepaDecision(operationId, (current) => ({
      ...current,
      rejectAllSuggestions: false,
      selectedInvoiceIds: current.selectedInvoiceIds.includes(invoiceId)
        ? current.selectedInvoiceIds.filter((id) => id !== invoiceId)
        : [...current.selectedInvoiceIds, invoiceId],
      status: "pending",
    }));
  };

  const applyManualReconciliation = () => {
    if (!selectedDetailsTxn) return;

    const noAiSuggestionAccepted = manualRejectAllSuggestions && manualInvoiceSelection.length === 0;
    const generatedComment = noAiSuggestionAccepted
      ? ["Aucune proposition IA retenue", manualComment.trim()].filter(Boolean).join(" — ")
      : manualComment.trim() || undefined;

    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === selectedDetailsTxn.id
          ? {
              ...txn,
              reconciledStatus: manualInvoiceSelection.length > 0 ? "rapproché" : "non_rapproché",
              matchedInvoiceIds: manualInvoiceSelection.length > 0 ? manualInvoiceSelection : [],
              pendingInvoiceIds: manualInvoiceSelection.length > 0 ? [] : [],
              unreconciledCategory: manualCategory || undefined,
              unreconciledComment: generatedComment,
              reviewFlag: manualReviewFlag || noAiSuggestionAccepted,
            }
          : txn,
      ),
    );

    toast?.success?.("Opération mise à jour.");
  };

  const resetManualReconciliation = () => {
    if (!selectedDetailsTxn) return;
    setManualInvoiceSelection(getTxnInvoiceIds(selectedDetailsTxn));
    setManualCategory(selectedDetailsTxn.unreconciledCategory ?? "");
    setManualComment(selectedDetailsTxn.unreconciledComment ?? "");
    setManualReviewFlag(Boolean(selectedDetailsTxn.reviewFlag));
    setManualRejectAllSuggestions(
      (selectedDetailsTxn.unreconciledComment ?? "").includes("Aucune proposition IA retenue")
    );
  };

  const validateCurrentSepaOperation = (status: Exclude<SepaOperationDecisionStatus, "pending">) => {
    if (!sepaCurrentOperation) return;
    updateSepaDecision(sepaCurrentOperation.id, (current) => ({ ...current, status }));
    toast?.success?.("Sous-opération SEPA mise à jour.");
  };

  const validateWholeSepaBatch = () => {
    if (!selectedDetailsTxn || !selectedSepaBatch) return;

    const selectedInvoiceIds = selectedSepaBatch.operations.flatMap(
      (op) => sepaLineDecisions[op.id]?.selectedInvoiceIds ?? [],
    );

    const hasApproved = selectedSepaBatch.operations.some(
      (op) => (sepaLineDecisions[op.id]?.status ?? "pending") === "approved",
    );

    const rejectedAllCount = selectedSepaBatch.operations.filter(
      (op) => Boolean(sepaLineDecisions[op.id]?.rejectAllSuggestions),
    ).length;

    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === selectedDetailsTxn.id
          ? {
              ...txn,
              reconciledStatus: hasApproved ? "rapproché" : "non_rapproché",
              matchedInvoiceIds: selectedInvoiceIds,
              pendingInvoiceIds: hasApproved ? [] : selectedInvoiceIds,
              reviewFlag:
                selectedSepaBatch.operations.some(
                  (op) => (sepaLineDecisions[op.id]?.status ?? "pending") === "review",
                ) || rejectedAllCount > 0,
              unreconciledComment:
                [
                  rejectedAllCount > 0 ? `${rejectedAllCount} sous-opération(s) : aucune proposition IA retenue` : "",
                  selectedSepaBatch.operations
                    .filter((op) => (sepaLineDecisions[op.id]?.status ?? "pending") !== "approved")
                    .map((op) => {
                      const decision = sepaLineDecisions[op.id];
                      const suffix = decision?.rejectAllSuggestions ? " — aucune proposition IA retenue" : "";
                      return `${op.creditorName}: ${getDecisionLabel(decision?.status ?? "pending")}${suffix}`;
                    })
                    .join(" | "),
                ]
                  .filter(Boolean)
                  .join(" | ") || undefined,
            }
          : txn,
      ),
    );

    toast?.success?.("Lot SEPA appliqué dans Banque.");
  };

  const handleUnreconcile = (txnId: string) => {
    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === txnId
          ? {
              ...txn,
              reconciledStatus: "non_rapproché",
              pendingInvoiceIds: txn.matchedInvoiceIds ?? [],
              matchedInvoiceIds: [],
            }
          : txn,
      ),
    );
    toast?.success?.("Rapprochement annulé.");
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
        .filter((t) => t.sourceDocumentId === txn.sourceDocumentId);

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

  const reconciledCount = filteredTxns.filter((t) => t.reconciledStatus === "rapproché").length;
  const unreconciledCount = filteredTxns.filter((t) => t.reconciledStatus === "non_rapproché").length;
  const currentViewCount = filteredTxns.length;

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
              <Button onClick={handleConnectBank}>
                Ajouter un compte
              </Button>

              <Button
                variant="outline"
                onClick={async () => {
                  await loadBridgeAccounts(currentBridgeItemId);
                  await loadBridgeCategories();
                }}
              >
                Charger les comptes Bridge
              </Button>

              <Button
                variant="outline"
                onClick={() => loadBridgeTransactions()}
                disabled={!selectedBridgeAccountId && bridgeAccounts.length === 0}
              >
                Charger les opérations Bridge
              </Button>
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
            label="Comptes visibles"
            value={String(visibleAccounts.length)}
            hint={accountViewMode === "merged" ? "Tous comptes confondus" : `Filtre ${accountViewMode}`}
            icon={<Landmark className="h-4 w-4 text-slate-400" />}
          />
          <MetricCard
            label="Opérations affichées"
            value={String(currentViewCount)}
            hint="Après application des filtres"
            icon={<Wallet className="h-4 w-4 text-slate-400" />}
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
        </div>

        <SectionCard
          title="Comptes connectés via Bridge"
          subtitle="Comptes récupérés depuis Bridge après synchronisation"
        >
          <div className="space-y-4">
            {bridgeError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {bridgeError}
              </div>
            ) : null}

            {bridgeLoadingAccounts ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                Chargement des comptes Bridge...
              </div>
            ) : bridgeAccounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                Aucun compte Bridge chargé. Connecte une banque puis clique sur “Charger les comptes Bridge”.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {bridgeAccounts.map((account) => (
                  <div key={account.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{getBridgeAccountName(account)}</p>
                        <p className="mt-1 text-xs text-slate-500">{account.iban || "IBAN non disponible"}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                        {account.currency_code || account.currency || "—"}
                      </span>
                    </div>

                    <div className="mt-3 text-sm text-slate-600">
                      <p>
                        <span className="text-slate-500">Solde :</span>{" "}
                        <span className="font-semibold text-slate-900">
                          {typeof account.balance === "number"
                            ? `${account.balance} ${account.currency_code || account.currency || ""}`
                            : "—"}
                        </span>
                      </p>
                      <p className="mt-1">
                        <span className="text-slate-500">Accès :</span> {account.data_access || "—"}
                      </p>
                    </div>

                    <div className="mt-4">
                      <Button
                        variant={String(selectedBridgeAccountId) === String(account.id) ? "default" : "outline"}
                        onClick={() => {
                          const normalizedId = String(account.id);
                          setSelectedBridgeAccountId(normalizedId);
                          loadBridgeTransactions(normalizedId);
                        }}
                      >
                        Voir les opérations
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>

        {accountViewMode === "merged" ? (
          <SectionCard
            title="Synthèse multi-devises"
            subtitle="Les devises sont séparées pour éviter tout affichage incohérent."
          >
            <CurrencySummary accounts={visibleAccounts} />
          </SectionCard>
        ) : selectedAccountData ? (
          <SectionCard title={selectedAccountData.name} subtitle={selectedAccountData.bankName}>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Solde actuel</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {formatMoney(selectedAccountData.currentBalance, selectedAccountData.currency)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">IBAN</p>
                <p className="mt-2 break-all font-mono text-sm text-slate-800">
                  {selectedAccountData.iban}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                <p>
                  <span className="text-slate-500">Compte :</span>{" "}
                  <span className="font-mono">{selectedAccountData.accountNumber ?? "—"}</span>
                </p>
                <p className="mt-1">
                  <span className="text-slate-500">SWIFT :</span>{" "}
                  <span className="font-mono">{selectedAccountData.swift ?? "—"}</span>
                </p>
                <p className="mt-1">
                  <span className="text-slate-500">Agence :</span> {selectedAccountData.agency ?? "—"}
                </p>
              </div>
            </div>
          </SectionCard>
        ) : null}

        <SectionCard
          title="Filtres"
          subtitle="Recherche rapide, critères d'analyse et filtres avancés"
          actions={
            <Button variant="ghost" size="sm" onClick={() => setShowAdvancedFilters((v) => !v)}>
              {showAdvancedFilters ? (
                <ChevronUp className="mr-1 h-4 w-4" />
              ) : (
                <ChevronDown className="mr-1 h-4 w-4" />
              )}
              {showAdvancedFilters ? "Réduire" : "Avancé"}
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Recherche libellé, référence, facture..."
                className="bg-white"
              />

              <select
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
              >
                <option value="all">Tous les comptes</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>

              <select
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={currencyFilter}
                onChange={(e) => setCurrencyFilter(e.target.value as "" | CurrencyCode)}
              >
                <option value="">Toutes les devises</option>
                <option value="EUR">EUR</option>
                <option value="MAD">MAD</option>
                <option value="USD">USD</option>
              </select>

              <select
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ReconciliationFilter)}
              >
                <option value="all">Tous</option>
                <option value="unreconciled">Non rapprochés</option>
                <option value="reconciled">Rapprochés</option>
              </select>
            </div>

            {showAdvancedFilters ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <select
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={operationTypeFilter}
                  onChange={(e) => setOperationTypeFilter(e.target.value as "" | OperationType)}
                >
                  <option value="">Tous les sens</option>
                  <option value="encaissement">Encaissement</option>
                  <option value="decaissement">Décaissement</option>
                </select>

                <select
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={paymentMethodFilter}
                  onChange={(e) => setPaymentMethodFilter(e.target.value as "" | PaymentMethod)}
                >
                  <option value="">Tous les moyens</option>
                  <option value="SEPA">SEPA</option>
                  <option value="VIREMENT">Virement</option>
                  <option value="CARTE">Carte</option>
                  <option value="CHEQUE">Chèque</option>
                  <option value="PRELEVEMENT">Prélèvement</option>
                  <option value="AUTRE">Autre</option>
                </select>

                <select
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={invoiceFilter}
                  onChange={(e) => setInvoiceFilter(e.target.value as InvoiceFilter)}
                >
                  <option value="all">Toutes les factures</option>
                  <option value="with_invoice">Avec facture</option>
                  <option value="without_invoice">Sans facture</option>
                  <option value="multi_invoice">Plusieurs factures</option>
                </select>

                <Input
                  value={counterpartyFilter}
                  onChange={(e) => setCounterpartyFilter(e.target.value)}
                  placeholder="Contrepartie"
                  className="bg-white"
                />
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-white" />
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-white" />
                <Input
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  placeholder="Montant min"
                  className="bg-white"
                />
                <Input
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  placeholder="Montant max"
                  className="bg-white"
                />

                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <input type="checkbox" checked={sepaOnly} onChange={(e) => setSepaOnly(e.target.checked)} />
                  SEPA seulement
                </label>

                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <input type="checkbox" checked={payrollOnly} onChange={(e) => setPayrollOnly(e.target.checked)} />
                  Paie / URSSAF seulement
                </label>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button variant="outline" onClick={resetFilters}>
                Réinitialiser
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Opérations Bridge"
          subtitle={
            selectedBridgeAccount
              ? `Compte sélectionné : ${getBridgeAccountName(selectedBridgeAccount)}`
              : "Aucun compte Bridge sélectionné"
          }
        >
          <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-[140px]">Date</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead className="w-[220px]">Catégorie</TableHead>
                  <TableHead className="w-[180px]">Compte</TableHead>
                  <TableHead className="w-[160px]">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bridgeLoadingTransactions ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">
                      Chargement des opérations Bridge...
                    </TableCell>
                  </TableRow>
                ) : bridgeTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">
                      Aucune opération Bridge chargée.
                    </TableCell>
                  </TableRow>
                ) : (
                  bridgeTransactions.map((tx) => {
                    const account = bridgeAccounts.find(
                      (acc) => String(acc.id) === String(tx.account_id)
                    );

                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="whitespace-nowrap">
                          {getBridgeTransactionDate(tx) || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">
                              {getBridgeTransactionLabel(tx)}
                            </div>
                            <div className="text-xs text-slate-500">
                              ID: {tx.id}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-slate-700">
                            {getBridgeCategoryLabel(tx)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div
                            className="truncate"
                            title={account ? getBridgeAccountName(account) : tx.account_id}
                          >
                            {account ? getBridgeAccountName(account) : tx.account_id || "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`font-mono font-semibold ${
                              (tx.amount || 0) < 0 ? "text-red-600" : "text-emerald-600"
                            }`}
                          >
                            {tx.amount ?? "—"} {getBridgeTransactionCurrency(tx)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_460px]">
          <SectionCard title="Opérations bancaires" subtitle={`${filteredTxns.length} ligne(s) affichée(s)`}>
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="w-[110px]">Date</TableHead>
                    <TableHead className="w-[34%]">Opération</TableHead>
                    <TableHead className="w-[18%]">Compte</TableHead>
                    <TableHead className="w-[140px]">Montant</TableHead>
                    <TableHead className="w-[18%]">Factures</TableHead>
                    <TableHead className="w-[120px]">Statut</TableHead>
                    <TableHead className="w-[120px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTxns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-500">
                        Aucune opération trouvée.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTxns.map((txn) => {
                      const account = getAccountById(accounts, txn.bankAccountId);
                      const invoiceIds = getTxnInvoiceIds(txn);
                      const batch = sepaBatchesByReference[txn.reference];
                      const sepaConfig = batch ? getSepaBadgeConfig(batch.type) : null;
                      const SepaIcon = sepaConfig?.icon;

                      return (
                        <TableRow key={txn.id} className={detailsTxnId === txn.id ? "bg-sky-50/60" : ""}>
                          <TableCell className="whitespace-nowrap">{formatDisplayDate(txn.txnDate)}</TableCell>
                          <TableCell className="align-top">
                            <div className="space-y-2 max-w-full overflow-hidden">
                              <div className="truncate font-medium text-slate-900" title={txn.rawLabel || txn.label}>
                                {formatOperationLabel(txn.label, txn.rawLabel)}
                              </div>
                              <div className="truncate text-xs text-slate-500" title={txn.reference}>
                                {txn.reference}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {txn.counterpartyName ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                                    <Building2 className="h-3 w-3" />
                                    {txn.counterpartyName}
                                  </span>
                                ) : null}
                                <span className={`rounded-full px-2 py-1 text-xs font-medium ${getCurrencyBadgeClass(txn.currency)}`}>
                                  {txn.currency}
                                </span>
                                {sepaConfig && SepaIcon ? (
                                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${sepaConfig.className}`}>
                                    <SepaIcon className="h-3 w-3" />
                                    {sepaConfig.label}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="truncate" title={account?.name ?? "—"}>
                              {account?.name ?? "—"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className={`font-mono font-semibold ${txn.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>
                              {formatCompactAmount(txn.amount, txn.currency)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {invoiceIds.length === 0 ? (
                              <span className="text-xs text-slate-500">Aucune</span>
                            ) : (
                              <div className="flex max-w-full flex-wrap gap-1 overflow-hidden">
                                {invoiceIds.slice(0, 3).map((invoiceId) => {
                                  const invoice = localInvoices.find((inv) => inv.id === invoiceId);
                                  if (!invoice) return null;
                                  return (
                                    <span key={invoiceId} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                                      {invoice.invoiceNumber}
                                    </span>
                                  );
                                })}
                                {invoiceIds.length > 3 ? (
                                  <span className="text-xs text-slate-500">+{invoiceIds.length - 3}</span>
                                ) : null}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={txn.reconciledStatus} />
                          </TableCell>
                          <TableCell className="align-top text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => openDetailsSection(txn)}>
                                Voir
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64">
                                  <DropdownMenuItem onClick={() => openDetailsSection(txn)}>
                                    <Info className="mr-2 h-4 w-4" />
                                    Voir le détail
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openDetailsSection(txn)}>
                                    <Link2 className="mr-2 h-4 w-4" />
                                    Ouvrir le rapprochement
                                  </DropdownMenuItem>
                                  {txn.reconciledStatus === "rapproché" ? (
                                    <DropdownMenuItem onClick={() => handleUnreconcile(txn.id)}>
                                      <Undo2 className="mr-2 h-4 w-4" />
                                      Annuler le rapprochement
                                    </DropdownMenuItem>
                                  ) : null}
                                  {txn.sourceDocumentId ? (
                                    <DropdownMenuItem onClick={() => handleDeleteImportedDocument(txn)}>
                                      Supprimer import
                                    </DropdownMenuItem>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </SectionCard>

          <div ref={detailSectionRef} className="space-y-6 xl:sticky xl:top-6 xl:self-start">
            <SectionCard
              title="Panneau de détail"
              subtitle={selectedDetailsTxn ? selectedDetailsTxn.reference : "Sélectionne une ligne du tableau"}
            >
              {!selectedDetailsTxn ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
                  Aucun détail sélectionné.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900" title={selectedDetailsTxn.rawLabel || selectedDetailsTxn.label}>
                        {formatOperationLabel(selectedDetailsTxn.label, selectedDetailsTxn.rawLabel)}
                      </p>
                        <p className="mt-1 text-xs text-slate-500">{selectedDetailsTxn.reference}</p>
                      </div>
                      <StatusBadge status={selectedDetailsTxn.reconciledStatus} />
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-slate-500">Date</p>
                        <p className="text-sm font-medium text-slate-900">
                          {formatDisplayDate(selectedDetailsTxn.txnDate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Montant</p>
                        <p className={`text-sm font-semibold ${selectedDetailsTxn.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {formatCompactAmount(selectedDetailsTxn.amount, selectedDetailsTxn.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Compte</p>
                        <p className="text-sm font-medium text-slate-900">
                          {getAccountById(accounts, selectedDetailsTxn.bankAccountId)?.name ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Contrepartie</p>
                        <p className="text-sm font-medium text-slate-900">{selectedDetailsTxn.counterpartyName ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Moyen de paiement</p>
                        <p className="text-sm font-medium text-slate-900">{selectedDetailsTxn.paymentMethod ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Solde après opération</p>
                        <p className="text-sm font-medium text-slate-900">
                          {formatMoney(selectedDetailsTxn.balance, selectedDetailsTxn.currency)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="mb-3 text-sm font-semibold text-slate-900">Factures associées</p>
                    {selectedDetailInvoices.length === 0 ? (
                      <p className="text-sm text-slate-500">Aucune facture associée.</p>
                    ) : (
                      <div className="space-y-3">
                        {selectedDetailInvoices.map((invoice) => (
                          <div key={invoice.id} className="rounded-xl bg-slate-50 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-slate-900">{invoice.invoiceNumber}</p>
                                <p className="text-xs text-slate-500">{invoice.vendorCustomer}</p>
                              </div>
                              <span className="text-sm font-semibold text-slate-900">
                                {formatMoney(invoice.amountGross, invoice.currency ?? selectedDetailsTxn.currency)}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                              <span>Émise : {formatDisplayDate(invoice.invoiceDate)}</span>
                              <span>Échéance : {formatDisplayDate(invoice.dueDate)}</span>
                              <span>{invoice.category ?? "—"}</span>
                            </div>
                            <div className="mt-2">
                              <Button variant="ghost" size="sm" onClick={() => openInvoicePdf(invoice)}>
                                <Receipt className="mr-1 h-4 w-4" />
                                Voir la facture
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </SectionCard>

            {selectedDetailsTxn && !isSepaBatchTransaction(selectedDetailsTxn) ? (
              <SectionCard title="Rapprochement" subtitle="Sélection manuelle des factures proposées">
                <div className="space-y-4">
                  {manualSuggestions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                      Aucune suggestion disponible pour cette opération.
                    </div>
                  ) : (
                    manualSuggestions.map((candidate) => {
                      const checked = manualInvoiceSelection.includes(candidate.invoice.id);
                      return (
                        <div
                          key={candidate.invoice.id}
                          className={`rounded-2xl border p-4 ${
                            checked ? "border-sky-300 bg-sky-50/50" : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleManualInvoice(candidate.invoice.id)}
                                />
                                {candidate.invoice.invoiceNumber}
                              </label>
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700 ring-1 ring-emerald-100">
                                {candidate.score}% match
                              </span>
                            </div>
                            <p className="text-sm text-slate-700">{candidate.invoice.vendorCustomer}</p>
                            <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                              <span>
                                Montant :{" "}
                                {formatMoney(
                                  candidate.invoice.amountGross,
                                  candidate.invoice.currency ?? selectedDetailsTxn.currency
                                )}
                              </span>
                              <span>
                                Écart :{" "}
                                {formatMoney(
                                  candidate.details.amountDiff,
                                  candidate.invoice.currency ?? selectedDetailsTxn.currency
                                )}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {candidate.reasons.map((reason) => (
                                <span
                                  key={reason}
                                  className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600"
                                >
                                  {reason}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="grid gap-3">
                      <select
                        className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                        value={manualCategory}
                        onChange={(e) => setManualCategory(e.target.value as "" | UnreconciledCategory)}
                      >
                        <option value="">Aucune catégorie d'écart</option>
                        {Object.entries(unreconciledCategoryLabels).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>

                      <Input
                        value={manualComment}
                        onChange={(e) => setManualComment(e.target.value)}
                        placeholder="Commentaire / justification"
                        className="bg-white"
                      />

                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={manualReviewFlag}
                          onChange={(e) => setManualReviewFlag(e.target.checked)}
                        />
                        Marquer pour revue
                      </label>

                      <label className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        <input
                          type="checkbox"
                          checked={manualRejectAllSuggestions}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setManualRejectAllSuggestions(checked);
                            if (checked) {
                              setManualInvoiceSelection([]);
                              setManualReviewFlag(true);
                            }
                          }}
                        />
                        Rejeter toutes les propositions IA
                      </label>

                      {manualRejectAllSuggestions ? (
                        <p className="text-xs text-slate-500">
                          Cas typique : aucune facture proposée n'est valable pour le moment, par exemple facture non encore reçue.
                        </p>
                      ) : null}

                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button onClick={applyManualReconciliation}>
                          <Check className="mr-1 h-4 w-4" />
                          Enregistrer
                        </Button>
                        <Button variant="outline" onClick={resetManualReconciliation}>
                          Réinitialiser
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {selectedDetailsTxn && isSepaBatchTransaction(selectedDetailsTxn) && selectedSepaBatch ? (
              <SectionCard title="Traitement SEPA" subtitle={selectedSepaBatch.label}>
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Exécution</p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {formatDisplayDate(selectedSepaBatch.executionDate)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Débiteur</p>
                      <p className="mt-1 font-semibold text-slate-900">{selectedSepaBatch.debtorName}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">Rapprochées</p>
                      <p className="mt-1 font-semibold text-slate-900">{sepaSummary.approved}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="text-xs text-slate-500">À revoir</p>
                      <p className="mt-1 font-semibold text-slate-900">{sepaSummary.review}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {selectedSepaBatch.operations.map((op, index) => {
                      const decision = sepaLineDecisions[op.id] ?? {
                        status: "pending",
                        selectedInvoiceIds: [],
                        rejectAllSuggestions: false,
                      };
                      const selectedAmount = getSepaDecisionAmount(decision);
                      const isCurrent = sepaCurrentOperation?.id === op.id;

                      return (
                        <button
                          key={op.id}
                          type="button"
                          onClick={() => setSepaCurrentOperationIndex(index)}
                          className={`w-full rounded-xl border p-3 text-left ${
                            isCurrent ? "border-sky-300 bg-sky-50/60" : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-slate-900">{op.creditorName}</p>
                              <p className="text-xs text-slate-500">{op.endToEndId}</p>
                            </div>
                            <span className={`rounded-full px-2 py-1 text-xs ${getDecisionBadgeClass(decision.status)}`}>
                              {getDecisionLabel(decision.status)}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                            <span>{formatMoney(op.amount, op.currency)}</span>
                            <span>{decision.selectedInvoiceIds.length} facture(s)</span>
                          </div>
                          {decision.selectedInvoiceIds.length > 0 ? (
                            <p className="mt-1 text-xs text-slate-500">Retenu : {formatMoney(selectedAmount, op.currency)}</p>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  {sepaCurrentOperation ? (
                    <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{sepaCurrentOperation.creditorName}</p>
                            <p className="mt-1 text-xs text-slate-500">{sepaCurrentOperation.endToEndId}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs ${getDecisionBadgeClass(sepaCurrentDecision?.status ?? "pending")}`}>
                            {getDecisionLabel(sepaCurrentDecision?.status ?? "pending")}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                          <span>Montant : {formatMoney(sepaCurrentOperation.amount, sepaCurrentOperation.currency)}</span>
                          <span>IBAN : {sepaCurrentOperation.creditorIban}</span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {sepaCurrentCandidates.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                            Aucune suggestion pour cette sous-opération.
                          </div>
                        ) : (
                          sepaCurrentCandidates.map((candidate) => {
                            const checked = sepaCurrentDecision?.selectedInvoiceIds.includes(candidate.invoice.id) ?? false;
                            return (
                              <div
                                key={candidate.invoice.id}
                                className={`rounded-2xl border p-4 ${
                                  checked ? "border-sky-300 bg-sky-50/50" : "border-slate-200 bg-white"
                                }`}
                              >
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleSepaInvoice(sepaCurrentOperation.id, candidate.invoice.id)}
                                      />
                                      {candidate.invoice.invoiceNumber}
                                    </label>
                                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700 ring-1 ring-emerald-100">
                                      {candidate.score}% match
                                    </span>
                                  </div>
                                  <p className="text-sm text-slate-700">{candidate.invoice.vendorCustomer}</p>
                                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                                    <span>
                                      Montant :{" "}
                                      {formatMoney(
                                        candidate.invoice.amountGross,
                                        candidate.invoice.currency ?? sepaCurrentOperation.currency
                                      )}
                                    </span>
                                    <span>
                                      Écart :{" "}
                                      {formatMoney(
                                        candidate.details.amountDiff,
                                        candidate.invoice.currency ?? sepaCurrentOperation.currency
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {candidate.reasons.map((reason) => (
                                      <span
                                        key={reason}
                                        className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600"
                                      >
                                        {reason}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <label className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        <input
                          type="checkbox"
                          checked={Boolean(sepaCurrentDecision?.rejectAllSuggestions)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            updateSepaDecision(sepaCurrentOperation.id, (current) => ({
                              ...current,
                              rejectAllSuggestions: checked,
                              selectedInvoiceIds: checked ? [] : current.selectedInvoiceIds,
                              status: checked ? "review" : current.status,
                            }));
                          }}
                        />
                        Rejeter toutes les propositions IA pour cette sous-opération
                      </label>

                      {sepaCurrentDecision?.rejectAllSuggestions ? (
                        <p className="text-xs text-slate-500">
                          Aucune suggestion automatique n'est retenue pour cette ligne. Le comptable pourra traiter le cas plus tard.
                        </p>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => validateCurrentSepaOperation("approved")}>
                          <Check className="mr-1 h-4 w-4" />
                          Rapprocher
                        </Button>
                        <Button variant="outline" onClick={() => validateCurrentSepaOperation("review")}>
                          <AlertTriangle className="mr-1 h-4 w-4" />
                          À revoir
                        </Button>
                        <Button variant="outline" onClick={() => validateCurrentSepaOperation("rejected")}>
                          Rejeter
                        </Button>
                      </div>

                      <div className="border-t border-slate-200 pt-4">
                        <Button onClick={validateWholeSepaBatch}>Appliquer le lot SEPA</Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}