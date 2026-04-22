import {
  useEffect, useMemo, useState, Card,
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
  Wallet,
  ChevronDown,
  ChevronUp,
  Briefcase,
  Users,
  FileSearch,
  Link2,
  MoreHorizontal,
  Building2,
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

import { MetricCard, SectionCard } from "@/features/banque/components";
import {
  initialTransactions,
  localInvoices,
  sepaBatchesByReference as defaultSepaBatchesByReference,
  unreconciledCategoryLabels
} from "@/features/banque/data";

import type {
  CurrencyCode,
  InvoiceFilter,
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
  formatCompactAmount,
  formatDisplayDate,
  formatMoney,
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
  normalizeText,
} from "@/features/banque/utils";

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
  bankMeta?: {
    debtor?: string | null;
    beneficiary?: string | null;
    ultimateCreditor?: string | null;
    mandate?: string | null;
    orgId?: string | null;
    reference?: string | null;
    remittanceRef?: string | null;
    info?: string | null;
  };
  source?: string;
};

type ImportedDocumentDto = {
  _id?: string;
  id?: string;
  originalName?: string;
  createdAt?: string;
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
  const [transactions, setTransactions] = useState<LocalTransaction[]>(initialTransactions);
  const [realInvoices, setRealInvoices] = useState<LocalInvoice[]>([]);
  const [sepaBatchesByReference, setSepaBatchesByReference] = useState<Record<string, SepaBatchTemplate>>(
    defaultSepaBatchesByReference
  );
  const [recentStatementImports, setRecentStatementImports] = useState<
    Array<{ id: string; originalName: string; createdAt?: string }>
  >([]);

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReconciliationFilter>("all");
  const [currencyFilter, setCurrencyFilter] = useState<"" | CurrencyCode>("");
  const [operationTypeFilter, setOperationTypeFilter] = useState<"" | OperationType>("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<"" | PaymentMethod>("");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all");
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
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewPdfTitle, setPreviewPdfTitle] = useState("");

  const [manualInvoiceSelection, setManualInvoiceSelection] = useState<string[]>([]);
  const [manualCategory, setManualCategory] = useState<"" | UnreconciledCategory>("");
  const [manualComment, setManualComment] = useState("");
  const [manualReviewFlag, setManualReviewFlag] = useState(false);
  const [manualRejectAllSuggestions, setManualRejectAllSuggestions] = useState(false);

  const [sepaLineDecisions, setSepaLineDecisions] = useState<Record<string, SepaOperationDecision>>({});
  const [sepaEditModeByOperation, setSepaEditModeByOperation] = useState<Record<string, boolean>>({});
  const [sepaCurrentOperationIndex, setSepaCurrentOperationIndex] = useState(0);
  const [linkedSepaPopupRef, setLinkedSepaPopupRef] = useState<string | null>(null);
  const [backendRecoPersistenceUnavailable, setBackendRecoPersistenceUnavailable] = useState(false);

  const RECONCILIATION_CACHE_KEY = "banque_reconciliation_cache_v1";
  const readLocalReconciliationCache = (): Record<string, any> => {
    try {
      const raw = window.localStorage.getItem(RECONCILIATION_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const writeLocalReconciliationCache = (next: Record<string, any>) => {
    try {
      window.localStorage.setItem(RECONCILIATION_CACHE_KEY, JSON.stringify(next));
    } catch {
      // no-op
    }
  };
  const makeRecoCacheKey = (sourceDocumentId: string, operationId: string) =>
    `${sourceDocumentId}::${operationId}`;

  const normalizeSepaRef = (value: string) =>
    String(value || "")
      .toUpperCase()
      .replace(/[\s\-_./]+/g, "");

  const findSepaBatchByReference = (reference?: string) => {
    if (!reference) return null;
    const wanted = normalizeSepaRef(reference);
    for (const [key, batch] of Object.entries(sepaBatchesByReference)) {
      if (normalizeSepaRef(key) === wanted || normalizeSepaRef(batch?.id || "") === wanted) {
        return batch;
      }
    }
    return null;
  };

  const ownCompanyAliases = [
    "consult-it",
    "consult it",
    "consult it sas",
  ];

  const isOwnCompanyName = (name?: string | null) => {
    const n = normalizeText(name || "");
    return ownCompanyAliases.some((alias) => n.includes(alias));
  };

  const getCounterpartyDisplay = (txn: LocalTransaction) => {
    const meta = txn.bankMeta;
    const beneficiary =
      meta?.beneficiary && !isOwnCompanyName(meta.beneficiary)
        ? meta.beneficiary
        : null;
    const debtor =
      meta?.debtor && !isOwnCompanyName(meta.debtor) ? meta.debtor : null;
    const ultimate =
      meta?.ultimateCreditor && !isOwnCompanyName(meta.ultimateCreditor)
        ? meta.ultimateCreditor
        : null;

    if (txn.operationType === "decaissement") {
      const value = beneficiary || ultimate || debtor || txn.counterpartyName || null;
      return value ? { role: "Bénéficiaire", value } : null;
    }

    const value = debtor || ultimate || beneficiary || txn.counterpartyName || null;
    return value ? { role: "Débiteur", value } : null;
  };

  const resolveBankAccountId = (
    _scannedIban: string | undefined,
    _scannedCurrency: string | undefined
  ) => {
    return "ba-import";
  };

  useEffect(() => {
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
          const persistedOps = structured?.reconciliation?.operations || {};
          const localCache = readLocalReconciliationCache();

          if (docType === "bank_statement" && Array.isArray(structured?.operations)) {
            const accountIban = structured?.account?.iban;
            const accountCurrency = structured?.account?.currency || "EUR";
            const bankAccountId = resolveBankAccountId(accountIban, accountCurrency);
            const fallbackBalance = Number(structured?.account?.closingBalance || 0);

            structured.operations.forEach((op, index) => {
              if (!op?.txnDate || typeof op.amount !== "number") return;
              const opType = String(op.operationType || "").toLowerCase();
              const hay = `${op.label || ""} ${op.reference || ""} ${op.bankOperationType || ""}`.toLowerCase();
              const absAmount = Math.abs(Number(op.amount || 0));
              let normalizedAmount = Number(op.amount || 0);
              if (normalizedAmount >= 0) {
                if (opType === "decaissement") normalizedAmount = -absAmount;
                else if (opType === "encaissement") normalizedAmount = absAmount;
                else if (/\bvir\.?\s*re[çc]u\b|\bencaissement\b|\bversement\b|\bcr[eé]dit\b/.test(hay)) {
                  normalizedAmount = absAmount;
                } else if (/\brem\s+vir\s+sepa\b|\bfourn\b|\bvir\.?\s*[eé]mis\b|\bpr[eé]l[eè]v|\bcb\b|\bcarte\b|\bd[eé]bit\b/.test(hay)) {
                  normalizedAmount = -absAmount;
                } else {
                  normalizedAmount = -absAmount;
                }
              }
              const opId = op.id || `${docId}-op-${index + 1}`;
              const localPersisted = localCache[makeRecoCacheKey(docId, opId)] || {};
              const persisted = { ...(persistedOps[opId] || {}), ...localPersisted };
              scannedTransactions.push({
                id: opId,
                sourceDocumentId: docId,
                bankAccountId,
                txnDate: op.txnDate,
                label: op.label || "Opération scannée",
                reference: op.reference || `${docId}-${index + 1}`,
                amount: normalizedAmount,
                balance: fallbackBalance,
                reconciledStatus: persisted.reconciledStatus || "non_rapproché",
                currency: (op.currency || accountCurrency || "EUR") as CurrencyCode,
                operationType: op.operationType || (normalizedAmount >= 0 ? "encaissement" : "decaissement"),
                paymentMethod: op.paymentMethod || "AUTRE",
                matchedInvoiceIds: Array.isArray(persisted.matchedInvoiceIds) ? persisted.matchedInvoiceIds : [],
                pendingInvoiceIds: Array.isArray(persisted.pendingInvoiceIds) ? persisted.pendingInvoiceIds : [],
                counterpartyName: op.counterpartyName || undefined,
                bankMeta: op.bankMeta,
                unreconciledComment: persisted.unreconciledComment || "Opération scannée depuis relevé bancaire",
                unreconciledCategory: persisted.unreconciledCategory,
                reviewFlag: Boolean(persisted.reviewFlag),
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
            const seenIds = new Set<string>();
            const normalizedOperations = (batch.operations || []).map((op, index) => {
              const baseId = String(op?.id || op?.endToEndId || `sepa-op-${index + 1}`);
              let uniqueId = baseId;
              if (seenIds.has(uniqueId)) {
                uniqueId = `${baseId}-${index + 1}`;
              }
              seenIds.add(uniqueId);
              return {
                ...op,
                id: uniqueId,
              };
            });
            scannedSepaBatches[batch.id] = {
              ...batch,
              operations: normalizedOperations,
              sourceDocumentId: docId,
            };
          }
        });

        setRecentStatementImports(
          importedDocs
            .filter((doc) => {
              const structured = doc.structuredData;
              const docType = structured?.documentType || doc.documentType;
              return docType === "bank_statement";
            })
            .map((doc) => ({
              id: doc.id || doc._id || "",
              originalName: doc.originalName || "Relevé importé",
              createdAt: doc.createdAt,
            }))
            .filter((x) => x.id)
        );

        if (Object.keys(scannedSepaBatches).length > 0) {
          setSepaBatchesByReference((prev) => ({ ...prev, ...scannedSepaBatches }));
        }

        // Load Bridge transactions from Connecteurs sync and merge them into Banque operations.
        try {
          const bridgeAccountsRes = await fetch("/api/bridge/accounts", {
            credentials: "include",
          });
          const bridgeAccountsData = await bridgeAccountsRes.json().catch(() => ({}));
          const bridgeAccounts = Array.isArray(bridgeAccountsData?.resources)
            ? bridgeAccountsData.resources
            : [];

          const bridgeTransactions: LocalTransaction[] = [];

          for (const account of bridgeAccounts) {
            const accountId = String(account?.id || "");
            if (!accountId) continue;
            const bridgeAccountLabel = String(
              account?.display_name || account?.name || account?.iban || `Compte ${accountId}`
            );
            const txRes = await fetch(
              `/api/bridge/transactions?account_id=${encodeURIComponent(accountId)}`,
              { credentials: "include" }
            );
            const txData = await txRes.json().catch(() => ({}));
            const resources = Array.isArray(txData?.resources) ? txData.resources : [];
            resources.forEach((tx: any, index: number) => {
              const amount = Number(tx?.amount || 0);
              const txnDate = String(
                tx?.date || tx?.transaction_date || tx?.booking_date || new Date().toISOString().slice(0, 10)
              );
              const id = `bridge-${accountId}-${String(tx?.id || index + 1)}`;
              bridgeTransactions.push({
                id,
                sourceDocumentId: `bridge-${accountId}`,
                bankAccountId: "ba-import",
                txnDate,
                label: tx?.clean_description || tx?.label || tx?.description || "Opération Bridge",
                reference: String(tx?.id || id),
                amount,
                balance: 0,
                reconciledStatus: "non_rapproché",
                currency: (tx?.currency_code || tx?.currency || "EUR") as CurrencyCode,
                operationType: amount >= 0 ? "encaissement" : "decaissement",
                paymentMethod: "AUTRE",
                matchedInvoiceIds: [],
                bankMeta: {
                  libelle: bridgeAccountLabel,
                },
              });
            });
          }

          if (bridgeTransactions.length > 0) {
            const existingIds = new Set(scannedTransactions.map((t) => t.id));
            bridgeTransactions.forEach((tx) => {
              if (!existingIds.has(tx.id)) scannedTransactions.push(tx);
            });
          }
        } catch (bridgeError) {
          console.warn("Chargement Bridge ignoré dans Banque:", bridgeError);
        }

        if (scannedTransactions.length > 0) {
          setTransactions(scannedTransactions);
        }
      } catch (error) {
        console.error("Erreur chargement opérations scannées:", error);
      }
    };

    void loadScannedBankOperations();
  }, []);

  useEffect(() => {
    const loadRealInvoices = async () => {
      try {
        const res = await fetch("/api/invoices", { credentials: "include" });
        const data = await res.json();
        if (!res.ok) return;
        const fetched: LocalInvoice[] = Array.isArray(data?.invoices) ? data.invoices : [];
        setRealInvoices(fetched);
        localInvoices.splice(0, localInvoices.length, ...fetched);
      } catch (error) {
        console.error("Erreur chargement factures réelles:", error);
      }
    };
    void loadRealInvoices();
  }, []);

  const deleteStatementImport = async (importId: string) => {
    try {
      const response = await fetch(`/api/imports/${encodeURIComponent(importId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 404) {
        throw new Error(payload?.error || "Suppression impossible");
      }
      setRecentStatementImports((prev) => prev.filter((x) => x.id !== importId));
      setTransactions((prev) => prev.filter((t) => t.sourceDocumentId !== importId));
      toast?.success?.("Relevé supprimé.");
    } catch (error) {
      console.error("Suppression relevé impossible:", error);
      toast?.error?.("Impossible de supprimer ce relevé.");
    }
  };

  const deleteSepaImportFromPopup = async () => {
    const sourceDocumentId = linkedSepaPopupBatch?.sourceDocumentId;
    if (!sourceDocumentId) return;
    try {
      const response = await fetch(`/api/imports/${encodeURIComponent(sourceDocumentId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 404) {
        throw new Error(payload?.error || "Suppression impossible");
      }
      setSepaBatchesByReference((prev) => {
        const next = { ...prev };
        Object.entries(next).forEach(([key, batch]) => {
          if (batch?.sourceDocumentId === sourceDocumentId) {
            delete next[key];
          }
        });
        return next;
      });
      setLinkedSepaPopupRef(null);
      toast?.success?.("SEPA supprimée.");
    } catch (error) {
      console.error("Suppression SEPA impossible:", error);
      toast?.error?.("Impossible de supprimer cette SEPA.");
    }
  };

  const baseTransactions = useMemo(() => {
    return transactions;
  }, [transactions]);

  const selectedDetailsTxn = useMemo(() => {
    if (!detailsTxnId) return null;
    return transactions.find((txn) => txn.id === detailsTxnId) ?? null;
  }, [transactions, detailsTxnId]);

  const selectedSepaBatch = useMemo(() => {
    if (!detailsSepaReference) return null;
    return findSepaBatchByReference(detailsSepaReference);
  }, [detailsSepaReference, sepaBatchesByReference]);

  const selectedTxnIsSepa = useMemo(() => {
    if (!selectedDetailsTxn) return false;
    return Boolean(findSepaBatchByReference(selectedDetailsTxn.reference));
  }, [selectedDetailsTxn, sepaBatchesByReference]);

  const linkedSepaPopupBatch = useMemo(() => {
    if (!linkedSepaPopupRef) return null;
    return findSepaBatchByReference(linkedSepaPopupRef);
  }, [linkedSepaPopupRef, sepaBatchesByReference]);

  const linkedSepaPopupTotal = useMemo(() => {
    if (!linkedSepaPopupBatch) return null;
    if (
      typeof linkedSepaPopupBatch.totalAmount === "number" &&
      !Number.isNaN(linkedSepaPopupBatch.totalAmount)
    ) {
      return linkedSepaPopupBatch.totalAmount;
    }
    return linkedSepaPopupBatch.operations.reduce(
      (sum, op) => sum + Number(op.amount || 0),
      0
    );
  }, [linkedSepaPopupBatch]);

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

    if (Boolean(findSepaBatchByReference(selectedDetailsTxn.reference))) {
      setDetailsSepaReference(selectedDetailsTxn.reference);
    } else {
      setDetailsSepaReference(null);
    }
  }, [selectedDetailsTxn]);

  const openDetailsSection = (txn: LocalTransaction, mode: "panel" | "dialog" = "panel") => {
    setDetailsTxnId(txn.id);
    setDetailsSepaReference(Boolean(findSepaBatchByReference(txn.reference)) ? txn.reference : null);
    if (mode === "dialog") {
      setDetailsDialogOpen(true);
    }
  };

  const filteredTxns = useMemo(() => {
    return baseTransactions
      .filter((txn) => {
        const query = normalizeText(searchText);
        if (!query) return true;

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
    counterpartyFilter,
    dateFrom,
    dateTo,
    minAmount,
    maxAmount,
    invoiceFilter,
    sepaOnly,
    payrollOnly,
  ]);

  const linkedInvoiceIdsAcrossDecisions = useMemo(() => {
    return (Object.values(sepaLineDecisions) as SepaOperationDecision[]).flatMap(
      (decision) => decision.selectedInvoiceIds
    );
  }, [sepaLineDecisions]);

  const [manualSuggestions, setManualSuggestions] = useState<SepaOperationCandidate[]>([]);
  const [dialogSepaSuggestions, setDialogSepaSuggestions] = useState<Record<string, SepaOperationCandidate[]>>({});
  const [dialogSepaLoading, setDialogSepaLoading] = useState(false);

  useEffect(() => {
    const loadReconciliationSuggestions = async () => {
      if (!selectedDetailsTxn) {
        setManualSuggestions([]);
        return;
      }

      const candidates = getAvailableInvoicesForTxn(selectedDetailsTxn);
      const aiCandidates =
        candidates.length > 0
          ? candidates
          : realInvoices.filter(
              (inv) => (inv.currency || selectedDetailsTxn.currency) === selectedDetailsTxn.currency
            );
      if (!aiCandidates.length) {
        setManualSuggestions([]);
        return;
      }

      try {
        const res = await fetch("/api/reconciliation/score", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction: selectedDetailsTxn,
            invoices: aiCandidates,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Agent IA indisponible");

        const raw = Array.isArray(data?.suggestions) ? data.suggestions : [];
        const byInvId = new Map(aiCandidates.map((inv) => [inv.id, inv]));

        const fromServer = raw
          .map((s: any) => {
            const invoice = byInvId.get(String(s.invoiceId));
            if (!invoice) return null;
            const score = Number(s.score ?? 0);
            const parts: string[] = [];
            if (Array.isArray(s.signals) && s.signals.length) parts.push(...s.signals);
            if (s.reason) parts.push(String(s.reason));
            if (typeof s.localScore === "number" && s.localScore !== score) {
              parts.push(`Score local: ${s.localScore}%`);
            }
            return {
              invoice,
              score,
              details: getMatchDetails(selectedDetailsTxn, invoice),
              reasons: parts.length ? parts : buildCandidateReasons(selectedDetailsTxn, invoice, score),
            };
          })
          .filter((row): row is SepaOperationCandidate => Boolean(row))
          .filter((item) => item.score >= 24)
          .slice(0, 8);

        const enriched =
          fromServer.length > 0
            ? fromServer
            : [];

        setManualSuggestions(enriched);
      } catch (error) {
        console.error("Erreur scoring rapprochement IA:", error);
        setManualSuggestions([]);
        toast?.error?.("Rapprochement IA indisponible pour cette opération.");
      }
    };

    void loadReconciliationSuggestions();
  }, [selectedDetailsTxn, realInvoices]);

  useEffect(() => {
    const loadDialogSepaSuggestions = async () => {
      if (!detailsDialogOpen || !selectedDetailsTxn || !selectedTxnIsSepa || !selectedSepaBatch) {
        setDialogSepaSuggestions({});
        return;
      }
      if (selectedDetailsTxn.reconciledStatus === "rapproché") {
        setDialogSepaLoading(false);
        setDialogSepaSuggestions({});
        return;
      }

      if (!realInvoices.length) {
        setDialogSepaSuggestions({});
        return;
      }

      setDialogSepaLoading(true);
      try {
        setSepaLineDecisions((prev) => {
          const next = { ...prev };
          selectedSepaBatch.operations.forEach((op) => {
            if (!next[op.id]) {
              next[op.id] = { status: "pending", selectedInvoiceIds: [], rejectAllSuggestions: false };
            }
          });
          return next;
        });

        const entries = await Promise.all(
          selectedSepaBatch.operations.map(async (op) => {
            const opAmountAbs = Math.abs(Number(op.amount || 0));
            const pseudoTxn = {
              id: `${selectedDetailsTxn.id}::${op.id}`,
              sourceDocumentId: selectedDetailsTxn.sourceDocumentId,
              bankAccountId: selectedDetailsTxn.bankAccountId,
              txnDate: selectedDetailsTxn.txnDate,
              label: `${op.creditorName} ${op.remittanceInfo || ""}`.trim(),
              reference: op.endToEndId || selectedDetailsTxn.reference,
              amount: -opAmountAbs,
              balance: selectedDetailsTxn.balance,
              currency: op.currency || selectedDetailsTxn.currency,
              operationType: "decaissement",
              paymentMethod: "SEPA",
              counterpartyName: op.creditorName,
              reconciledStatus: "non_rapproché",
              matchedInvoiceIds: [],
              pendingInvoiceIds: [],
            };

            const candidates = realInvoices.filter(
              (inv) => (inv.currency || pseudoTxn.currency) === pseudoTxn.currency
            );

            if (!candidates.length) return [op.id, [] as SepaOperationCandidate[]] as const;

            const res = await fetch("/api/reconciliation/score", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transaction: pseudoTxn,
                invoices: candidates,
              }),
            });
            const data = await res.json().catch(() => ({}));
            const scoreById = new Map<string, any>(
              (Array.isArray(data?.suggestions) ? data.suggestions : []).map((s: any) => [String(s.invoiceId), s])
            );

            const enriched = candidates
              .map((invoice) => {
                const srv = scoreById.get(invoice.id);
                if (!srv) return null;
                const aiScore = Number(srv.score || 0);
                const amountDiff = Math.abs(opAmountAbs - Number(invoice.amountGross || 0));
                const amountRatio = opAmountAbs > 0 ? amountDiff / opAmountAbs : 1;
                const labelRef = `${op.endToEndId || ""} ${op.remittanceInfo || ""}`.toLowerCase();
                const invoiceNo = String(invoice.invoiceNumber || "").toLowerCase();
                const vendor = String(invoice.vendorCustomer || "").toLowerCase();
                const hasRefHit = invoiceNo.length >= 4 && labelRef.includes(invoiceNo);
                const hasVendorHit =
                  vendor.length >= 4 &&
                  (labelRef.includes(vendor) ||
                    vendor.split(/\s+/).some((w) => w.length >= 4 && labelRef.includes(w)));

                // Guardrails: down-weight AI score when amount is not plausible.
                let score = aiScore;
                if (amountRatio > 0.8) score -= 70;
                else if (amountRatio > 0.5) score -= 45;
                else if (amountRatio > 0.25) score -= 25;
                if (hasRefHit) score += 12;
                if (hasVendorHit) score += 8;
                score = Math.max(0, Math.min(100, Math.round(score)));

                const reasons = [];
                if (Array.isArray(srv?.signals)) reasons.push(...srv.signals);
                if (srv?.reason) reasons.push(String(srv.reason));
                reasons.unshift(`Écart montant ligne: ${formatMoney(amountDiff, invoice.currency ?? pseudoTxn.currency)}`);
                if (hasRefHit) reasons.unshift("Référence exacte détectée");
                if (hasVendorHit) reasons.unshift("Tiers cohérent");
                return {
                  invoice,
                  score,
                  details: getMatchDetails(pseudoTxn as any, invoice),
                  reasons: reasons.length ? reasons : buildCandidateReasons(pseudoTxn as any, invoice, score),
                } as SepaOperationCandidate;
              })
              .filter((x): x is SepaOperationCandidate => Boolean(x))
              .filter((x) => x.score >= 45)
              .sort((a, b) => b.score - a.score)
              .slice(0, 5);

            return [op.id, enriched] as const;
          })
        );

        // Anti-duplicate between SEPA lines: an invoice should not be suggested as top choice on many lines.
        const rawByOp = Object.fromEntries(entries) as Record<string, SepaOperationCandidate[]>;
        const usedInvoiceIds = new Set<string>();
        const opOrder = selectedSepaBatch.operations.map((op) => op.id);
        const finalByOp: Record<string, SepaOperationCandidate[]> = {};

        opOrder.forEach((opId) => {
          const ranked = rawByOp[opId] || [];
          const filtered = ranked.filter((c) => !usedInvoiceIds.has(c.invoice.id));
          const keep = filtered.length > 0 ? filtered : ranked.slice(0, 1);
          finalByOp[opId] = keep.slice(0, 3);
          if (keep[0]?.invoice?.id) usedInvoiceIds.add(keep[0].invoice.id);
        });

        setDialogSepaSuggestions(finalByOp);
      } finally {
        setDialogSepaLoading(false);
      }
    };

    void loadDialogSepaSuggestions();
  }, [detailsDialogOpen, selectedDetailsTxn, selectedSepaBatch, realInvoices, selectedTxnIsSepa]);

  const sepaOperations = selectedSepaBatch?.operations ?? [];
  const sepaCurrentOperation = sepaOperations[sepaCurrentOperationIndex] ?? null;
  const sepaCurrentDecision = sepaCurrentOperation
    ? sepaLineDecisions[sepaCurrentOperation.id] ?? {
        status: "pending",
        selectedInvoiceIds: [],
        rejectAllSuggestions: false,
      }
    : null;
  const sepaCurrentIsLocked =
    Boolean(sepaCurrentOperation?.id) &&
    (sepaCurrentDecision?.status === "approved") &&
    !sepaEditModeByOperation[sepaCurrentOperation.id];

  const sepaCurrentCandidates = useMemo(() => {
    if (!selectedDetailsTxn || !sepaCurrentOperation) return [] as SepaOperationCandidate[];
    if (sepaCurrentDecision?.status === "approved" && !sepaEditModeByOperation[sepaCurrentOperation.id]) {
      return [] as SepaOperationCandidate[];
    }
    return getAvailableInvoicesForSepaOperation(
      selectedDetailsTxn,
      sepaCurrentOperation,
      sepaCurrentDecision?.selectedInvoiceIds ?? [],
      linkedInvoiceIdsAcrossDecisions,
    );
  }, [
    selectedDetailsTxn,
    sepaCurrentOperation,
    sepaCurrentDecision,
    linkedInvoiceIdsAcrossDecisions,
    sepaEditModeByOperation,
  ]);

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

  const persistTxnReconciliation = async (
    txnId: string,
    patch: Record<string, any>,
  ) => {
    const txn = transactions.find((t) => t.id === txnId);
    if (!txn?.sourceDocumentId) return;
    const cacheKey = makeRecoCacheKey(txn.sourceDocumentId, txn.id);
    const currentCache = readLocalReconciliationCache();
    writeLocalReconciliationCache({
      ...currentCache,
      [cacheKey]: {
        ...(currentCache[cacheKey] || {}),
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    });

    try {
      if (backendRecoPersistenceUnavailable) {
        return;
      }
      const res = await fetch(`/api/imports/${encodeURIComponent(txn.sourceDocumentId)}/reconciliation`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: txn.id,
          patch,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        if (res.status === 404) {
          // Endpoint not available on current backend runtime: keep local-only persistence.
          setBackendRecoPersistenceUnavailable(true);
          console.warn("Backend reconciliation persistence endpoint not found (404). Using local cache only.");
          return;
        }
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }
    } catch (error) {
      console.error("persistTxnReconciliation error:", error);
      toast?.error?.("Sauvegarde backend échouée. Sauvegarde locale conservée.");
    }
  };

  const syncInvoicesStatusFromTxn = async (
    toReconciled: string[],
    toUnreconciled: string[],
  ) => {
    try {
      let res = await fetch("/api/reconciliation/invoices-status", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toReconciled,
          toUnreconciled,
        }),
      });
      if (res.status === 404) {
        // Backward compatibility if backend runtime doesn't yet expose reconciliation route
        res = await fetch("/api/invoices/reconciliation-status", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toReconciled,
            toUnreconciled,
          }),
        });
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }
    } catch (error) {
      console.error("syncInvoicesStatusFromTxn error:", error);
      toast?.error?.("Statut facture non synchronisé côté backend.");
    }
  };

  const applyManualReconciliation = () => {
    if (!selectedDetailsTxn) return;
    const previousMatched = selectedDetailsTxn.matchedInvoiceIds ?? [];

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

    void persistTxnReconciliation(selectedDetailsTxn.id, {
      reconciledStatus: manualInvoiceSelection.length > 0 ? "rapproché" : "non_rapproché",
      matchedInvoiceIds: manualInvoiceSelection.length > 0 ? manualInvoiceSelection : [],
      pendingInvoiceIds: manualInvoiceSelection.length > 0 ? [] : [],
      unreconciledCategory: manualCategory || null,
      unreconciledComment: generatedComment || null,
      reviewFlag: manualReviewFlag || noAiSuggestionAccepted,
    });
    void syncInvoicesStatusFromTxn(
      manualInvoiceSelection.length > 0 ? manualInvoiceSelection : [],
      previousMatched.filter((id) => !manualInvoiceSelection.includes(id)),
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
    setSepaEditModeByOperation((prev) => ({ ...prev, [sepaCurrentOperation.id]: false }));
    toast?.success?.("Sous-opération SEPA mise à jour.");
  };

  const validateWholeSepaBatch = () => {
    try {
      if (!selectedDetailsTxn || !selectedSepaBatch) return;
      const previousMatched = selectedDetailsTxn.matchedInvoiceIds ?? [];

      const operations = Array.isArray(selectedSepaBatch.operations)
        ? selectedSepaBatch.operations
        : [];

      const selectedInvoiceIds = Array.from(
        new Set(
          operations.flatMap(
            (op) => sepaLineDecisions[op.id]?.selectedInvoiceIds ?? [],
          ),
        ),
      );

      const statuses = operations.map(
        (op) => sepaLineDecisions[op.id]?.status ?? "pending",
      );
      const approvedCount = statuses.filter((s) => s === "approved").length;
      const pendingCount = statuses.filter((s) => s === "pending").length;
      const allApproved = approvedCount === operations.length && approvedCount > 0;

      if (pendingCount > 0) {
        toast?.error?.("Il reste des lignes SEPA non traitées. Valide/Rejette/À revoir chaque ligne.");
        return;
      }

      const rejectedAllCount = operations.filter(
        (op) => Boolean(sepaLineDecisions[op.id]?.rejectAllSuggestions),
      ).length;

      setTransactions((prev) =>
        prev.map((txn) =>
          txn.id === selectedDetailsTxn.id
            ? {
                ...txn,
                // Mark transaction as fully reconciled only if every SEPA line is approved.
                reconciledStatus: allApproved ? "rapproché" : "non_rapproché",
                matchedInvoiceIds: allApproved ? selectedInvoiceIds : [],
                pendingInvoiceIds: allApproved ? [] : selectedInvoiceIds,
                reviewFlag:
                  operations.some(
                    (op) => (sepaLineDecisions[op.id]?.status ?? "pending") === "review",
                  ) || rejectedAllCount > 0,
                unreconciledComment:
                  [
                    rejectedAllCount > 0 ? `${rejectedAllCount} sous-opération(s) : aucune proposition IA retenue` : "",
                    operations
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

      void persistTxnReconciliation(selectedDetailsTxn.id, {
        reconciledStatus: allApproved ? "rapproché" : "non_rapproché",
        matchedInvoiceIds: allApproved ? selectedInvoiceIds : [],
        pendingInvoiceIds: allApproved ? [] : selectedInvoiceIds,
        reviewFlag:
          operations.some(
            (op) => (sepaLineDecisions[op.id]?.status ?? "pending") === "review",
          ) || rejectedAllCount > 0,
      });
      void syncInvoicesStatusFromTxn(
        allApproved ? selectedInvoiceIds : [],
        previousMatched.filter((id) => !(allApproved ? selectedInvoiceIds : []).includes(id)),
      );

      if (allApproved) {
        toast?.success?.("Lot SEPA entièrement rapproché.");
      } else {
        toast?.success?.("Lot SEPA enregistré en partiel (lignes non approuvées à traiter).");
      }
    } catch (error) {
      console.error("Erreur validateWholeSepaBatch:", error);
      toast?.error?.("Erreur pendant le rapprochement du lot SEPA.");
    }
  };

  const handleFinalizeSepaClick = (e: any) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    validateWholeSepaBatch();
  };

  const handleUnreconcile = (txnId: string) => {
    const current = transactions.find((t) => t.id === txnId);
    const prevMatched = current?.matchedInvoiceIds ?? [];
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
    void persistTxnReconciliation(txnId, {
      reconciledStatus: "non_rapproché",
      matchedInvoiceIds: [],
      pendingInvoiceIds: [],
      reviewFlag: false,
      unreconciledComment: null,
      unreconciledCategory: null,
    });
    void syncInvoicesStatusFromTxn([], prevMatched);
    toast?.success?.("Rapprochement annulé.");
  };

  const handleDeleteImportedDocument = async (txn: LocalTransaction) => {
    if (!txn.sourceDocumentId) {
      toast?.error?.("Cette ligne n'est pas liée à un import supprimable.");
      return;
    }

    try {
      const response = await fetch(`/api/imports/${encodeURIComponent(txn.sourceDocumentId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok && response.status !== 404) {
        throw new Error(payload?.error || "Suppression impossible");
      }

      const removedRefs = transactions
        .filter((t) => t.sourceDocumentId === txn.sourceDocumentId)
        .map((t) => t.reference);

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
    setCounterpartyFilter("");
    setDateFrom("");
    setDateTo("");
    setMinAmount("");
    setMaxAmount("");
    setSepaOnly(false);
    setPayrollOnly(false);
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

            
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
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
          title="Relevés récemment importés"
          subtitle="Supprime un relevé entier sans supprimer chaque opération"
        >
          {recentStatementImports.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun relevé importé récemment.</p>
          ) : (
            <div className="space-y-2">
              {recentStatementImports.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{item.originalName}</p>
                    <p className="text-xs text-slate-500">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString("fr-FR") : "Date inconnue"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteStatementImport(item.id)}
                  >
                    Supprimer relevé
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>



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

        

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_460px]">
          <SectionCard title="Opérations bancaires" subtitle={`${filteredTxns.length} ligne(s) affichée(s)`}>
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="w-[110px]">Date</TableHead>
                    <TableHead className="w-[34%]">Opération</TableHead>
                    <TableHead className="w-[140px]">Montant</TableHead>
                    <TableHead className="w-[18%]">Factures</TableHead>
                    <TableHead className="w-[120px]">Statut</TableHead>
                    <TableHead className="w-[120px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTxns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-500">
                        Aucune opération trouvée.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTxns.map((txn) => {
                      const invoiceIds = getTxnInvoiceIds(txn);
                      const batch = findSepaBatchByReference(txn.reference);
                      const sepaConfig = batch ? getSepaBadgeConfig(batch.type) : null;
                      const SepaIcon = sepaConfig?.icon;

                      return (
                        <TableRow key={txn.id} className={detailsTxnId === txn.id ? "bg-sky-50/60" : ""}>
                          <TableCell className="whitespace-nowrap">{formatDisplayDate(txn.txnDate)}</TableCell>
                          <TableCell className="align-top">
                            <div className="space-y-2 max-w-full overflow-hidden">
                              <div className="truncate font-medium text-slate-900" title={txn.label}>
                                {txn.label}
                              </div>
                              <div className="truncate text-xs text-slate-500" title={txn.reference}>
                                {txn.reference}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {txn.bankMeta?.libelle ? (
                                  <span
                                    className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700 ring-1 ring-indigo-100"
                                    title={`Compte: ${txn.bankMeta.libelle}`}
                                  >
                                    Compte: {txn.bankMeta.libelle}
                                  </span>
                                ) : null}
                                {getCounterpartyDisplay(txn) ? (
                                  <span
                                    className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600"
                                    title={`${getCounterpartyDisplay(txn)?.role}: ${getCounterpartyDisplay(txn)?.value}`}
                                  >
                                    <Building2 className="h-3 w-3" />
                                    {getCounterpartyDisplay(txn)?.role}: {getCounterpartyDisplay(txn)?.value}
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
                                {batch ? (
                                  <button
                                    type="button"
                                    onClick={() => setLinkedSepaPopupRef(batch.id || txn.reference)}
                                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100"
                                    title={`Voir le lot SEPA ${batch.id || txn.reference}`}
                                  >
                                    <Link2 className="h-3 w-3" />
                                    SEPA lié
                                  </button>
                                ) : null}
                              </div>
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
                              <Button variant="ghost" size="sm" onClick={() => openDetailsSection(txn, "dialog")}>
                                Voir
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64">
                                  <DropdownMenuItem onClick={() => openDetailsSection(txn, "dialog")}>
                                    <Info className="mr-2 h-4 w-4" />
                                    Voir le détail
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openDetailsSection(txn, "dialog")}>
                                    <Link2 className="mr-2 h-4 w-4" />
                                    Ouvrir le rapprochement
                                  </DropdownMenuItem>
                                  {batch ? (
                                    <DropdownMenuItem
                                      onClick={() => setLinkedSepaPopupRef(batch.id || txn.reference)}
                                    >
                                      Voir détail SEPA
                                    </DropdownMenuItem>
                                  ) : null}
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

          <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">

            {selectedDetailsTxn && !selectedTxnIsSepa ? (
              <SectionCard title="Rapprochement" subtitle="Sélection manuelle des factures proposées">
                <div className="space-y-4">
                  {manualSuggestions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                      {realInvoices.length === 0
                        ? "Aucune facture réelle chargée pour proposer un rapprochement."
                        : "Aucune suggestion disponible pour cette opération."}
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

            {selectedDetailsTxn && selectedTxnIsSepa && selectedSepaBatch ? (
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
                        {sepaCurrentIsLocked ? (
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                            <p className="text-sm font-medium text-emerald-800">
                              Cette sous-opération est déjà rapprochée.
                            </p>
                            <p className="mt-1 text-xs text-emerald-700">
                              Le système ne repropose pas de nouvelles factures tant que tu ne demandes pas une modification.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(sepaCurrentDecision?.selectedInvoiceIds || []).map((invoiceId) => {
                                const inv = getInvoicesByIds([invoiceId])[0];
                                if (!inv) return null;
                                return (
                                  <span
                                    key={invoiceId}
                                    className="rounded-full bg-white px-2 py-1 text-xs text-emerald-800 ring-1 ring-emerald-200"
                                  >
                                    {inv.invoiceNumber}
                                  </span>
                                );
                              })}
                            </div>
                            <div className="mt-3">
                              <Button
                                variant="outline"
                                onClick={() =>
                                  setSepaEditModeByOperation((prev) => ({
                                    ...prev,
                                    [sepaCurrentOperation.id]: true,
                                  }))
                                }
                              >
                                Modifier ce rapprochement
                              </Button>
                            </div>
                          </div>
                        ) : sepaCurrentCandidates.length === 0 ? (
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

                      {!sepaCurrentIsLocked ? (
                        <>
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
                        </>
                      ) : null}

                      <div className="border-t border-slate-200 pt-4">
                        <Button
                          type="button"
                          onClick={handleFinalizeSepaClick}
                        >
                          Appliquer le lot SEPA
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog
        open={detailsDialogOpen}
        onOpenChange={(open) => {
          setDetailsDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-5xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Détail opération</DialogTitle>
            <DialogDescription>
              {selectedDetailsTxn
                ? `${formatDisplayDate(selectedDetailsTxn.txnDate)} · ${selectedDetailsTxn.reference}`
                : "Aucune opération sélectionnée"}
            </DialogDescription>
          </DialogHeader>

          {!selectedDetailsTxn ? (
            <p className="text-sm text-slate-500">Aucun détail sélectionné.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{selectedDetailsTxn.label}</p>
                    <p className="mt-1 text-xs text-slate-500">{selectedDetailsTxn.reference}</p>
                  </div>
                  <StatusBadge status={selectedDetailsTxn.reconciledStatus} />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
                  <p>Date: {formatDisplayDate(selectedDetailsTxn.txnDate)}</p>
                  <p>Montant: {formatMoney(selectedDetailsTxn.amount, selectedDetailsTxn.currency)}</p>
                  <p>
                    Contrepartie:{" "}
                    {getCounterpartyDisplay(selectedDetailsTxn)
                      ? `${getCounterpartyDisplay(selectedDetailsTxn)?.role}: ${getCounterpartyDisplay(selectedDetailsTxn)?.value}`
                      : "—"}
                  </p>
                </div>
              </div>

              {selectedTxnIsSepa ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                    <p className="text-sm text-slate-700">
                      Cette opération est liée à un lot SEPA. Voici les lignes et leurs factures liées.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setLinkedSepaPopupRef(selectedDetailsTxn.reference)}
                    >
                      Voir détail SEPA
                    </Button>
                  </div>

                  {selectedSepaBatch ? (
                    <div className="space-y-3">
                      {selectedSepaBatch.operations.map((op) => {
                        const currentDecision = sepaLineDecisions[op.id] ?? {
                          status: "pending",
                          selectedInvoiceIds: [],
                          rejectAllSuggestions: false,
                        };
                        const linkedIds =
                          currentDecision.selectedInvoiceIds.length > 0
                            ? currentDecision.selectedInvoiceIds
                            : (op.linkedInvoiceIds || []);
                        const linkedInvoices = getInvoicesByIds(linkedIds);

                        return (
                          <div key={op.id} className="rounded-xl border border-slate-200 p-3">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Opération SEPA
                              </p>
                              <span className={`rounded-full px-2 py-1 text-xs ${getDecisionBadgeClass(currentDecision.status)}`}>
                                {getDecisionLabel(currentDecision.status)}
                              </span>
                            </div>

                            <div className="mb-3 rounded-lg bg-slate-50 p-3">
                              <p className="text-sm font-medium text-slate-900">{op.creditorName}</p>
                              <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                                <span>Réf: {op.endToEndId}</span>
                                <span>Montant: {formatMoney(op.amount, op.currency)}</span>
                                {op.remittanceInfo ? <span>Libellé: {op.remittanceInfo}</span> : null}
                              </div>
                            </div>

                            {linkedInvoices.length === 0 ? (
                              <p className="text-xs text-slate-500">Aucune facture liée pour cette ligne.</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {linkedInvoices.map((invoice) => (
                                  <span
                                    key={`${op.id}-${invoice.id}`}
                                    className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
                                  >
                                    {invoice.invoiceNumber} · {invoice.vendorCustomer}
                                  </span>
                                ))}
                              </div>
                            )}

                            <div className="mt-2 flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const index = selectedSepaBatch.operations.findIndex((x) => x.id === op.id);
                                  if (index >= 0) setSepaCurrentOperationIndex(index);
                                  setSepaEditModeByOperation((prev) => ({ ...prev, [op.id]: true }));
                                }}
                              >
                                Modifier cette sous-opération
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setDetailsDialogOpen(false)}>
                      Fermer
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => {
                        const ids = selectedSepaBatch?.operations?.map((op) => op.id) || [];
                        setSepaEditModeByOperation((prev) => {
                          const next = { ...prev };
                          ids.forEach((id) => {
                            next[id] = true;
                          });
                          return next;
                        });
                        setDetailsDialogOpen(false);
                      }}
                    >
                      Modifier plusieurs sous-opérations
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-900">Suggestions de rapprochement</p>
                  <p className="text-xs text-slate-500">
                    Score et texte viennent du moteur serveur (montant, dates, références, sens achat/vente), avec complément IA seulement si cohérent.
                  </p>
                  {manualSuggestions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                      Aucune suggestion trouvée.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {manualSuggestions.map((candidate) => {
                        const checked = manualInvoiceSelection.includes(candidate.invoice.id);
                        return (
                          <div
                            key={candidate.invoice.id}
                            className={`rounded-2xl border p-4 ${
                              checked ? "border-sky-300 bg-sky-50/50" : "border-slate-200 bg-white"
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <label className="flex flex-1 cursor-pointer items-start gap-2">
                                <input
                                  type="checkbox"
                                  className="mt-1"
                                  checked={checked}
                                  onChange={() => toggleManualInvoice(candidate.invoice.id)}
                                />
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-slate-900">
                                      {candidate.invoice.invoiceNumber}
                                    </span>
                                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-100">
                                      {candidate.score}% score
                                    </span>
                                  </div>
                                  <p className="text-sm text-slate-700">{candidate.invoice.vendorCustomer}</p>
                                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                                    <span>
                                      Montant facture :{" "}
                                      {formatMoney(
                                        candidate.invoice.amountGross,
                                        candidate.invoice.currency ?? selectedDetailsTxn.currency,
                                      )}
                                    </span>
                                    <span>
                                      Écart opération :{" "}
                                      {formatMoney(
                                        candidate.details.amountDiff,
                                        candidate.invoice.currency ?? selectedDetailsTxn.currency,
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {candidate.reasons.map((reason, idx) => (
                                      <span
                                        key={`${candidate.invoice.id}-r-${idx}`}
                                        className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700"
                                      >
                                        {reason}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button onClick={applyManualReconciliation}>Rapprocher</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(linkedSepaPopupBatch)} onOpenChange={(open) => !open && setLinkedSepaPopupRef(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>
                {linkedSepaPopupBatch?.label || linkedSepaPopupBatch?.id || "Détail SEPA"}
              </DialogTitle>
              {linkedSepaPopupBatch?.sourceDocumentId ? (
                <Button variant="outline" size="sm" onClick={() => void deleteSepaImportFromPopup()}>
                  Supprimer SEPA
                </Button>
              ) : null}
            </div>
            <DialogDescription>
              Référence : {linkedSepaPopupBatch?.id || "—"}
            </DialogDescription>
          </DialogHeader>

          {linkedSepaPopupBatch ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
                <div>
                  <p className="text-slate-500">Exécution</p>
                  <p className="font-medium text-slate-900">
                    {linkedSepaPopupBatch.executionDate
                      ? formatDisplayDate(linkedSepaPopupBatch.executionDate)
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Débiteur</p>
                  <p className="font-medium text-slate-900">{linkedSepaPopupBatch.debtorName || "—"}</p>
                </div>
                <div>
                  <p className="text-slate-500">IBAN</p>
                  <p className="font-medium text-slate-900 break-all">{linkedSepaPopupBatch.debtorIban || "—"}</p>
                </div>
                <div>
                  <p className="text-slate-500">Nb opérations</p>
                  <p className="font-medium text-slate-900">
                    {linkedSepaPopupBatch.numberOfTransactions ??
                      linkedSepaPopupBatch.operations.length}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Total</p>
                  <p className="font-medium text-slate-900">
                    {typeof linkedSepaPopupTotal === "number"
                      ? formatMoney(
                          linkedSepaPopupTotal,
                          linkedSepaPopupBatch.debtorCurrency
                        )
                      : "—"}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                <Table className="table-fixed w-full">
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>Créancier</TableHead>
                      <TableHead>Référence</TableHead>
                      <TableHead>IBAN</TableHead>
                      <TableHead className="w-[160px]">Montant</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedSepaPopupBatch.operations.map((op) => (
                      <TableRow key={op.id}>
                        <TableCell>{op.creditorName}</TableCell>
                        <TableCell>{op.endToEndId}</TableCell>
                        <TableCell className="truncate" title={op.creditorIban}>
                          {op.creditorIban}
                        </TableCell>
                        <TableCell className="font-mono font-semibold text-slate-900">
                          {formatMoney(op.amount, op.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}