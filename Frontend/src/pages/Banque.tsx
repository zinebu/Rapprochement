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
import { initialTransactions, localInvoices, unreconciledCategoryLabels } from "@/features/banque/data";

import type {
  CurrencyCode,
  InvoiceFilter,
  LocalInvoice,
  LocalTransaction,
  OperationType,
  PaymentMethod,
  ReconciliationFilter,
  SepaOperationCandidate,
  SepaCombination,
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
  getCurrencyBadgeClass,
  getDecisionBadgeClass,
  getDecisionLabel,
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
  const [sepaBatchesByReference, setSepaBatchesByReference] = useState<Record<string, SepaBatchTemplate>>({});
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

  const supplierNameLooksSame = (a?: string | null, b?: string | null) => {
    const na = normalizeText(a || "");
    const nb = normalizeText(b || "");
    if (!na || !nb) return false;
    if (na === nb) return true;
    const stopWords = new Set([
      "consult",
      "consulting",
      "groupe",
      "holding",
      "services",
      "service",
      "solutions",
      "solution",
      "company",
      "societe",
      "société",
      "entreprise",
      "international",
      "france",
      "europe",
      "eurl",
      "sarl",
      "sas",
      "sasu",
      "sa",
      "ei",
      "it",
    ]);
    const tokenize = (s: string) =>
      s.split(/\s+/).filter((w) => w.length >= 4 && !stopWords.has(w));
    const wa = tokenize(na);
    const wb = tokenize(nb);
    if (wa.length === 0 || wb.length === 0) return false;
    return wa.some((w) => wb.includes(w));
  };

  const buildSupplierFallbackCombo = (
    targetAmountAbs: number,
    supplierName: string,
    invoices: LocalInvoice[],
  ): SepaCombination[] => {
    if (!targetAmountAbs || !supplierName) return [];
    const supplierInvoices = invoices.filter((inv) => {
      const status = String(inv.status || "").toLowerCase();
      const isReconciled =
        status === "rapprochée" || status === "rapprochee" || status === "reconciled";
      return (
        !isReconciled &&
        Number(inv.amountGross || 0) > 0 &&
        supplierNameLooksSame(supplierName, inv.vendorCustomer)
      );
    });
    if (supplierInvoices.length === 0) return [];
    const total = supplierInvoices.reduce((sum, inv) => sum + Number(inv.amountGross || 0), 0);
    const diff = Math.abs(total - targetAmountAbs);
    if (diff > 1.5) return [];
    return [
      {
        invoiceIds: supplierInvoices.map((inv) => String(inv.id)),
        invoices: supplierInvoices.map((inv) => ({
          id: String(inv.id),
          invoiceNumber: inv.invoiceNumber,
          vendorCustomer: inv.vendorCustomer,
          amountGross: Number(inv.amountGross || 0),
        })),
        totalAmount: Math.round(total * 100) / 100,
        diff: Math.round(diff * 100) / 100,
        score: diff === 0 ? 100 : 95,
        reason: `Fournisseur SEPA identifié · Combinaison de ${supplierInvoices.length} factures · Montant exact`,
        matchType: "supplier",
      },
    ];
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
                sepaLineDecisions:
                  persisted.sepaLineDecisions && typeof persisted.sepaLineDecisions === "object"
                    ? persisted.sepaLineDecisions
                    : undefined,
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

        // Replace with scanned imports only to avoid stale/mock SEPA linkage.
        setSepaBatchesByReference(scannedSepaBatches);

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

  useEffect(() => {
    if (!selectedDetailsTxn || !selectedTxnIsSepa || !selectedSepaBatch) {
      setSepaLineDecisions({});
      setSepaEditModeByOperation({});
      return;
    }

    // Rebuild decisions from the currently selected SEPA batch only,
    // so stale decisions from a previously opened batch cannot lock this one.
    const seededDecisions: Record<string, SepaOperationDecision> = {};
    const persistedLineDecisions =
      selectedDetailsTxn.sepaLineDecisions && typeof selectedDetailsTxn.sepaLineDecisions === "object"
        ? selectedDetailsTxn.sepaLineDecisions
        : {};
    selectedSepaBatch.operations.forEach((op) => {
      const persistedDecision = persistedLineDecisions[op.id];
      const linkedIds = Array.isArray(op.linkedInvoiceIds) ? op.linkedInvoiceIds : [];
      const isTxnReconciled = selectedDetailsTxn.reconciledStatus === "rapproché";
      seededDecisions[op.id] = {
        status:
          persistedDecision?.status
            ? persistedDecision.status
            : isTxnReconciled && linkedIds.length > 0
              ? "approved"
              : "pending",
        selectedInvoiceIds: Array.isArray(persistedDecision?.selectedInvoiceIds)
          ? persistedDecision.selectedInvoiceIds
          : linkedIds,
        rejectAllSuggestions: Boolean(persistedDecision?.rejectAllSuggestions),
      };
    });

    setSepaLineDecisions(seededDecisions);
    setSepaEditModeByOperation({});
    setSepaCurrentOperationIndex(0);
  }, [selectedDetailsTxn?.id, selectedDetailsTxn?.reconciledStatus, detailsDialogOpen, selectedTxnIsSepa, selectedSepaBatch]);

  const openDetailsSection = (txn: LocalTransaction, mode: "panel" | "dialog" = "panel") => {
    setDetailsTxnId(txn.id);
    setDetailsSepaReference(Boolean(findSepaBatchByReference(txn.reference)) ? txn.reference : null);
    if (mode === "dialog") {
      setDetailsDialogOpen(true);
    } else {
      setDetailsDialogOpen(false);
      window.setTimeout(() => {
        const anchor = document.getElementById("reconciliation-editor");
        anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  };

  const filteredTxns = useMemo(() => {
    return baseTransactions
      .filter((txn) => {
        const query = normalizeText(searchText);
        if (!query) return true;

        const invoiceNumbers = resolveInvoicesByIds(getTxnInvoiceIds(txn))
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

  const [aiSuggestionAvailableByTxn, setAiSuggestionAvailableByTxn] = useState<Record<string, boolean>>({});

  const linkedInvoiceIdsAcrossDecisions = useMemo(() => {
    return (Object.values(sepaLineDecisions) as SepaOperationDecision[]).flatMap(
      (decision) => decision.selectedInvoiceIds
    );
  }, [sepaLineDecisions]);

  const [manualSuggestions, setManualSuggestions] = useState<SepaOperationCandidate[]>([]);
  const [aiScoreCacheByTxn, setAiScoreCacheByTxn] = useState<Record<string, any>>({});
  const [sepaFirstOpCacheByTxn, setSepaFirstOpCacheByTxn] = useState<
    Record<string, { opId: string; suggestions: SepaOperationCandidate[]; combinations: SepaCombination[] }>
  >({});
  const [dialogSepaSuggestions, setDialogSepaSuggestions] = useState<Record<string, SepaOperationCandidate[]>>({});
  const [dialogSepaCombinations, setDialogSepaCombinations] = useState<Record<string, SepaCombination[]>>({});
  const [batchLevelCombinations, setBatchLevelCombinations] = useState<SepaCombination[]>([]);
  const [dialogSepaLoading, setDialogSepaLoading] = useState(false);
  const autoReconciledRef = useRef<Set<string>>(new Set());
  const manualSuggestionsReqRef = useRef(0);
  const AUTO_RECONCILE_THRESHOLD = 95;

  useEffect(() => {
    const checkAiSuggestionsAvailability = async () => {
      if (!realInvoices.length) {
        setAiSuggestionAvailableByTxn({});
        return;
      }

      const openInvoices = realInvoices.filter((inv) => {
        const status = String(inv.status || "").toLowerCase();
        return !["rapprochée", "rapprochee", "reconciled"].includes(status);
      });
      if (!openInvoices.length) {
        setAiSuggestionAvailableByTxn({});
        return;
      }

      // Limit calls to visible top rows for responsiveness.
      const targets = filteredTxns
        .filter((txn) => txn.reconciledStatus !== "rapproché")
        .slice(0, 25);

      const entries = await Promise.all(
        targets.map(async (txn) => {
          try {
            const res = await fetch("/api/reconciliation/score", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transaction: txn,
                invoices: openInvoices,
              }),
            });
            const data = await res.json().catch(() => ({}));
            const scoring = String(data?.scoring || "");
            const hasAi = scoring.includes("ai");
            const hasAnySuggestion =
              (Array.isArray(data?.suggestions) && data.suggestions.length > 0) ||
              (Array.isArray(data?.combinations) && data.combinations.length > 0);
            return [txn.id, hasAi && hasAnySuggestion, data] as const;
          } catch {
            return [txn.id, false, null] as const;
          }
        })
      );

      const next: Record<string, boolean> = {};
      const cacheNext: Record<string, any> = {};
      const sepaPrefetchNext: Record<string, { opId: string; suggestions: SepaOperationCandidate[]; combinations: SepaCombination[] }> = {};
      entries.forEach(([id, flag, data]) => {
        next[id] = flag;
        if (data) cacheNext[id] = data;
      });

      // Prefetch first SEPA line suggestions for instant dialog open.
      await Promise.all(
        targets.map(async (txn) => {
          try {
            if (!next[txn.id]) return;
            const batch = findSepaBatchByReference(txn.reference);
            if (!batch || !Array.isArray(batch.operations) || batch.operations.length === 0) return;
            const firstOp = batch.operations[0];
            const res = await fetch("/api/reconciliation/score", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transaction: {
                  id: `${txn.id}::${firstOp.id}`,
                  sourceDocumentId: txn.sourceDocumentId,
                  bankAccountId: txn.bankAccountId,
                  txnDate: txn.txnDate,
                  label: `${firstOp.creditorName} ${firstOp.remittanceInfo || ""}`.trim(),
                  reference: firstOp.endToEndId || txn.reference,
                  amount: -Math.abs(Number(firstOp.amount || 0)),
                  balance: txn.balance,
                  currency: firstOp.currency || txn.currency,
                  operationType: "decaissement",
                  paymentMethod: "SEPA",
                  counterpartyName: firstOp.creditorName,
                  reconciledStatus: "non_rapproché",
                  matchedInvoiceIds: [],
                  pendingInvoiceIds: [],
                },
                invoices: openInvoices,
              }),
            });
            const scoreData = await res.json().catch(() => ({}));
            if (!res.ok) return;
            sepaPrefetchNext[txn.id] = buildSepaOpResultFromScorePayload(firstOp, txn, realInvoices, scoreData);
          } catch {
            // silent
          }
        })
      );

      setAiSuggestionAvailableByTxn(next);
      setAiScoreCacheByTxn((prev) => ({ ...prev, ...cacheNext }));
      if (Object.keys(sepaPrefetchNext).length > 0) {
        setSepaFirstOpCacheByTxn((prev) => ({ ...prev, ...sepaPrefetchNext }));
      }
    };

    void checkAiSuggestionsAvailability();
  }, [filteredTxns, realInvoices]);

  const resolveInvoicesByIds = (ids?: string[]) => {
    if (!ids?.length) return [] as LocalInvoice[];
    const byId = new Map(realInvoices.map((invoice) => [invoice.id, invoice] as const));
    return ids
      .map((id) => byId.get(id) || localInvoices.find((invoice) => invoice.id === id))
      .filter(Boolean) as LocalInvoice[];
  };

  const getFullPdfUrl = (pdfUrl?: string | null) => {
    if (!pdfUrl) return null;
    if (pdfUrl.startsWith("http://") || pdfUrl.startsWith("https://")) return pdfUrl;
    return pdfUrl;
  };

  const openInvoicePdf = (invoice: LocalInvoice) => {
    const url = getFullPdfUrl(invoice.pdfUrl);
    if (!url) {
      toast?.error?.("Aucun PDF disponible pour cette facture.");
      return;
    }
    const title = invoice.invoiceNumber
      ? `Facture ${invoice.invoiceNumber}${invoice.vendorCustomer ? ` — ${invoice.vendorCustomer}` : ""}`
      : "Aperçu facture";
    setPreviewPdfTitle(title);
    setPreviewPdfUrl(url);
  };

  const resolveSepaLinkedInvoiceIds = (op: any, decision: SepaOperationDecision) => {
    const direct = decision.selectedInvoiceIds?.length ? decision.selectedInvoiceIds : (op.linkedInvoiceIds || []);
    return Array.isArray(direct) ? direct : [];
  };

  const buildSepaOpResultFromScorePayload = (
    op: any,
    selectedTxn: LocalTransaction,
    candidates: LocalInvoice[],
    data: any
  ) => {
    const opAmountAbs = Math.abs(Number(op.amount || 0));
    const pseudoTxn = {
      id: `${selectedTxn.id}::${op.id}`,
      sourceDocumentId: selectedTxn.sourceDocumentId,
      bankAccountId: selectedTxn.bankAccountId,
      txnDate: selectedTxn.txnDate,
      label: `${op.creditorName} ${op.remittanceInfo || ""}`.trim(),
      reference: op.endToEndId || selectedTxn.reference,
      amount: -opAmountAbs,
      balance: selectedTxn.balance,
      currency: op.currency || selectedTxn.currency,
      operationType: "decaissement",
      paymentMethod: "SEPA",
      sepaContext: true,
      counterpartyName: op.creditorName,
      reconciledStatus: "non_rapproché",
      matchedInvoiceIds: [],
      pendingInvoiceIds: [],
    };

    const scoreById = new Map<string, any>(
      (Array.isArray(data?.suggestions) ? data.suggestions : []).map((s: any) => [String(s.invoiceId), s])
    );
    const rawCombos: SepaCombination[] = Array.isArray(data?.combinations)
      ? (data.combinations as any[]).map((c) => ({
          invoiceIds: Array.isArray(c.invoiceIds) ? c.invoiceIds.map(String) : [],
          invoices: Array.isArray(c.invoices) ? c.invoices : [],
          totalAmount: Number(c.totalAmount || 0),
          diff: Number(c.diff || 0),
          score: Number(c.score || 0),
          reason: String(c.reason || ""),
          matchType: (c.matchType === "supplier" || c.matchType === "amount") ? c.matchType : "amount",
        }))
      : [];
    const fallbackCombos =
      rawCombos.length === 0
        ? buildSupplierFallbackCombo(opAmountAbs, op.creditorName || "", candidates)
        : [];
    const finalCombos = rawCombos.length > 0 ? rawCombos : fallbackCombos;

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
        const creditorName = String(op.creditorName || "");
        const hasRefHit = invoiceNo.length >= 4 && labelRef.includes(invoiceNo);
        const hasVendorHit =
          vendor.length >= 4 &&
          (labelRef.includes(vendor) ||
            vendor.split(/\s+/).some((w) => w.length >= 4 && labelRef.includes(w)));
        const hasCreditorSupplierHit = supplierNameLooksSame(creditorName, invoice.vendorCustomer || "");
        const amountLooksPlausible = amountRatio <= 0.15;
        const strongAmountMatch = amountRatio <= 0.03;

        let score = aiScore;
        if (amountRatio > 0.8) score -= 70;
        else if (amountRatio > 0.5) score -= 45;
        else if (amountRatio > 0.25) score -= 25;
        if (hasRefHit) score += 12;
        if (hasVendorHit) score += 8;
        if (hasCreditorSupplierHit) score += 18;
        score = Math.max(0, Math.min(100, Math.round(score)));

        const passesBusinessGate = hasRefHit || hasCreditorSupplierHit || strongAmountMatch;
        if (!passesBusinessGate) return null;
        if (!hasCreditorSupplierHit && !hasRefHit && !amountLooksPlausible) return null;

        const reasons = [];
        if (Array.isArray(srv?.signals)) reasons.push(...srv.signals);
        if (srv?.reason) reasons.push(String(srv.reason));
        reasons.unshift(`Écart montant ligne: ${formatMoney(amountDiff, invoice.currency ?? pseudoTxn.currency)}`);
        if (hasRefHit) reasons.unshift("Référence exacte détectée");
        if (hasVendorHit) reasons.unshift("Tiers cohérent");
        if (hasCreditorSupplierHit) reasons.unshift("Créancier SEPA cohérent avec le fournisseur");
        return {
          invoice,
          score,
          details: getMatchDetails(pseudoTxn as any, invoice),
          reasons: reasons.length ? reasons : buildCandidateReasons(pseudoTxn as any, invoice, score),
        } as SepaOperationCandidate;
      })
      .filter((x): x is SepaOperationCandidate => Boolean(x))
      .filter((x) => x.score >= 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return {
      opId: op.id,
      suggestions: enriched,
      combinations: finalCombos,
    };
  };

  const buildManualSuggestionsFromPayload = (payload: any, txn: LocalTransaction) => {
    const aiCandidates = realInvoices
      .filter((inv) => (inv.currency || txn.currency) === txn.currency)
      .filter((inv) => {
        const invoiceType = inv.type ?? (txn.amount < 0 ? "purchase" : "sales");
        return txn.amount < 0 ? invoiceType === "purchase" : invoiceType === "sales";
      });
    const raw = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
    const byInvId = new Map(aiCandidates.map((inv) => [inv.id, inv]));
    return raw
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
          details: getMatchDetails(txn, invoice),
          reasons: parts.length ? parts : buildCandidateReasons(txn, invoice, score),
        };
      })
      .filter((row): row is SepaOperationCandidate => Boolean(row))
      .filter((item) => item.score >= 24)
      .slice(0, 8);
  };

  const handleSuggestionBadgeClick = async (txn: LocalTransaction) => {
    const batch = findSepaBatchByReference(txn.reference);
    // For non-SEPA: open reconciliation panel "sur place".
    // For SEPA: keep dialog flow and inject prefetched suggestions instantly.
    if (batch) {
      // Open immediately; never block UI on network.
      openDetailsSection(txn, "dialog");
      const prefetched = sepaFirstOpCacheByTxn[txn.id];
      if (prefetched) {
        setDialogSepaSuggestions({ [prefetched.opId]: prefetched.suggestions });
        setDialogSepaCombinations({ [prefetched.opId]: prefetched.combinations });
        if (Array.isArray(batch.operations) && batch.operations.length === 1) {
          setBatchLevelCombinations(prefetched.combinations);
        }
        const idx = Math.max(
          0,
          batch.operations.findIndex((op) => op.id === prefetched.opId)
        );
        setSepaCurrentOperationIndex(idx);
        setDialogSepaLoading(false);
      } else if (Array.isArray(batch.operations) && batch.operations.length > 0 && realInvoices.length > 0) {
        // Hard instant path: fetch only first line now (single API call), no wait for full batch.
        void (async () => {
          try {
          const firstOp = batch.operations[0];
          const aiCandidates = realInvoices.filter((inv) => {
            const status = String(inv.status || "").toLowerCase();
            return !["rapprochée", "rapprochee", "reconciled"].includes(status);
          });
          if (aiCandidates.length > 0) {
            const pseudoTxn = {
              id: `${txn.id}::${firstOp.id}`,
              sourceDocumentId: txn.sourceDocumentId,
              bankAccountId: txn.bankAccountId,
              txnDate: txn.txnDate,
              label: `${firstOp.creditorName} ${firstOp.remittanceInfo || ""}`.trim(),
              reference: firstOp.endToEndId || txn.reference,
              amount: -Math.abs(Number(firstOp.amount || 0)),
              balance: txn.balance,
              currency: firstOp.currency || txn.currency,
              operationType: "decaissement",
              paymentMethod: "SEPA",
              sepaContext: true,
              counterpartyName: firstOp.creditorName,
              reconciledStatus: "non_rapproché",
              matchedInvoiceIds: [],
              pendingInvoiceIds: [],
            };
            const res = await fetch("/api/reconciliation/score", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transaction: pseudoTxn,
                invoices: aiCandidates,
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              const built = buildSepaOpResultFromScorePayload(firstOp, txn, realInvoices, data);
              setDialogSepaSuggestions({ [built.opId]: built.suggestions });
              setDialogSepaCombinations({ [built.opId]: built.combinations });
              if (Array.isArray(batch.operations) && batch.operations.length === 1) {
                setBatchLevelCombinations(built.combinations);
              }
              setSepaFirstOpCacheByTxn((prev) => ({ ...prev, [txn.id]: built }));
              setSepaCurrentOperationIndex(0);
              setDialogSepaLoading(false);
            }
          }
          } catch {
            // fallback to normal dialog load
          }
        })();
      }
      return;
    }

    openDetailsSection(txn, "dialog");

    const cachedPayload = aiScoreCacheByTxn[txn.id];
    if (cachedPayload) {
      setManualSuggestions(buildManualSuggestionsFromPayload(cachedPayload, txn));
      return;
    }

    try {
      const aiCandidates = realInvoices
        .filter((inv) => (inv.currency || txn.currency) === txn.currency)
        .filter((inv) => {
          const invoiceType = inv.type ?? (txn.amount < 0 ? "purchase" : "sales");
          return txn.amount < 0 ? invoiceType === "purchase" : invoiceType === "sales";
        });
      const res = await fetch("/api/reconciliation/score", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction: txn,
          invoices: aiCandidates,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setAiScoreCacheByTxn((prev) => ({ ...prev, [txn.id]: data }));
      setManualSuggestions(buildManualSuggestionsFromPayload(data, txn));
    } catch {
      // keep UI responsive even if prefetch fails
    }
  };

  useEffect(() => {
    const loadReconciliationSuggestions = async () => {
      if (!selectedDetailsTxn) {
        setManualSuggestions([]);
        return;
      }
      const requestId = ++manualSuggestionsReqRef.current;
      const txnSnapshot = selectedDetailsTxn;

      const aiCandidates = realInvoices
        .filter((inv) => (inv.currency || selectedDetailsTxn.currency) === selectedDetailsTxn.currency)
        .filter((inv) => {
          const invoiceType = inv.type ?? (selectedDetailsTxn.amount < 0 ? "purchase" : "sales");
          return selectedDetailsTxn.amount < 0 ? invoiceType === "purchase" : invoiceType === "sales";
        });
      if (!aiCandidates.length) {
        setManualSuggestions([]);
        return;
      }

      // Instant opening path: use preloaded IA cache if available.
      const cachedPayload = aiScoreCacheByTxn[txnSnapshot.id];
      if (cachedPayload) {
        if (manualSuggestionsReqRef.current === requestId) {
          setManualSuggestions(buildManualSuggestionsFromPayload(cachedPayload, txnSnapshot));
        }
        return;
      }

      try {
        const res = await fetch("/api/reconciliation/score", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction: txnSnapshot,
            invoices: aiCandidates,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Agent IA indisponible");

        if (manualSuggestionsReqRef.current !== requestId) return;
        setAiScoreCacheByTxn((prev) => ({ ...prev, [txnSnapshot.id]: data }));
        setManualSuggestions(buildManualSuggestionsFromPayload(data, txnSnapshot));
      } catch (error) {
        console.error("Erreur scoring rapprochement IA:", error);
        if (manualSuggestionsReqRef.current === requestId) {
          setManualSuggestions([]);
          toast?.error?.("Rapprochement IA indisponible pour cette opération.");
        }
      }
    };

    void loadReconciliationSuggestions();
  }, [selectedDetailsTxn, realInvoices, aiScoreCacheByTxn]);

  useEffect(() => {
    const loadDialogSepaSuggestions = async () => {
      console.log("[SEPA-SUGGEST] open=", detailsDialogOpen, "txn=", selectedDetailsTxn?.id, "isSepa=", selectedTxnIsSepa, "batch=", selectedSepaBatch?.id, "invoices=", realInvoices.length, "reconciledStatus=", selectedDetailsTxn?.reconciledStatus);
      if (!detailsDialogOpen || !selectedDetailsTxn || !selectedTxnIsSepa || !selectedSepaBatch) {
        setDialogSepaSuggestions({});
        setDialogSepaCombinations({});
        setBatchLevelCombinations([]);
        return;
      }
      if (!realInvoices.length) {
        setDialogSepaSuggestions({});
        setDialogSepaCombinations({});
        setBatchLevelCombinations([]);
        return;
      }

      // Instant render path from prefetch cache (first SEPA line).
      const prefetched = sepaFirstOpCacheByTxn[selectedDetailsTxn.id];
      if (prefetched) {
        setDialogSepaSuggestions({ [prefetched.opId]: prefetched.suggestions });
        setDialogSepaCombinations({ [prefetched.opId]: prefetched.combinations });
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

        const fetchSepaOpSuggestions = async (op: any) => {
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
              sepaContext: true,
              counterpartyName: op.creditorName,
              reconciledStatus: "non_rapproché",
              matchedInvoiceIds: [],
              pendingInvoiceIds: [],
            };

            // Envoyer toutes les factures au backend — le filtrage par devise/statut/date se fait côté serveur
            const candidates = realInvoices;

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
            const rawCombos: SepaCombination[] = Array.isArray(data?.combinations)
              ? (data.combinations as any[]).map((c) => ({
                  invoiceIds: Array.isArray(c.invoiceIds) ? c.invoiceIds.map(String) : [],
                  invoices: Array.isArray(c.invoices) ? c.invoices : [],
                  totalAmount: Number(c.totalAmount || 0),
                  diff: Number(c.diff || 0),
                  score: Number(c.score || 0),
                  reason: String(c.reason || ""),
                  matchType: (c.matchType === "supplier" || c.matchType === "amount") ? c.matchType : "amount",
                }))
              : [];
            const fallbackCombos =
              rawCombos.length === 0
                ? buildSupplierFallbackCombo(opAmountAbs, op.creditorName || "", candidates)
                : [];
            const finalCombos = rawCombos.length > 0 ? rawCombos : fallbackCombos;

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
                const creditorName = String(op.creditorName || "");
                const hasRefHit = invoiceNo.length >= 4 && labelRef.includes(invoiceNo);
                const hasVendorHit =
                  vendor.length >= 4 &&
                  (labelRef.includes(vendor) ||
                    vendor.split(/\s+/).some((w) => w.length >= 4 && labelRef.includes(w)));
                const hasCreditorSupplierHit = supplierNameLooksSame(creditorName, invoice.vendorCustomer || "");
                const amountLooksPlausible = amountRatio <= 0.15;
                const strongAmountMatch = amountRatio <= 0.03;

                // Guardrails: down-weight AI score when amount is not plausible.
                let score = aiScore;
                if (amountRatio > 0.8) score -= 70;
                else if (amountRatio > 0.5) score -= 45;
                else if (amountRatio > 0.25) score -= 25;
                if (hasRefHit) score += 12;
                if (hasVendorHit) score += 8;
                if (hasCreditorSupplierHit) score += 18;
                score = Math.max(0, Math.min(100, Math.round(score)));

                // Hard business filter for SEPA line suggestions:
                // keep only candidates with at least one strong signal:
                //  - reference hit, OR
                //  - creditor name matches supplier, OR
                //  - very close amount.
                // This removes "n'importe quoi" suggestions.
                const passesBusinessGate =
                  hasRefHit || hasCreditorSupplierHit || strongAmountMatch;
                if (!passesBusinessGate) return null;

                // If creditor/supplier does not match, require very plausible amount.
                if (!hasCreditorSupplierHit && !hasRefHit && !amountLooksPlausible) return null;

                const reasons = [];
                if (Array.isArray(srv?.signals)) reasons.push(...srv.signals);
                if (srv?.reason) reasons.push(String(srv.reason));
                reasons.unshift(`Écart montant ligne: ${formatMoney(amountDiff, invoice.currency ?? pseudoTxn.currency)}`);
                if (hasRefHit) reasons.unshift("Référence exacte détectée");
                if (hasVendorHit) reasons.unshift("Tiers cohérent");
                if (hasCreditorSupplierHit) reasons.unshift("Créancier SEPA cohérent avec le fournisseur");
                return {
                  invoice,
                  score,
                  details: getMatchDetails(pseudoTxn as any, invoice),
                  reasons: reasons.length ? reasons : buildCandidateReasons(pseudoTxn as any, invoice, score),
                } as SepaOperationCandidate;
              })
              .filter((x): x is SepaOperationCandidate => Boolean(x))
              .filter((x) => x.score >= 35)
              .sort((a, b) => b.score - a.score)
              .slice(0, 5);

            return [op.id, enriched, finalCombos] as const;
          };

        const operations = selectedSepaBatch.operations || [];
        if (operations.length === 0) {
          setDialogSepaSuggestions({});
          setDialogSepaCombinations({});
          return;
        }

        // Instant UX: compute current line first, render immediately,
        // then hydrate remaining lines in background.
        const firstIndex = Math.min(sepaCurrentOperationIndex, operations.length - 1);
        const firstOp = operations[firstIndex];
        const firstEntry = await fetchSepaOpSuggestions(firstOp);

        setDialogSepaCombinations({ [firstEntry[0]]: firstEntry[2] });
        setDialogSepaSuggestions({ [firstEntry[0]]: firstEntry[1].slice(0, 5) });
        if (operations.length === 1) {
          // For single-line SEPA (like 49k case), show global block immediately
          // from first available combos, then refine with batch request later.
          setBatchLevelCombinations(firstEntry[2]);
        }

        const remainingOps = operations.filter((op) => op.id !== firstOp.id);
        void (async () => {
          try {
            const restEntries = await Promise.all(remainingOps.map((op) => fetchSepaOpSuggestions(op)));
            setDialogSepaCombinations((prev) => {
              const next = { ...prev };
              restEntries.forEach(([opId, , combos]) => {
                next[opId] = combos;
              });
              return next;
            });
            setDialogSepaSuggestions((prev) => {
              const next = { ...prev };
              restEntries.forEach(([opId, suggestions]) => {
                next[opId] = suggestions.slice(0, 5);
              });
              return next;
            });
          } catch {
            // keep first-line instant render even if background hydration fails
          }
        })();

        // ── Recherche au niveau du lot entier (CtrlSum) ──────────────────────
        // IMPORTANT: activée uniquement pour les SEPA à ligne unique.
        // Pour les lots multi-lignes, le rapprochement doit rester strictement ligne par ligne.

        // Calculer le total du lot : préférer totalAmount, sinon sommer les opérations
        const batchTotalAbs =
          Math.abs(Number(selectedSepaBatch.totalAmount || 0)) ||
          selectedSepaBatch.operations.reduce((s, op) => s + Math.abs(Number(op.amount || 0)), 0);

        // Déduire le(s) nom(s) de créancier depuis les opérations
        const uniqueCreditors = [...new Set(
          selectedSepaBatch.operations.map((op) => op.creditorName).filter(Boolean)
        )];
        // Pour lot à 1 créancier → utiliser ce nom directement
        // Pour lot à N créanciers → laisser le backend chercher par montant
        const batchCounterpartyName = uniqueCreditors.length === 1
          ? uniqueCreditors[0]
          : uniqueCreditors.join(" ");

        const isSingleLineSepa = selectedSepaBatch.operations.length === 1;
        if (batchTotalAbs > 0 && isSingleLineSepa) {
          try {
            const batchTxn = {
              id: `batch::${selectedDetailsTxn.id}`,
              amount: -batchTotalAbs,
              txnDate: selectedDetailsTxn.txnDate,
              currency: selectedDetailsTxn.currency || "EUR",
              sepaContext: true,
              counterpartyName: batchCounterpartyName,
              label: `Lot SEPA ${selectedSepaBatch.label || selectedDetailsTxn.reference || ""} ${batchCounterpartyName}`,
            };
            const batchRes = await fetch("/api/reconciliation/score", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transaction: batchTxn, invoices: realInvoices }),
            });
            const batchData = await batchRes.json().catch(() => ({}));
            console.log("[SEPA-BATCH] batchTotalAbs=", batchTotalAbs, "creditor=", batchCounterpartyName, "combos=", batchData?.combinations?.length, "firstCombo=", batchData?.combinations?.[0]);
            const rawBatchCombos: SepaCombination[] = Array.isArray(batchData?.combinations)
              ? (batchData.combinations as any[]).map((c) => ({
                  invoiceIds: Array.isArray(c.invoiceIds) ? c.invoiceIds.map(String) : [],
                  invoices: Array.isArray(c.invoices) ? c.invoices : [],
                  totalAmount: Number(c.totalAmount || 0),
                  diff: Number(c.diff || 0),
                  score: Number(c.score || 0),
                  reason: String(c.reason || ""),
                  matchType: (c.matchType === "supplier" || c.matchType === "amount") ? c.matchType as "supplier" | "amount" : "amount",
                }))
              : [];
            const batchFallbackCombos =
              rawBatchCombos.length === 0 && uniqueCreditors.length === 1
                ? buildSupplierFallbackCombo(batchTotalAbs, uniqueCreditors[0], realInvoices)
                : [];
            setBatchLevelCombinations(rawBatchCombos.length > 0 ? rawBatchCombos : batchFallbackCombos);
            // Les combos de lot sont simplement affichés — l'utilisateur confirme manuellement.
          } catch {
            setBatchLevelCombinations([]);
          }
        } else {
          setBatchLevelCombinations([]);
        }
      } finally {
        setDialogSepaLoading(false);
      }
    };

    void loadDialogSepaSuggestions();
  }, [detailsDialogOpen, selectedDetailsTxn, selectedSepaBatch, realInvoices, selectedTxnIsSepa]);

  // Auto-reconcile SEPA lines when top suggestion score >= threshold (95%).
  useEffect(() => {
    if (!selectedDetailsTxn || !selectedTxnIsSepa || !selectedSepaBatch) return;
    if (selectedDetailsTxn.reconciledStatus === "rapproché") return;
    if (dialogSepaLoading) return;
    const hasSuggestions = Object.keys(dialogSepaSuggestions).length > 0;
    const hasCombinations = Object.keys(dialogSepaCombinations).length > 0;
    if (!hasSuggestions && !hasCombinations) return;

    const updates: Record<string, SepaOperationDecision> = { ...sepaLineDecisions };
    const autoAppliedLines: { opId: string; invoiceIds: string[]; score: number }[] = [];

    selectedSepaBatch.operations.forEach((op) => {
      const autoKey = `sepa::${selectedDetailsTxn.id}::${op.id}`;
      if (autoReconciledRef.current.has(autoKey)) return;
      const current = updates[op.id];
      if (current?.status === "approved") return;
      if (current?.rejectAllSuggestions) return;

      // Priorité : combinaison à score ≥ 95
      const topCombo = (dialogSepaCombinations[op.id] || []).find((c) => c.score >= AUTO_RECONCILE_THRESHOLD);
      if (topCombo) {
        autoReconciledRef.current.add(autoKey);
        updates[op.id] = {
          ...(current ?? { status: "pending", selectedInvoiceIds: [], rejectAllSuggestions: false }),
          status: "approved",
          selectedInvoiceIds: topCombo.invoiceIds,
          rejectAllSuggestions: false,
        };
        autoAppliedLines.push({ opId: op.id, invoiceIds: topCombo.invoiceIds, score: topCombo.score });
        return;
      }

      // Sinon : suggestion individuelle à score ≥ 95
      const top = (dialogSepaSuggestions[op.id] || [])[0];
      if (!top || top.score < AUTO_RECONCILE_THRESHOLD) return;
      autoReconciledRef.current.add(autoKey);
      updates[op.id] = {
        ...(current ?? { status: "pending", selectedInvoiceIds: [], rejectAllSuggestions: false }),
        status: "approved",
        selectedInvoiceIds: [top.invoice.id],
        rejectAllSuggestions: false,
      };
      autoAppliedLines.push({ opId: op.id, invoiceIds: [top.invoice.id], score: top.score });
    });

    if (!autoAppliedLines.length) return;

    setSepaLineDecisions(updates);

    setSepaBatchesByReference((prev) => {
      const currentBatch = prev[selectedSepaBatch.id];
      if (!currentBatch) return prev;
      const nextOps = currentBatch.operations.map((op) => {
        const d = updates[op.id];
        if (d?.status !== "approved" || !d.selectedInvoiceIds?.length) return op;
        return { ...op, linkedInvoiceIds: [...d.selectedInvoiceIds] };
      });
      return {
        ...prev,
        [selectedSepaBatch.id]: { ...currentBatch, operations: nextOps },
      };
    });

    const operations = selectedSepaBatch.operations;
    const allApproved =
      operations.length > 0 &&
      operations.every((op) => updates[op.id]?.status === "approved");
    const allMatched = Array.from(
      new Set(
        operations.flatMap((op) => {
          const d = updates[op.id];
          return d?.status === "approved" ? d.selectedInvoiceIds : [];
        })
      )
    );
    const nextTxnStatus: "rapproché" | "non_rapproché" = allApproved
      ? "rapproché"
      : "non_rapproché";
    const previousMatched = selectedDetailsTxn.matchedInvoiceIds ?? [];

    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === selectedDetailsTxn.id
          ? {
              ...txn,
              reconciledStatus: nextTxnStatus,
              matchedInvoiceIds: allMatched,
              sepaLineDecisions: updates,
            }
          : txn
      )
    );

    void persistTxnReconciliation(selectedDetailsTxn.id, {
      reconciledStatus: nextTxnStatus,
      matchedInvoiceIds: allMatched,
      sepaLineDecisions: updates,
    });

    const added = allMatched.filter((id) => !previousMatched.includes(id));
    const removed = previousMatched.filter((id) => !allMatched.includes(id));
    if (added.length || removed.length) {
      void syncInvoicesStatusFromTxn(added, removed);
    }

    const topScore = autoAppliedLines[0]?.score ?? AUTO_RECONCILE_THRESHOLD;
    const totalLinked = autoAppliedLines.reduce((s, l) => s + l.invoiceIds.length, 0);
    toast?.success?.(
      allApproved
        ? `Lot SEPA rapproché automatiquement (${totalLinked} facture(s) liées, match ≥ ${AUTO_RECONCILE_THRESHOLD}%)`
        : `${autoAppliedLines.length} ligne(s) SEPA auto-rapprochée(s) (≥ ${topScore}%)`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogSepaSuggestions, dialogSepaLoading, selectedDetailsTxn, selectedSepaBatch, selectedTxnIsSepa]);

  // Auto-reconcile non-SEPA transactions when top suggestion score >= threshold.
  useEffect(() => {
    if (!selectedDetailsTxn || selectedTxnIsSepa) return;
    if (selectedDetailsTxn.reconciledStatus === "rapproché") return;
    const autoKey = `txn::${selectedDetailsTxn.id}`;
    if (autoReconciledRef.current.has(autoKey)) return;
    const top = manualSuggestions[0];
    if (!top || top.score < AUTO_RECONCILE_THRESHOLD) return;
    autoReconciledRef.current.add(autoKey);

    const previousMatched = selectedDetailsTxn.matchedInvoiceIds ?? [];
    const nextMatched = [top.invoice.id];

    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === selectedDetailsTxn.id
          ? {
              ...txn,
              reconciledStatus: "rapproché",
              matchedInvoiceIds: nextMatched,
              pendingInvoiceIds: [],
            }
          : txn
      )
    );

    void persistTxnReconciliation(selectedDetailsTxn.id, {
      reconciledStatus: "rapproché",
      matchedInvoiceIds: nextMatched,
      pendingInvoiceIds: [],
    });

    const added = nextMatched.filter((id) => !previousMatched.includes(id));
    const removed = previousMatched.filter((id) => !nextMatched.includes(id));
    if (added.length || removed.length) {
      void syncInvoicesStatusFromTxn(added, removed);
    }
    toast?.success?.(`Rapprochement automatique (match ${top.score}%).`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualSuggestions, selectedDetailsTxn, selectedTxnIsSepa]);

  const sepaOperations = selectedSepaBatch?.operations ?? [];
  const sepaCurrentOperation = sepaOperations[sepaCurrentOperationIndex] ?? null;
  const sepaCurrentDecision = sepaCurrentOperation
    ? sepaLineDecisions[sepaCurrentOperation.id] ?? {
        status: "pending",
        selectedInvoiceIds: [],
        rejectAllSuggestions: false,
      }
    : null;
  // Never hard-lock SEPA lines in the reconciliation view:
  // users must always be able to adjust/manual edit when opening this workflow.
  const sepaCurrentIsLocked = false;

  const sepaCurrentCandidates = useMemo(() => {
    if (!sepaCurrentOperation) return [] as SepaOperationCandidate[];
    const ranked = dialogSepaSuggestions[sepaCurrentOperation.id] || [];
    if (!sepaCurrentDecision?.selectedInvoiceIds?.length) return ranked;

    const existing = new Set(ranked.map((c) => c.invoice.id));
    const selectedExtras = sepaCurrentDecision.selectedInvoiceIds
      .map((id) => realInvoices.find((inv) => inv.id === id))
      .filter(Boolean)
      .filter((inv) => !existing.has(inv!.id))
      .map((invoice) => {
        const opAmountAbs = Math.abs(Number(sepaCurrentOperation.amount || 0));
        const invAmount = Math.abs(Number(invoice!.amountGross || 0));
        const amountDiff = Math.abs(opAmountAbs - invAmount);
        const sameSupplier = supplierNameLooksSame(
          sepaCurrentOperation.creditorName || "",
          invoice!.vendorCustomer || ""
        );
        let manualScore = amountDiff <= 1 ? 100 : amountDiff <= 5 ? 95 : amountDiff <= 20 ? 85 : 70;
        if (sameSupplier) manualScore = Math.min(100, manualScore + 5);

        return {
          invoice: invoice!,
          score: manualScore,
          details: {
            amountDiff,
            daysDiffInvoice: 0,
            daysDiffDue: 0,
            directionMatch: true,
            isPartial: false,
            partialPercent: 0,
            remaining: 0,
          },
          reasons: ["Facture déjà sélectionnée manuellement"],
        } as SepaOperationCandidate;
      });

    return [...ranked, ...selectedExtras];
  }, [
    dialogSepaSuggestions,
    sepaCurrentDecision,
    sepaCurrentOperation,
    realInvoices,
  ]);

  const effectiveGlobalCombos = useMemo(() => {
    if (!selectedSepaBatch || selectedSepaBatch.operations.length !== 1) return [] as SepaCombination[];
    if (batchLevelCombinations.length > 0) return batchLevelCombinations;
    const op = selectedSepaBatch.operations[0];
    return dialogSepaCombinations[op.id] || [];
  }, [selectedSepaBatch, batchLevelCombinations, dialogSepaCombinations]);

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

  const commitSepaLineEdit = (operationId: string) => {
    if (!selectedDetailsTxn || !selectedSepaBatch) return;
    const decision = sepaLineDecisions[operationId];
    if (!decision) return;

    const markAsNoMatch = Boolean(decision.rejectAllSuggestions);
    if (!markAsNoMatch && !(decision.selectedInvoiceIds?.length > 0)) {
      toast?.error?.(
        "Sélectionne une facture ou coche « Aucune facture correspondante »."
      );
      return;
    }

    const nextDecisions: Record<string, SepaOperationDecision> = {
      ...sepaLineDecisions,
      [operationId]: markAsNoMatch
        ? {
            status: "review",
            selectedInvoiceIds: [],
            rejectAllSuggestions: true,
            reviewNote: "En attente de la facture correspondante",
          }
        : {
            ...decision,
            status: "approved",
            rejectAllSuggestions: false,
          },
    };

    const operations = selectedSepaBatch.operations;
    const allMatched = Array.from(
      new Set(
        operations.flatMap((op) => {
          const d = nextDecisions[op.id];
          return d?.status === "approved" ? d.selectedInvoiceIds : [];
        })
      )
    );
    const allApproved =
      operations.length > 0 &&
      operations.every((op) => nextDecisions[op.id]?.status === "approved");
    const nextTxnStatus: "rapproché" | "non_rapproché" = allApproved
      ? "rapproché"
      : "non_rapproché";

    const previousMatched = selectedDetailsTxn.matchedInvoiceIds ?? [];

    setSepaBatchesByReference((prev) => {
      const currentBatch = prev[selectedSepaBatch.id];
      if (!currentBatch) return prev;
      const nextOps = currentBatch.operations.map((op) => {
        if (op.id !== operationId) return op;
        return {
          ...op,
          linkedInvoiceIds: markAsNoMatch ? [] : [...decision.selectedInvoiceIds],
        };
      });
      return {
        ...prev,
        [selectedSepaBatch.id]: { ...currentBatch, operations: nextOps },
      };
    });

    setSepaLineDecisions(nextDecisions);

    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === selectedDetailsTxn.id
          ? {
              ...txn,
              matchedInvoiceIds: allMatched,
              reconciledStatus: nextTxnStatus,
              sepaLineDecisions: nextDecisions,
              unreconciledComment: markAsNoMatch
                ? [
                    txn.unreconciledComment || "",
                    `${operations.find((op) => op.id === operationId)?.creditorName || "Sous-opération"} : en attente de la facture correspondante`,
                  ]
                    .filter(Boolean)
                    .join(" | ")
                : txn.unreconciledComment,
            }
          : txn
      )
    );

    void persistTxnReconciliation(selectedDetailsTxn.id, {
      reconciledStatus: nextTxnStatus,
      matchedInvoiceIds: allMatched,
      sepaLineDecisions: nextDecisions,
    });

    const added = allMatched.filter((id) => !previousMatched.includes(id));
    const removed = previousMatched.filter((id) => !allMatched.includes(id));
    if (added.length || removed.length) {
      void syncInvoicesStatusFromTxn(added, removed);
    }

    setSepaEditModeByOperation((prev) => ({ ...prev, [operationId]: false }));
    toast?.success?.(
      markAsNoMatch
        ? "Ligne marquée : aucune facture correspondante. La ligne sera rapprochée quand la facture arrivera."
        : "Rapprochement modifié pour cette sous-opération."
    );
  };

  const cancelSepaLineEdit = (operationId: string) => {
    const op = selectedSepaBatch?.operations.find((o) => o.id === operationId);
    if (op) {
      setSepaLineDecisions((prev) => ({
        ...prev,
        [operationId]: {
          status: "approved",
          selectedInvoiceIds: [...(op.linkedInvoiceIds || [])],
          rejectAllSuggestions: false,
        },
      }));
    }
    setSepaEditModeByOperation((prev) => ({ ...prev, [operationId]: false }));
  };

  const validateCurrentSepaOperation = (status: Exclude<SepaOperationDecisionStatus, "pending">) => {
    if (!sepaCurrentOperation) return;
    if (status === "approved" && !(sepaCurrentDecision?.selectedInvoiceIds?.length)) {
      toast?.error?.("Sélectionne une facture avant de valider la ligne en rapprochée.");
      return;
    }
    let nextDecisionsSnapshot: Record<string, SepaOperationDecision> | null = null;
    setSepaLineDecisions((prev) => {
      const current = prev[sepaCurrentOperation.id] ?? {
        status: "pending",
        selectedInvoiceIds: [],
        rejectAllSuggestions: false,
      };
      const next = {
        ...prev,
        [sepaCurrentOperation.id]: {
          ...current,
          status,
        },
      };
      nextDecisionsSnapshot = next;
      return next;
    });

    if (selectedDetailsTxn && nextDecisionsSnapshot) {
      void persistTxnReconciliation(selectedDetailsTxn.id, {
        sepaLineDecisions: nextDecisionsSnapshot,
      });
    }
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

      // Keep linked invoices on SEPA lines in sync with current decisions for display.
      setSepaBatchesByReference((prev) => {
        const currentBatch = prev[selectedSepaBatch.id];
        if (!currentBatch) return prev;
        const nextOps = currentBatch.operations.map((op) => {
          const decision = sepaLineDecisions[op.id];
          const selectedIds = decision?.selectedInvoiceIds ?? [];
          return {
            ...op,
            linkedInvoiceIds: selectedIds.length > 0 ? selectedIds : (op.linkedInvoiceIds || []),
          };
        });
        return {
          ...prev,
          [selectedSepaBatch.id]: {
            ...currentBatch,
            operations: nextOps,
          },
        };
      });

      setTransactions((prev) =>
        prev.map((txn) =>
          txn.id === selectedDetailsTxn.id
            ? {
                ...txn,
                // Mark transaction as fully reconciled only if every SEPA line is approved.
                reconciledStatus: allApproved ? "rapproché" : "non_rapproché",
                matchedInvoiceIds: allApproved ? selectedInvoiceIds : [],
                pendingInvoiceIds: allApproved ? [] : selectedInvoiceIds,
                sepaLineDecisions,
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
        sepaLineDecisions,
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
    const currentRef = current?.reference;

    if (currentRef && sepaBatchesByReference[currentRef]) {
      setSepaBatchesByReference((prev) => {
        const batch = prev[currentRef];
        if (!batch) return prev;
        return {
          ...prev,
          [currentRef]: {
            ...batch,
            operations: batch.operations.map((op) => ({
              ...op,
              linkedInvoiceIds: [],
            })),
          },
        };
      });
      setSepaLineDecisions({});
    }

    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === txnId
          ? {
              ...txn,
              reconciledStatus: "non_rapproché",
              pendingInvoiceIds: txn.matchedInvoiceIds ?? [],
              matchedInvoiceIds: [],
              sepaLineDecisions: {},
            }
          : txn,
      ),
    );
    void persistTxnReconciliation(txnId, {
      reconciledStatus: "non_rapproché",
      matchedInvoiceIds: [],
      pendingInvoiceIds: [],
      sepaLineDecisions: {},
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
                      const hasSuggestion = Boolean(aiSuggestionAvailableByTxn[txn.id]);

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
                                {hasSuggestion ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleSuggestionBadgeClick(txn)}
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
                                    title="Suggestions de rapprochement disponibles"
                                  >
                                    Suggestion dispo
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
                                  const invoice = resolveInvoicesByIds([invoiceId])[0];
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

          <div id="reconciliation-editor" className="space-y-6 xl:sticky xl:top-6 xl:self-start">

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

            {false ? (
              <SectionCard title="Traitement SEPA" subtitle="">
                <></>
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

                  {/* ── Rapprochement global du lot (CtrlSum) ── */}
                  {selectedSepaBatch.operations.length === 1 &&
                    effectiveGlobalCombos.length > 0 &&
                    selectedDetailsTxn?.reconciledStatus !== "rapproché" && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
                          Rapprochement global
                        </span>
                        <p className="text-xs font-medium text-amber-900">
                          Des factures correspondent au total du lot ({formatMoney(selectedSepaBatch.totalAmount ?? 0, "EUR")})
                        </p>
                      </div>
                      {effectiveGlobalCombos.map((combo, ci) => {
                        const allSelected = combo.invoiceIds.every((id) =>
                          Object.values(sepaLineDecisions).some((d) => d.selectedInvoiceIds.includes(id))
                        );
                        return (
                          <div
                            key={`batch-combo-${ci}`}
                            className={`rounded-xl border p-3 ${allSelected ? "border-emerald-300 bg-emerald-50" : "border-amber-200 bg-white"}`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full px-2 py-1 text-xs font-bold ring-1 ${
                                  combo.score >= 95 ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                                  : "bg-amber-100 text-amber-800 ring-amber-200"
                                }`}>
                                  {combo.score}%
                                </span>
                                {combo.matchType === "supplier" && (
                                  <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200">
                                    Fournisseur identifié
                                  </span>
                                )}
                                <span className="text-xs text-slate-600">{combo.reason}</span>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant={allSelected ? "default" : "outline"}
                                className="shrink-0"
                                onClick={() => {
                                  // Appliquer ce combo à toutes les lignes SEPA
                                  const batchUpdates: Record<string, SepaOperationDecision> = {};
                                  selectedSepaBatch.operations.forEach((op) => {
                                    batchUpdates[op.id] = {
                                      status: "approved",
                                      selectedInvoiceIds: combo.invoiceIds,
                                      rejectAllSuggestions: false,
                                    };
                                  });
                                  setSepaLineDecisions(batchUpdates);
                                  const allMatchedIds = [...new Set(combo.invoiceIds)];
                                  void persistTxnReconciliation(selectedDetailsTxn!.id, {
                                    reconciledStatus: "rapproché",
                                    matchedInvoiceIds: allMatchedIds,
                                    sepaLineDecisions: batchUpdates,
                                  });
                                  void syncInvoicesStatusFromTxn(allMatchedIds, []);
                                  setTransactions((prev) =>
                                    prev.map((txn) =>
                                      txn.id === selectedDetailsTxn!.id
                                        ? { ...txn, reconciledStatus: "rapproché", matchedInvoiceIds: allMatchedIds, sepaLineDecisions: batchUpdates }
                                        : txn
                                    )
                                  );
                                  toast?.success?.(`Lot rapproché — ${combo.invoiceIds.length} facture(s)`);
                                }}
                              >
                                {allSelected ? "Appliqué" : "Rapprocher le lot"}
                              </Button>
                            </div>
                            <div className="space-y-1">
                              {combo.invoices.map((inv) => (
                                <div key={inv.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-sm">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-800">{inv.invoiceNumber}</span>
                                    <span className="text-slate-500">{inv.vendorCustomer}</span>
                                  </div>
                                  <span className="font-mono text-xs font-semibold text-slate-700">
                                    {formatMoney(inv.amountGross, "EUR")}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {combo.invoices.length > 1 && (
                              <div className="mt-2 flex justify-end">
                                <span className="text-xs font-semibold text-slate-600">
                                  Total : {formatMoney(combo.totalAmount, "EUR")}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

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
                                const inv = resolveInvoicesByIds([invoiceId])[0];
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
                        ) : (
                          <>
                          {/* Combinations block */}
                          {(dialogSepaCombinations[sepaCurrentOperation.id] ?? []).length > 0 && (
                            <div className="mb-4 space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 mb-2">
                                Suggestions de rapprochement
                              </p>
                              {(dialogSepaCombinations[sepaCurrentOperation.id] ?? []).map((combo, ci) => {
                                const allChecked = combo.invoiceIds.every((id) =>
                                  sepaCurrentDecision?.selectedInvoiceIds.includes(id)
                                );
                                const isSupplierMatch = combo.reason.includes("Fournisseur SEPA");
                                const scoreColor =
                                  combo.score >= 95 ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                                  : combo.score >= 80 ? "bg-sky-100 text-sky-800 ring-sky-200"
                                  : "bg-violet-100 text-violet-800 ring-violet-200";
                                const borderColor =
                                  allChecked ? "border-emerald-300 bg-emerald-50/40"
                                  : isSupplierMatch ? "border-sky-200 bg-sky-50/30"
                                  : "border-slate-200 bg-white";
                                return (
                                  <div
                                    key={`combo-${ci}`}
                                    className={`rounded-2xl border p-4 ${borderColor}`}
                                  >
                                    <div className="flex items-start justify-between gap-2 mb-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${scoreColor}`}>
                                          {combo.score}%
                                        </span>
                                        {isSupplierMatch && (
                                          <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200">
                                            Fournisseur SEPA
                                          </span>
                                        )}
                                        <span className="text-xs text-slate-500 leading-tight">{combo.reason}</span>
                                      </div>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={allChecked ? "default" : "outline"}
                                        className="shrink-0"
                                        onClick={() => {
                                          // Si pas encore tout sélectionné, on sélectionne tout ; sinon on déselectionne
                                          if (allChecked) {
                                            combo.invoiceIds.forEach((id) => {
                                              if (sepaCurrentDecision?.selectedInvoiceIds.includes(id)) {
                                                toggleSepaInvoice(sepaCurrentOperation.id, id);
                                              }
                                            });
                                          } else {
                                            combo.invoiceIds.forEach((id) => {
                                              if (!sepaCurrentDecision?.selectedInvoiceIds.includes(id)) {
                                                toggleSepaInvoice(sepaCurrentOperation.id, id);
                                              }
                                            });
                                          }
                                        }}
                                      >
                                        {allChecked ? "Désélectionner" : "Sélectionner tout"}
                                      </Button>
                                    </div>
                                    <div className="space-y-1">
                                      {combo.invoices.map((inv) => {
                                        const checked = sepaCurrentDecision?.selectedInvoiceIds.includes(inv.id) ?? false;
                                        return (
                                          <label
                                            key={inv.id}
                                            className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
                                              checked ? "border-emerald-200 bg-emerald-50" : "border-slate-100 bg-white hover:bg-slate-50"
                                            }`}
                                          >
                                            <div className="flex items-center gap-2">
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleSepaInvoice(sepaCurrentOperation.id, inv.id)}
                                                className="accent-emerald-600"
                                              />
                                              <span className="font-medium text-slate-800">{inv.invoiceNumber}</span>
                                              <span className="text-slate-500">{inv.vendorCustomer}</span>
                                            </div>
                                            <span className="text-slate-700 font-mono text-xs font-semibold">
                                              {formatMoney(inv.amountGross, sepaCurrentOperation.currency)}
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                    {combo.invoices.length > 1 && (
                                      <div className="mt-2 flex justify-end">
                                        <span className="text-xs font-semibold text-slate-600">
                                          Total : {formatMoney(combo.totalAmount, sepaCurrentOperation.currency)}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {/* Individual suggestions (only if no combinations or extra matches) */}
                          {sepaCurrentCandidates.length === 0 && (dialogSepaCombinations[sepaCurrentOperation.id] ?? []).length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                              Aucune suggestion pour cette sous-opération.
                            </div>
                          ) :                           sepaCurrentCandidates.map((candidate) => {
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
                          })}
                          </>
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
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selectedDetailsTxn.reconciledStatus} />
                    {selectedDetailsTxn.reconciledStatus === "rapproché" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUnreconcile(selectedDetailsTxn.id)}
                      >
                        Annuler rapprochement
                      </Button>
                    ) : null}
                  </div>
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
                {!selectedTxnIsSepa &&
                selectedDetailsTxn.reconciledStatus === "rapproché" &&
                (selectedDetailsTxn.matchedInvoiceIds?.length ?? 0) > 0 ? (
                  <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Factures liées
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {resolveInvoicesByIds(selectedDetailsTxn.matchedInvoiceIds).map((invoice) => (
                        <button
                          key={`linked-${invoice.id}`}
                          type="button"
                          onClick={() => openInvoicePdf(invoice)}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-700 hover:ring-1 hover:ring-sky-200 transition"
                          title={invoice.pdfUrl ? "Voir le PDF de la facture" : "Aucun PDF disponible"}
                        >
                          <FileSearch className="h-3 w-3" />
                          {invoice.invoiceNumber} · {invoice.vendorCustomer}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {selectedTxnIsSepa ? (
                <div className="space-y-4">
                  {selectedSepaBatch ? (
                    <>
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
                      </div>
                      {selectedDetailsTxn.reconciledStatus === "rapproché" ? (
                        <div className="space-y-3">
                          {selectedSepaBatch.operations.map((op) => {
                            const decision = sepaLineDecisions[op.id] ?? {
                              status: "pending",
                              selectedInvoiceIds: [],
                              rejectAllSuggestions: false,
                            };
                            const linkedIds = resolveSepaLinkedInvoiceIds(op, decision);
                            const linkedInvoices = resolveInvoicesByIds(linkedIds);
                            const isEditing = Boolean(sepaEditModeByOperation[op.id]);
                            const candidates = dialogSepaSuggestions[op.id] || [];
                            return (
                              <div key={op.id} className="rounded-xl border border-slate-200 p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-slate-900">{op.creditorName}</p>
                                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700 ring-1 ring-emerald-100">
                                    Rapprochée
                                  </span>
                                </div>
                                <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-500">
                                  <span>Réf: {op.endToEndId}</span>
                                  <span>Montant: {formatMoney(op.amount, op.currency)}</span>
                                </div>
                                {isEditing ? (
                                  <div className="mt-3 space-y-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
                                    <p className="text-xs font-medium text-sky-900">
                                      Modifier le rapprochement de cette ligne
                                    </p>
                                    {candidates.length === 0 ? (
                                      <p className="text-xs text-slate-500">
                                        Aucune suggestion IA disponible pour cette ligne.
                                      </p>
                                    ) : (
                                      <div className="space-y-2">
                                        {candidates.map((candidate) => {
                                          const checked =
                                            decision.selectedInvoiceIds.includes(candidate.invoice.id) ?? false;
                                          return (
                                            <div
                                              key={candidate.invoice.id}
                                              className={`rounded-xl border p-3 ${
                                                checked
                                                  ? "border-sky-300 bg-sky-50"
                                                  : "border-slate-200 bg-white"
                                              }`}
                                            >
                                              <label className="flex cursor-pointer items-start gap-2">
                                                <input
                                                  type="checkbox"
                                                  className="mt-1"
                                                  checked={checked}
                                                  onChange={() =>
                                                    toggleSepaInvoice(op.id, candidate.invoice.id)
                                                  }
                                                />
                                                <div className="flex-1 space-y-1">
                                                  <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-sm font-semibold text-slate-900">
                                                      {candidate.invoice.invoiceNumber}
                                                    </span>
                                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-100">
                                                      {candidate.score}% score
                                                    </span>
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        openInvoicePdf(candidate.invoice);
                                                      }}
                                                      className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100"
                                                    >
                                                      <FileSearch className="h-3 w-3" />
                                                      Voir PDF
                                                    </button>
                                                  </div>
                                                  <p className="text-sm text-slate-700">
                                                    {candidate.invoice.vendorCustomer}
                                                  </p>
                                                  <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
                                                    <span>
                                                      Montant facture :{" "}
                                                      {formatMoney(
                                                        candidate.invoice.amountGross,
                                                        candidate.invoice.currency ?? op.currency
                                                      )}
                                                    </span>
                                                    <span>
                                                      Écart :{" "}
                                                      {formatMoney(
                                                        candidate.details.amountDiff,
                                                        candidate.invoice.currency ?? op.currency
                                                      )}
                                                    </span>
                                                    {Number.isFinite(candidate.details.daysDiffInvoice) ? (
                                                      <span>Δ jours : {candidate.details.daysDiffInvoice}</span>
                                                    ) : null}
                                                    <span>
                                                      Sens :{" "}
                                                      {candidate.details.directionMatch ? "cohérent" : "incohérent"}
                                                    </span>
                                                  </div>
                                                  {candidate.reasons.length ? (
                                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                                      {candidate.reasons.map((reason, idx) => (
                                                        <span
                                                          key={`${op.id}-${candidate.invoice.id}-r-${idx}`}
                                                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                                                        >
                                                          {reason}
                                                        </span>
                                                      ))}
                                                    </div>
                                                  ) : null}
                                                </div>
                                              </label>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                    <label className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(decision.rejectAllSuggestions)}
                                        onChange={(e) => {
                                          const checked = e.target.checked;
                                          updateSepaDecision(op.id, (current) => ({
                                            ...current,
                                            rejectAllSuggestions: checked,
                                            selectedInvoiceIds: checked ? [] : current.selectedInvoiceIds,
                                          }));
                                        }}
                                      />
                                      Aucune facture correspondante — laisser la ligne en attente
                                    </label>
                                    <div className="flex flex-wrap justify-end gap-2">
                                      <Button variant="outline" size="sm" onClick={() => cancelSepaLineEdit(op.id)}>
                                        Annuler
                                      </Button>
                                      <Button size="sm" onClick={() => commitSepaLineEdit(op.id)}>
                                        Enregistrer la modification
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {linkedInvoices.length === 0 ? (
                                      <p className="text-xs text-slate-500">Aucune facture liée.</p>
                                    ) : (
                                      <div className="flex flex-wrap gap-2">
                                        {linkedInvoices.map((invoice) => (
                                          <button
                                            key={`${op.id}-${invoice.id}`}
                                            type="button"
                                            onClick={() => openInvoicePdf(invoice)}
                                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-700 hover:ring-1 hover:ring-sky-200 transition"
                                            title={invoice.pdfUrl ? "Voir le PDF de la facture" : "Aucun PDF disponible"}
                                          >
                                            <FileSearch className="h-3 w-3" />
                                            {invoice.invoiceNumber} · {invoice.vendorCustomer}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    <div className="mt-3 flex justify-end">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          setSepaEditModeByOperation((prev) => ({ ...prev, [op.id]: true }))
                                        }
                                      >
                                        Modifier cette sous-opération
                                      </Button>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                          <div className="flex justify-end">
                            <Button variant="outline" onClick={() => setDetailsDialogOpen(false)}>
                              Fermer
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* ── Rapprochement global du lot (CtrlSum) ── */}
                          {selectedSepaBatch.operations.length === 1 && effectiveGlobalCombos.length > 0 && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-3 mb-4">
                              <div className="flex items-center gap-2">
                                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
                                  Rapprochement global
                                </span>
                                <p className="text-xs font-medium text-amber-900">
                                  Des factures correspondent au total du lot ({formatMoney(
                                    (selectedSepaBatch.totalAmount && selectedSepaBatch.totalAmount > 0
                                      ? selectedSepaBatch.totalAmount
                                      : selectedSepaBatch.operations.reduce((s, o) => s + Math.abs(Number(o.amount || 0)), 0)),
                                    "EUR"
                                  )})
                                </p>
                              </div>
                              {effectiveGlobalCombos.map((combo, ci) => {
                                const allSelected = combo.invoiceIds.every((id) =>
                                  Object.values(sepaLineDecisions).some((d) => d.selectedInvoiceIds.includes(id))
                                );
                                return (
                                  <div
                                    key={`batch-combo-${ci}`}
                                    className={`rounded-xl border p-3 ${allSelected ? "border-emerald-300 bg-emerald-50" : "border-amber-200 bg-white"}`}
                                  >
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full px-2 py-1 text-xs font-bold ring-1 ${
                                          combo.score >= 95 ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                                          : "bg-amber-100 text-amber-800 ring-amber-200"
                                        }`}>
                                          {combo.score}%
                                        </span>
                                        {combo.matchType === "supplier" && (
                                          <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200">
                                            Fournisseur identifié
                                          </span>
                                        )}
                                        <span className="text-xs text-slate-600">{combo.reason}</span>
                                      </div>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={allSelected ? "default" : "outline"}
                                        className="shrink-0"
                                        onClick={() => {
                                          if (selectedSepaBatch.operations.length !== 1) {
                                            toast?.error?.("Le rapprochement global est réservé aux SEPA à ligne unique.");
                                            return;
                                          }
                                          const batchUpdates: Record<string, SepaOperationDecision> = {};
                                          selectedSepaBatch.operations.forEach((op) => {
                                            batchUpdates[op.id] = {
                                              status: "approved",
                                              selectedInvoiceIds: combo.invoiceIds,
                                              rejectAllSuggestions: false,
                                            };
                                          });
                                          setSepaLineDecisions(batchUpdates);
                                          const allMatchedIds = [...new Set(combo.invoiceIds)];
                                          void persistTxnReconciliation(selectedDetailsTxn!.id, {
                                            reconciledStatus: "rapproché",
                                            matchedInvoiceIds: allMatchedIds,
                                            sepaLineDecisions: batchUpdates,
                                          });
                                          void syncInvoicesStatusFromTxn(allMatchedIds, []);
                                          setTransactions((prev) =>
                                            prev.map((txn) =>
                                              txn.id === selectedDetailsTxn!.id
                                                ? { ...txn, reconciledStatus: "rapproché", matchedInvoiceIds: allMatchedIds, sepaLineDecisions: batchUpdates }
                                                : txn
                                            )
                                          );
                                          toast?.success?.(`Lot rapproché — ${combo.invoiceIds.length} facture(s)`);
                                        }}
                                      >
                                        {allSelected ? "Appliqué" : "Rapprocher le lot"}
                                      </Button>
                                    </div>
                                    <div className="space-y-1">
                                      {combo.invoices.map((inv) => (
                                        <div key={inv.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-sm">
                                          <div className="flex items-center gap-2">
                                            <span className="font-medium text-slate-800">{inv.invoiceNumber ?? inv.id}</span>
                                            <span className="text-slate-500">{inv.vendorCustomer}</span>
                                          </div>
                                          <span className="font-semibold text-slate-700">{formatMoney(inv.amountGross ?? 0, "EUR")}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <div className="space-y-2">
                            {selectedSepaBatch.operations.map((op, index) => {
                              const decision = sepaLineDecisions[op.id] ?? {
                                status: "pending",
                                selectedInvoiceIds: [],
                                rejectAllSuggestions: false,
                              };
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
                                </button>
                              );
                            })}
                          </div>

                          {sepaCurrentOperation ? (
                            <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{sepaCurrentOperation.creditorName}</p>
                                  <p className="mt-1 text-xs text-slate-500">{sepaCurrentOperation.endToEndId}</p>
                                </div>
                                <span className={`rounded-full px-2 py-1 text-xs ${getDecisionBadgeClass(sepaCurrentDecision?.status ?? "pending")}`}>
                                  {getDecisionLabel(sepaCurrentDecision?.status ?? "pending")}
                                </span>
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
                                        <label className="flex cursor-pointer items-start gap-2">
                                          <input
                                            type="checkbox"
                                            className="mt-1"
                                            checked={checked}
                                            onChange={() => toggleSepaInvoice(sepaCurrentOperation.id, candidate.invoice.id)}
                                          />
                                          <div className="flex-1 space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="text-sm font-semibold text-slate-900">
                                                {candidate.invoice.invoiceNumber}
                                              </span>
                                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-100">
                                                {candidate.score}% score
                                              </span>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  openInvoicePdf(candidate.invoice);
                                                }}
                                                className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100"
                                              >
                                                <FileSearch className="h-3 w-3" />
                                                Voir PDF
                                              </button>
                                            </div>
                                            <p className="text-sm text-slate-700">
                                              {candidate.invoice.vendorCustomer}
                                            </p>
                                            <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
                                              <span>
                                                Montant facture :{" "}
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
                                              {Number.isFinite(candidate.details.daysDiffInvoice) ? (
                                                <span>Δ jours : {candidate.details.daysDiffInvoice}</span>
                                              ) : null}
                                              <span>
                                                Sens :{" "}
                                                {candidate.details.directionMatch ? "cohérent" : "incohérent"}
                                              </span>
                                            </div>
                                            {candidate.reasons.length ? (
                                              <div className="flex flex-wrap gap-1.5 pt-1">
                                                {candidate.reasons.map((reason, idx) => (
                                                  <span
                                                    key={`${sepaCurrentOperation.id}-${candidate.invoice.id}-r-${idx}`}
                                                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                                                  >
                                                    {reason}
                                                  </span>
                                                ))}
                                              </div>
                                            ) : null}
                                          </div>
                                        </label>
                                      </div>
                                    );
                                  })
                                )}
                              </div>

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
                            </div>
                          ) : null}

                          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                            <Button variant="outline" onClick={() => setDetailsDialogOpen(false)}>
                              Fermer
                            </Button>
                            <Button type="button" onClick={handleFinalizeSepaClick}>
                              Appliquer le lot SEPA
                            </Button>
                          </div>
                        </>
                      )}
                    </>
                  ) : null}
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
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openInvoicePdf(candidate.invoice);
                                      }}
                                      className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100"
                                    >
                                      <FileSearch className="h-3 w-3" />
                                      Voir PDF
                                    </button>
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

      <Dialog
        open={Boolean(previewPdfUrl)}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewPdfUrl(null);
            setPreviewPdfTitle("");
          }
        }}
      >
        <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] p-0">
          <div className="h-full flex flex-col min-h-0">
            <DialogHeader className="px-6 pt-6 pb-2 border-b shrink-0">
              <DialogTitle className="text-lg font-semibold">
                {previewPdfTitle || "Aperçu facture"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {previewPdfUrl || ""}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0 bg-muted/20">
              {previewPdfUrl ? (
                <iframe
                  src={previewPdfUrl}
                  title={previewPdfTitle || "Facture"}
                  className="w-full h-full border-0"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  Aucun PDF à afficher
                </div>
              )}
            </div>
          </div>
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