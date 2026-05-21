import {
  useCallback, useEffect, useMemo, useRef, useState, Card,
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
  SepaBatchOperation,
} from "@/features/banque/types";

import { ReconciliationSuggestionChips } from "@/features/banque/reconciliation-suggestion-ui";
import {
  amountMatchesRange,
  AUTO_RECONCILE_THRESHOLD,
  buildCandidateReasons,
  computeMatchScore,
  enrichSepaOperationCandidate,
  isAmountDateDisplayCandidate,
  shouldDisplayBankSuggestion,
  shouldShowReconciliationSuggestion,
  SUGGESTION_MEDIUM_SCORE,
  isObviousBadBankMatch,
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
import {
  fetchEngineMatch,
  fetchStoredProposalsMap,
  requestRecalculate,
  subscribeReconciliationEvents,
  type StoredReconciliationProposal,
} from "@/features/banque/reconciliation-proposals-api";
import {
  getPayrollSlipMatchReasonsForOperation,
  type PayrollSlipIndexEntry,
} from "@/features/banque/payroll-match-reasons";
import {
  filterSepaCandidateReasons,
  getTxnReconciliationBadgeStatus,
  getTxnDisplayInvoiceIds,
  getTxnInvoiceDisplayChips,
  collectInvoiceIdsFromSepaDecisions,
  applySepaDecisionsToBatch,
  proposalPayloadFromRow,
  isInvoiceLinkedToOtherTransactions,
  findDuplicateInvoiceAssignments,
  isSepaLineResolved,
  isSepaBatchFullyResolved,
  isSepaLineInvoiceNotFound,
  getSepaLineStatusLabel,
} from "@/features/banque/reconciliation-display";

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

function Banque() {
  const [transactions, setTransactions] = useState<LocalTransaction[]>(initialTransactions);
  const [realInvoices, setRealInvoices] = useState<LocalInvoice[]>([]);
  const [sepaBatchesByReference, setSepaBatchesByReference] = useState<Record<string, SepaBatchTemplate>>({});
  const [payrollSlipsByRef, setPayrollSlipsByRef] = useState<Record<string, PayrollSlipIndexEntry>>({});
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
  const [manualInvoiceNotFound, setManualInvoiceNotFound] = useState(false);

  const [sepaLineDecisions, setSepaLineDecisions] = useState<Record<string, SepaOperationDecision>>({});
  const [sepaEditModeByOperation, setSepaEditModeByOperation] = useState<Record<string, boolean>>({});
  const [sepaCurrentOperationIndex, setSepaCurrentOperationIndex] = useState(0);
  const [linkedSepaPopupRef, setLinkedSepaPopupRef] = useState<string | null>(null);
  const [backendRecoPersistenceUnavailable, setBackendRecoPersistenceUnavailable] = useState(false);

  const isMongoObjectId = (value?: string | null) =>
    /^[a-f\d]{24}$/i.test(String(value || "").trim());

  /** Seuls les imports MongoDB sont persistés via /api/imports/:id/reconciliation */
  const canPersistToImportBackend = (sourceDocumentId?: string | null) =>
    isMongoObjectId(sourceDocumentId);

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
      const keyNorm = normalizeSepaRef(key);
      const idNorm = normalizeSepaRef(batch?.id || "");
      const opRefs = Array.isArray(batch?.operations)
        ? batch.operations.flatMap((op: any) => [
            normalizeSepaRef(op?.instrId || ""),
            normalizeSepaRef(op?.endToEndId || ""),
            normalizeSepaRef(op?.remittanceInfo || ""),
            normalizeSepaRef(op?.id || ""),
          ])
        : [];
      const strict =
        keyNorm === wanted ||
        idNorm === wanted ||
        opRefs.includes(wanted);
      const loose =
        wanted.length >= 8 &&
        (
          keyNorm.includes(wanted) ||
          wanted.includes(keyNorm) ||
          idNorm.includes(wanted) ||
          wanted.includes(idNorm) ||
          opRefs.some((r) => r && (r.includes(wanted) || wanted.includes(r)))
        );
      if (strict || loose) {
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

  const txnLooksSepaRelated = (txn: LocalTransaction) => {
    const hay = `${txn.label || ""} ${txn.reference || ""} ${(txn as { bankOperationType?: string }).bankOperationType || ""}`.toLowerCase();
    return (
      txn.paymentMethod === "SEPA" ||
      /\bsepa\b|\brem\s+vir\s+sepa\b|\bvir\.?\s*[eé]mis\b|\bpain\.001\b/i.test(hay)
    );
  };

  const findSepaBatchForTransaction = (txn: LocalTransaction | null | undefined): SepaBatchTemplate | null => {
    if (!txn) return null;
    const refCandidates: string[] = [];
    const push = (v?: string | null) => {
      const s = String(v || "").trim();
      if (s && !refCandidates.includes(s)) refCandidates.push(s);
    };
    push(txn.reference);
    const m = txn.bankMeta;
    push(m?.reference);
    push(m?.remittanceRef);
    push(m?.mandate);
    push(m?.orgId);
    push(m?.info);
    for (const s of refCandidates) {
      const hit = findSepaBatchByReference(s);
      if (hit) return hit;
    }
    const viaLabel = findSepaBatchByReference(txn.label || "");
    if (viaLabel) return viaLabel;

    if (!txnLooksSepaRelated(txn)) return null;

    const amt = Math.round(Math.abs(Number(txn.amount || 0)) * 100) / 100;
    if (!amt) return null;

    const amountMatchesBatch = (batch: SepaBatchTemplate) => {
      const batchTotal = Math.round(Math.abs(Number(batch.totalAmount || 0)) * 100) / 100;
      const sumOps = Math.round(
        Math.abs((batch.operations || []).reduce((s, op) => s + Number(op.amount || 0), 0)) * 100
      ) / 100;
      return Math.abs(batchTotal - amt) <= 0.02 || Math.abs(sumOps - amt) <= 0.02;
    };

    const candidates = Object.values(sepaBatchesByReference).filter((batch) => {
      if (!amountMatchesBatch(batch)) return false;
      const ex = batch.executionDate ? Date.parse(String(batch.executionDate).slice(0, 10)) : NaN;
      const txd = txn.txnDate ? Date.parse(String(txn.txnDate).slice(0, 10)) : NaN;
      if (Number.isFinite(ex) && Number.isFinite(txd) && Math.abs(ex - txd) > 14 * 86400000) {
        return false;
      }
      return true;
    });

    if (candidates.length === 1) return candidates[0];

    if (candidates.length > 1) {
      const cp = normalizeText(
        getCounterpartyDisplay(txn)?.value || txn.counterpartyName || ""
      );
      if (cp.length >= 3) {
        const narrowed = candidates.filter((batch) => {
          const names = (batch.operations || [])
            .map((op) => normalizeText(op.creditorName || ""))
            .filter(Boolean)
            .join(" ");
          return names && (names.includes(cp) || cp.includes(names.slice(0, 48)));
        });
        if (narrowed.length === 1) return narrowed[0];
      }
    }

    return null;
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
        const slipIndex: Record<string, PayrollSlipIndexEntry> = {};

        importedDocs.forEach((doc) => {
          const docId = doc.id || doc._id || "";
          const payrollBatch = doc.structuredData?.payrollBatch;
          if (payrollBatch?.slips?.length) {
            const batchId = payrollBatch.id || docId;
            for (const slip of payrollBatch.slips) {
              if (!slip?.id) continue;
              slipIndex[slip.id] = {
                employeeName: slip.employeeName || slip.id,
                matricule: slip.matricule,
                sourceDocumentId: docId,
                batchId,
                netPay: slip.netPay ?? null,
                iban: slip.iban ?? null,
                periodLabel: payrollBatch.periodLabel ?? null,
              };
            }
          }
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
              const fromSepaDecisions = collectInvoiceIdsFromSepaDecisions(
                persisted.sepaLineDecisions
              );
              const matchedInvoiceIds = Array.isArray(persisted.matchedInvoiceIds)
                ? persisted.matchedInvoiceIds
                : [];
              const pendingInvoiceIds = Array.isArray(persisted.pendingInvoiceIds)
                ? persisted.pendingInvoiceIds
                : fromSepaDecisions.length > 0
                  ? fromSepaDecisions
                  : [];
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
                matchedInvoiceIds,
                pendingInvoiceIds,
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

          if (structured?.sepaBatch && (docType === "sepa_xml" || String(docType || "").includes("sepa"))) {
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

        scannedTransactions.forEach((txn) => {
          const decisions = txn.sepaLineDecisions;
          if (!decisions) return;
          const wanted = normalizeSepaRef(txn.reference);
          const txnAmt = Math.abs(Number(txn.amount || 0));
          for (const [key, batch] of Object.entries(scannedSepaBatches)) {
            const keyNorm = normalizeSepaRef(key);
            const idNorm = normalizeSepaRef(batch?.id || "");
            const refMatch =
              keyNorm === wanted ||
              idNorm === wanted ||
              (wanted.length >= 8 &&
                (keyNorm.includes(wanted) ||
                  wanted.includes(keyNorm) ||
                  idNorm.includes(wanted) ||
                  wanted.includes(idNorm)));
            const batchTotal = Math.abs(Number(batch.totalAmount || 0));
            const sumOps = (batch.operations || []).reduce(
              (s, op) => s + Math.abs(Number(op.amount || 0)),
              0
            );
            const amountMatch =
              (batchTotal > 0 && Math.abs(batchTotal - txnAmt) <= 0.02) ||
              (sumOps > 0 && Math.abs(sumOps - txnAmt) <= 0.02);
            if (!refMatch && !amountMatch) continue;
            scannedSepaBatches[key] = applySepaDecisionsToBatch(batch, decisions);
            break;
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
        setPayrollSlipsByRef(slipIndex);

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
    return Boolean(findSepaBatchForTransaction(selectedDetailsTxn));
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
    setManualInvoiceNotFound(selectedDetailsTxn.unreconciledCategory === "facture_introuvable");
    setSepaCurrentOperationIndex(0);

    const linkedBatch = findSepaBatchForTransaction(selectedDetailsTxn);
    setDetailsSepaReference(linkedBatch?.id ? String(linkedBatch.id) : null);
  }, [selectedDetailsTxn, sepaBatchesByReference]);

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
    const isPayrollSepa = selectedSepaBatch.type === "payroll";
    selectedSepaBatch.operations.forEach((op) => {
      const persistedDecision = persistedLineDecisions[op.id];
      const linkedIds = Array.isArray(op.linkedInvoiceIds) ? op.linkedInvoiceIds : [];
      const slipRef = op.payrollSlipRef || persistedDecision?.selectedPayrollSlipRef;
      const isTxnReconciled = selectedDetailsTxn.reconciledStatus === "rapproché";
      if (isPayrollSepa) {
        seededDecisions[op.id] = {
          status:
            persistedDecision?.status ||
            (slipRef ? "approved" : isTxnReconciled ? "approved" : "pending"),
          selectedInvoiceIds: [],
          selectedPayrollSlipRef: slipRef || undefined,
          rejectAllSuggestions: Boolean(persistedDecision?.rejectAllSuggestions),
          invoiceNotFound: Boolean(persistedDecision?.invoiceNotFound),
        };
        return;
      }
      seededDecisions[op.id] = {
        status:
          persistedDecision?.status
            ? persistedDecision.status
            : persistedDecision?.invoiceNotFound
              ? "approved"
              : isTxnReconciled && linkedIds.length > 0
                ? "approved"
                : "pending",
        selectedInvoiceIds: Array.isArray(persistedDecision?.selectedInvoiceIds)
          ? persistedDecision.selectedInvoiceIds
          : linkedIds,
        rejectAllSuggestions: Boolean(persistedDecision?.rejectAllSuggestions),
        invoiceNotFound: Boolean(persistedDecision?.invoiceNotFound),
      };
    });

    setSepaLineDecisions(seededDecisions);
    setSepaEditModeByOperation({});
    setSepaCurrentOperationIndex(0);
  }, [selectedDetailsTxn?.id, selectedDetailsTxn?.reconciledStatus, detailsDialogOpen, selectedTxnIsSepa, selectedSepaBatch]);

  const openDetailsSection = (txn: LocalTransaction, mode: "panel" | "dialog" = "panel") => {
    setDetailsTxnId(txn.id);
    const linkedBatch = findSepaBatchForTransaction(txn);
    setDetailsSepaReference(linkedBatch?.id ? String(linkedBatch.id) : null);
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

        const invoiceNumbers = resolveInvoicesByIds(
          getTxnDisplayInvoiceIds(txn, findSepaBatchForTransaction(txn))
        )
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
        const badge = getTxnReconciliationBadgeStatus(txn, findSepaBatchForTransaction(txn));
        if (statusFilter === "reconciled") return badge === "rapproché";
        return badge !== "rapproché";
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
        const invoiceCount = getTxnDisplayInvoiceIds(txn, findSepaBatchForTransaction(txn)).length;
        if (invoiceFilter === "all") return true;
        if (invoiceFilter === "with_invoice") return invoiceCount > 0;
        if (invoiceFilter === "without_invoice") return invoiceCount === 0;
        if (invoiceFilter === "multi_invoice") return invoiceCount > 1;
        return true;
      })
      .filter((txn) => (sepaOnly ? txn.paymentMethod === "SEPA" : true))
      .filter((txn) => {
        if (!payrollOnly) return true;
        const batch = findSepaBatchForTransaction(txn);
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
    sepaBatchesByReference,
  ]);


  const duplicateInvoiceAssignments = useMemo(
    () => findDuplicateInvoiceAssignments(transactions, findSepaBatchForTransaction),
    [transactions, sepaBatchesByReference]
  );

  const isInvoiceUsedOnAnotherTxn = useCallback(
    (invoiceId: string, currentTxnId: string) =>
      isInvoiceLinkedToOtherTransactions(
        invoiceId,
        currentTxnId,
        transactions,
        findSepaBatchForTransaction
      ),
    [transactions, sepaBatchesByReference]
  );

  const [manualSuggestions, setManualSuggestions] = useState<SepaOperationCandidate[]>([]);
  const [aiScoreCacheByTxn, setAiScoreCacheByTxn] = useState<Record<string, any>>({});
  const [sepaFirstOpCacheByTxn, setSepaFirstOpCacheByTxn] = useState<
    Record<string, { opId: string; suggestions: SepaOperationCandidate[]; combinations: SepaCombination[] }>
  >({});
  const [dialogSepaSuggestions, setDialogSepaSuggestions] = useState<Record<string, SepaOperationCandidate[]>>({});
  const [dialogSepaCombinations, setDialogSepaCombinations] = useState<Record<string, SepaCombination[]>>({});
  const [batchLevelCombinations, setBatchLevelCombinations] = useState<SepaCombination[]>([]);
  const [dialogSepaLoading, setDialogSepaLoading] = useState(false);
  const [manualRecoLoading, setManualRecoLoading] = useState(false);
  const [manualRecoProcessing, setManualRecoProcessing] = useState(false);
  const autoReconciledRef = useRef<Set<string>>(new Set());
  const manualSuggestionsReqRef = useRef(0);
  const manualEngineRowsRef = useRef<SepaOperationCandidate[]>([]);
  const manualRecoPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const realInvoiceIdSet = useMemo(
    () => new Set(realInvoices.map((inv) => String(inv.id))),
    [realInvoices]
  );

  const getOpenInvoices = useCallback(
    () =>
      realInvoices.filter((inv) => {
        const status = String(inv.status || "").toLowerCase();
        return !["rapprochée", "rapprochee", "reconciled"].includes(status);
      }),
    [realInvoices]
  );

  useEffect(() => {
    const prefetchReconciliationCaches = async () => {
      if (!realInvoices.length) return;

      const openInvoices = realInvoices.filter((inv) => {
        const status = String(inv.status || "").toLowerCase();
        return !["rapprochée", "rapprochee", "reconciled"].includes(status);
      });
      if (!openInvoices.length) return;

      const targets = filteredTxns
        .filter((txn) => getTxnReconciliationBadgeStatus(txn) !== "rapproché")
        .slice(0, 25);

      const scopeIds = targets.map((t) => t.id);
      const { proposals: byId } = await fetchStoredProposalsMap(scopeIds, { ensure: true });

      const cacheNext: Record<string, any> = {};
      const sepaPrefetchNext: Record<string, { opId: string; suggestions: SepaOperationCandidate[]; combinations: SepaCombination[] }> = {};
      for (const txn of targets) {
        const row = byId[txn.id];
        const payload = proposalPayloadFromRow(row);
        if (payload && row?.processingStatus === "processed") {
          cacheNext[txn.id] = payload;
        }
      }

      await Promise.all(
        targets.map(async (txn) => {
          try {
            const batch = findSepaBatchForTransaction(txn);
            if (!batch || !Array.isArray(batch.operations) || batch.operations.length === 0) return;
            if (batch.type === "payroll") return;
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

      setAiScoreCacheByTxn((prev) => ({ ...prev, ...cacheNext }));
      if (Object.keys(sepaPrefetchNext).length > 0) {
        setSepaFirstOpCacheByTxn((prev) => ({ ...prev, ...sepaPrefetchNext }));
      }
    };

    void prefetchReconciliationCaches();
  }, [filteredTxns, realInvoices]);

  const resolveInvoicesByIds = (ids?: string[]) => {
    if (!ids?.length) return [] as LocalInvoice[];
    const byId = new Map(realInvoices.map((invoice) => [invoice.id, invoice] as const));
    return ids
      .map((id) => byId.get(id) || localInvoices.find((invoice) => invoice.id === id))
      .filter(Boolean) as LocalInvoice[];
  };

  const resolvePayrollSlipLabel = (ref?: string | null) => {
    if (!ref) return null;
    const slip = payrollSlipsByRef[ref];
    if (!slip) return ref;
    return slip.matricule ? `${slip.employeeName} (${slip.matricule})` : slip.employeeName;
  };

  const getPayrollMatchReasons = useCallback(
    (op: SepaBatchOperation, slipRef?: string | null) =>
      getPayrollSlipMatchReasonsForOperation(op, payrollSlipsByRef, slipRef),
    [payrollSlipsByRef]
  );

  const renderPayrollMatchReasons = (
    reasons: string[],
    tone: "violet" | "emerald" = "violet"
  ) => {
    if (!reasons.length) return null;
    const chipClass =
      tone === "emerald"
        ? "rounded-full bg-white/90 px-2 py-1 text-[11px] text-emerald-800 ring-1 ring-emerald-200"
        : "rounded-full bg-violet-100/90 px-2 py-1 text-[11px] text-violet-800";
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        {reasons.map((reason) => (
          <span key={reason} className={chipClass}>
            {reason}
          </span>
        ))}
      </div>
    );
  };

  const getPayrollSlipFileUrl = (
    op: SepaBatchOperation,
    slipRef?: string | null
  ): string | null => {
    const ref = slipRef || op.payrollSlipRef;
    if (!ref) return null;
    const slip = payrollSlipsByRef[ref];
    const docId =
      op.payrollSlipDocumentId ||
      slip?.sourceDocumentId ||
      selectedSepaBatch?.payrollBatchDocumentId ||
      null;
    if (!docId) return null;
    return `/api/imports/${encodeURIComponent(docId)}/payslip/${encodeURIComponent(ref)}/file`;
  };

  const openPayrollSlipPdf = (op: SepaBatchOperation, slipRef?: string | null) => {
    const ref = slipRef || op.payrollSlipRef;
    const url = getPayrollSlipFileUrl(op, ref);
    if (!url) {
      toast?.error?.(
        "Impossible d'ouvrir la fiche. Vérifiez que le bulletin du mois est importé (Bulletins de paie)."
      );
      return;
    }
    setPreviewPdfTitle(
      `Bulletin — ${resolvePayrollSlipLabel(ref) || op.creditorName || "Salarié"}`
    );
    setPreviewPdfUrl(url);
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

        const amountDateOnly = isAmountDateDisplayCandidate(pseudoTxn as any, invoice);
        const passesBusinessGate =
          hasRefHit ||
          hasCreditorSupplierHit ||
          strongAmountMatch ||
          aiScore >= SUGGESTION_MEDIUM_SCORE ||
          amountDateOnly;
        if (!passesBusinessGate) return null;
        if (
          !hasCreditorSupplierHit &&
          !hasRefHit &&
          !amountLooksPlausible &&
          aiScore < SUGGESTION_MEDIUM_SCORE &&
          !amountDateOnly
        ) {
          return null;
        }

        const displayScore = Math.max(aiScore, score);
        if (
          !shouldShowReconciliationSuggestion(pseudoTxn as any, invoice, score, {
            trustBackend: true,
            serverScore: aiScore,
          })
        ) {
          return null;
        }

        const reasons: string[] = [];
        if (Array.isArray(srv?.signals)) reasons.push(...srv.signals);
        if (srv?.reason) reasons.push(String(srv.reason));
        reasons.unshift(`Écart montant ligne: ${formatMoney(amountDiff, invoice.currency ?? pseudoTxn.currency)}`);
        if (hasRefHit) reasons.unshift("Référence exacte détectée");
        if (hasVendorHit) reasons.unshift("Tiers cohérent");
        if (hasCreditorSupplierHit) reasons.unshift("Créancier SEPA cohérent avec le fournisseur");
        return enrichSepaOperationCandidate(pseudoTxn as any, invoice, {
          score: displayScore,
          serverScore: aiScore,
          reasons: reasons.length ? reasons : undefined,
          serverNotAutoReasons: Array.isArray(srv?.notAutoReasons) ? srv.notAutoReasons : undefined,
          requiresManualValidation: srv?.requiresManualValidation,
        });
      })
      .filter((x): x is SepaOperationCandidate => Boolean(x))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return {
      opId: op.id,
      suggestions: enriched,
      combinations: finalCombos,
    };
  };

  const mergeManualSuggestionLists = (
    primary: SepaOperationCandidate[],
    secondary: SepaOperationCandidate[]
  ): SepaOperationCandidate[] => {
    const seen = new Set(primary.map((row) => row.invoice.id));
    const merged = [...primary];
    for (const row of secondary) {
      if (!seen.has(row.invoice.id)) {
        merged.push(row);
        seen.add(row.invoice.id);
      }
    }
    return merged.sort((a, b) => b.score - a.score).slice(0, 8);
  };

  const buildManualSuggestionsFromPayload = (payload: any, txn: LocalTransaction) => {
    const openById = new Map(getOpenInvoices().map((inv) => [String(inv.id), inv]));
    const raw = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
    const isEnginePayload = String(payload?.scoring || "").includes("engine");
    return raw
      .map((s: any) => {
        const invoiceId = String(s.invoiceId || s.invoice?.id || "");
        const embedded = s.invoice;
        const invoice =
          openById.get(invoiceId) ||
          realInvoices.find((inv) => String(inv.id) === invoiceId) ||
          (embedded?.id
            ? {
                id: String(embedded.id),
                invoiceNumber: embedded.invoiceNumber || "",
                vendorCustomer: embedded.vendorCustomer || "",
                amountGross: Number(embedded.amountGross || 0),
                currency: txn.currency,
                status: "non_rapprochée",
                type: txn.amount < 0 ? "purchase" : "sales",
              }
            : null);
        if (!invoice) return null;
        const status = String(invoice.status || "").toLowerCase();
        if (["rapprochée", "rapprochee", "reconciled"].includes(status)) return null;
        const score = Number(s.score ?? 0);
        const parts: string[] = [];
        if (Array.isArray(s.signals) && s.signals.length) parts.push(...s.signals);
        if (s.reason) parts.push(String(s.reason));
        const reasons = parts.length
          ? filterSepaCandidateReasons(parts)
          : buildCandidateReasons(txn, invoice as LocalInvoice, score);
        return enrichSepaOperationCandidate(txn, invoice as LocalInvoice, {
          score,
          serverScore: score,
          reasons: reasons.length ? reasons : [s.reason || "Correspondance moteur serveur"],
          serverNotAutoReasons: Array.isArray(s.notAutoReasons) ? s.notAutoReasons : undefined,
          requiresManualValidation: s.requiresManualValidation,
        });
      })
      .filter((row): row is SepaOperationCandidate => Boolean(row))
      .filter((item) =>
        shouldShowReconciliationSuggestion(txn, item.invoice, item.score, {
          trustBackend: isEnginePayload,
          serverScore: item.serverScore ?? item.score,
        })
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  };

  const buildLocalFallbackManualSuggestions = (txn: LocalTransaction): SepaOperationCandidate[] => {
    const txnCurrency = txn.currency || "EUR";
    return getOpenInvoices()
      .map((invoice) => {
        const invForScore = {
          ...invoice,
          currency: (invoice.currency || txnCurrency) as CurrencyCode,
        };
        const score = computeMatchScore(txn, invForScore);
        if (!shouldShowReconciliationSuggestion(txn, invForScore, score)) return null;
        return enrichSepaOperationCandidate(txn, invForScore, { score });
      })
      .filter((row): row is SepaOperationCandidate => Boolean(row))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  };

  const applyManualSuggestionsFromStoredRow = (
    txn: LocalTransaction,
    row?: StoredReconciliationProposal,
    engineRows: SepaOperationCandidate[] = manualEngineRowsRef.current
  ) => {
    const payload = row ? proposalPayloadFromRow(row) : null;
    const fromStore = payload ? buildManualSuggestionsFromPayload(payload, txn) : [];
    const merged = mergeManualSuggestionLists(engineRows, fromStore);

    if (!row || row.processingStatus === "failed") {
      setManualRecoProcessing(false);
      if (merged.length > 0) {
        setManualSuggestions(merged);
        return;
      }
      setManualSuggestions(buildLocalFallbackManualSuggestions(txn));
      return;
    }
    if (row.processingStatus === "processing") {
      setManualRecoProcessing(true);
      setManualSuggestions(merged);
      return;
    }
    setManualRecoProcessing(false);
    if (merged.length > 0) {
      setManualSuggestions(merged);
      if (payload) {
        setAiScoreCacheByTxn((prev) => ({ ...prev, [txn.id]: payload }));
      }
      return;
    }
    setManualSuggestions(buildLocalFallbackManualSuggestions(txn));
  };

  const loadManualSuggestionsForTxn = async (
    txn: LocalTransaction,
    options?: { ensure?: boolean }
  ) => {
    const requestId = ++manualSuggestionsReqRef.current;
    setManualRecoLoading(true);

    const finish = () => {
      if (manualSuggestionsReqRef.current === requestId) {
        setManualRecoLoading(false);
      }
    };

    try {
      let engineRows: SepaOperationCandidate[] = [];
      try {
        const engine = await fetchEngineMatch(
          txn as unknown as Record<string, unknown>,
          getOpenInvoices()
        );
        if (manualSuggestionsReqRef.current !== requestId) return;
        const enginePayload = {
          suggestions: engine.suggestions || [],
          scoring: engine.scoring || "engine-deterministic",
          processingStatus: "processed",
        };
        engineRows = buildManualSuggestionsFromPayload(enginePayload, txn);
        manualEngineRowsRef.current = engineRows;
        if (engineRows.length > 0) {
          setManualSuggestions(engineRows);
          setManualRecoProcessing(false);
        }
      } catch (engineError) {
        console.warn("fetchEngineMatch:", engineError);
        manualEngineRowsRef.current = [];
      }

      const { proposals } = await fetchStoredProposalsMap([txn.id], {
        ensure: options?.ensure !== false,
      });
      if (manualSuggestionsReqRef.current !== requestId) return;

      let row = proposals[txn.id];
      applyManualSuggestionsFromStoredRow(txn, row, engineRows);

      const needsPoll =
        row?.processingStatus === "processing" || (!row && options?.ensure !== false);

      if (!needsPoll) {
        finish();
        return;
      }

      let attempts = 0;
      const poll = async () => {
        if (manualSuggestionsReqRef.current !== requestId) return;
        attempts += 1;
        const { proposals: nextMap } = await fetchStoredProposalsMap([txn.id], { ensure: false });
        if (manualSuggestionsReqRef.current !== requestId) return;
        row = nextMap[txn.id];
        if (row?.processingStatus === "processed" || row?.processingStatus === "failed") {
          applyManualSuggestionsFromStoredRow(txn, row, manualEngineRowsRef.current);
          finish();
          return;
        }
        if (attempts < 20) {
          manualRecoPollTimerRef.current = window.setTimeout(() => void poll(), 2500);
        } else {
          applyManualSuggestionsFromStoredRow(txn, row, manualEngineRowsRef.current);
          finish();
        }
      };
      manualRecoPollTimerRef.current = window.setTimeout(() => void poll(), 2000);
    } catch (error) {
      console.error("loadManualSuggestionsForTxn:", error);
      if (manualSuggestionsReqRef.current === requestId) {
        setManualSuggestions(buildLocalFallbackManualSuggestions(txn));
        setManualRecoProcessing(false);
      }
      finish();
    }
  };

  const handleRecalculateReconciliation = async (txn: LocalTransaction) => {
    setManualRecoLoading(true);
    setManualRecoProcessing(true);
    setManualSuggestions([]);
    try {
      await requestRecalculate(txn, getOpenInvoices());
      await loadManualSuggestionsForTxn(txn, { ensure: false });
    } catch (error) {
      console.error("handleRecalculateReconciliation:", error);
      toast?.error?.("Impossible de lancer le recalcul.");
      setManualRecoLoading(false);
      setManualRecoProcessing(false);
    }
  };

  const handleSuggestionBadgeClick = async (txn: LocalTransaction) => {
    const batch = findSepaBatchForTransaction(txn);
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
    void loadManualSuggestionsForTxn(txn, { ensure: true });
  };

  useEffect(() => {
    if (manualRecoPollTimerRef.current) {
      window.clearTimeout(manualRecoPollTimerRef.current);
      manualRecoPollTimerRef.current = null;
    }
    if (!selectedDetailsTxn || selectedTxnIsSepa) {
      setManualSuggestions([]);
      setManualRecoLoading(false);
      setManualRecoProcessing(false);
      return;
    }
    void loadManualSuggestionsForTxn(selectedDetailsTxn, { ensure: true });
    return () => {
      if (manualRecoPollTimerRef.current) {
        window.clearTimeout(manualRecoPollTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetailsTxn?.id, selectedTxnIsSepa, realInvoices.length]);

  useEffect(() => {
    if (!selectedDetailsTxn || selectedTxnIsSepa) return;
    if (selectedDetailsTxn.reconciledStatus === "rapproché") return;
    if (manualInvoiceSelection.length > 0) return;
    const top = manualSuggestions[0];
    if (top?.invoice?.id && top.score >= 40) {
      setManualInvoiceSelection([top.invoice.id]);
    }
  }, [manualSuggestions, selectedDetailsTxn, selectedTxnIsSepa, manualInvoiceSelection.length]);

  useEffect(() => {
    return subscribeReconciliationEvents((payload) => {
      const type = String(payload?.type || "");
      if (type !== "RECONCILIATION_PROCESSED" && type !== "RECONCILIATION_FAILED") return;
      const txnId = String(payload?.bank_transaction_id || payload?.entity_id || "");
      if (!txnId || txnId.includes("::")) return;
      if (selectedDetailsTxn?.id === txnId && !selectedTxnIsSepa) {
        void loadManualSuggestionsForTxn(selectedDetailsTxn, { ensure: false });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetailsTxn?.id, selectedTxnIsSepa]);

  useEffect(() => {
    const loadDialogSepaSuggestions = async () => {
      console.log("[SEPA-SUGGEST] open=", detailsDialogOpen, "txn=", selectedDetailsTxn?.id, "isSepa=", selectedTxnIsSepa, "batch=", selectedSepaBatch?.id, "invoices=", realInvoices.length, "reconciledStatus=", selectedDetailsTxn?.reconciledStatus);
      if (
        !detailsDialogOpen ||
        !selectedDetailsTxn ||
        !selectedTxnIsSepa ||
        !selectedSepaBatch ||
        selectedSepaBatch.type === "payroll"
      ) {
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
                const amountDateOnly = isAmountDateDisplayCandidate(pseudoTxn as any, invoice);
                const passesBusinessGate =
                  hasRefHit ||
                  hasCreditorSupplierHit ||
                  strongAmountMatch ||
                  aiScore >= SUGGESTION_MEDIUM_SCORE ||
                  amountDateOnly;
                if (!passesBusinessGate) return null;

                if (
                  !hasCreditorSupplierHit &&
                  !hasRefHit &&
                  !amountLooksPlausible &&
                  aiScore < SUGGESTION_MEDIUM_SCORE &&
                  !amountDateOnly
                ) {
                  return null;
                }

                const displayScore = Math.max(aiScore, score);
                if (
                  !shouldShowReconciliationSuggestion(pseudoTxn as any, invoice, score, {
                    trustBackend: true,
                    serverScore: aiScore,
                  })
                ) {
                  return null;
                }

                const reasons: string[] = [];
                if (Array.isArray(srv?.signals)) reasons.push(...srv.signals);
                if (srv?.reason) reasons.push(String(srv.reason));
                reasons.unshift(`Écart montant ligne: ${formatMoney(amountDiff, invoice.currency ?? pseudoTxn.currency)}`);
                if (hasRefHit) reasons.unshift("Référence exacte détectée");
                if (hasVendorHit) reasons.unshift("Tiers cohérent");
                if (hasCreditorSupplierHit) reasons.unshift("Créancier SEPA cohérent avec le fournisseur");
                return enrichSepaOperationCandidate(pseudoTxn as any, invoice, {
                  score: displayScore,
                  serverScore: aiScore,
                  reasons: reasons.length ? reasons : undefined,
                  serverNotAutoReasons: Array.isArray(srv?.notAutoReasons) ? srv.notAutoReasons : undefined,
                  requiresManualValidation: srv?.requiresManualValidation,
                });
              })
              .filter((x): x is SepaOperationCandidate => Boolean(x))
              .sort((a, b) => b.score - a.score)
              .slice(0, 8);

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
        setDialogSepaSuggestions({ [firstEntry[0]]: firstEntry[1].slice(0, 8) });
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
                next[opId] = suggestions.slice(0, 8);
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
        const batchUsed = new Set<string>();
        for (const otherOp of selectedSepaBatch.operations) {
          if (otherOp.id === op.id) continue;
          const otherDecision = updates[otherOp.id];
          (otherDecision?.selectedInvoiceIds ?? otherOp.linkedInvoiceIds ?? []).forEach((id) =>
            batchUsed.add(String(id))
          );
        }
        const comboIds = topCombo.invoiceIds.map(String);
        if (
          comboIds.some((id) => batchUsed.has(id)) ||
          comboIds.some((id) => isInvoiceUsedOnAnotherTxn(id, selectedDetailsTxn.id))
        ) {
          return;
        }
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
      const invId = String(top.invoice.id);
      const batchUsed = new Set<string>();
      for (const otherOp of selectedSepaBatch.operations) {
        if (otherOp.id === op.id) continue;
        const otherDecision = updates[otherOp.id];
        (otherDecision?.selectedInvoiceIds ?? otherOp.linkedInvoiceIds ?? []).forEach((id) =>
          batchUsed.add(String(id))
        );
      }
      if (batchUsed.has(invId) || isInvoiceUsedOnAnotherTxn(invId, selectedDetailsTxn.id)) return;
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
    const nextMatched = allApproved ? allMatched : [];
    const nextPending = allApproved ? [] : allMatched;

    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === selectedDetailsTxn.id
          ? {
              ...txn,
              reconciledStatus: nextTxnStatus,
              matchedInvoiceIds: nextMatched,
              pendingInvoiceIds: nextPending,
              sepaLineDecisions: updates,
            }
          : txn
      )
    );

    void persistTxnReconciliation(selectedDetailsTxn.id, {
      reconciledStatus: nextTxnStatus,
      matchedInvoiceIds: nextMatched,
      pendingInvoiceIds: nextPending,
      sepaLineDecisions: updates,
    });

    const added = allMatched.filter((id) => !previousMatched.includes(id));
    const removed = previousMatched.filter((id) => !allMatched.includes(id));
    if (added.length || removed.length) {
      void syncInvoicesStatusFromTxn(added, removed);
    }

    const totalLinked = autoAppliedLines.reduce((s, l) => s + l.invoiceIds.length, 0);
    toast?.success?.(
      allApproved
        ? `Lot SEPA rapproché automatiquement (${totalLinked} facture(s) liées).`
        : `${autoAppliedLines.length} ligne(s) SEPA rapprochée(s) en partie (${totalLinked} facture(s) liées).`
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
    const invId = String(top.invoice.id);
    if (isInvoiceUsedOnAnotherTxn(invId, selectedDetailsTxn.id)) return;
    autoReconciledRef.current.add(autoKey);

    const previousMatched = selectedDetailsTxn.matchedInvoiceIds ?? [];
    const nextMatched = [invId];

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
    toast?.success?.("Rapprochement automatique appliqué.");
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
  const isSepaLineLocked = (operationId: string) => {
    const decision = sepaLineDecisions[operationId];
    const op = sepaOperations.find((o) => o.id === operationId);
    if (!decision || !op) return false;
    if (!isSepaLineResolved(decision, op, selectedSepaBatch?.type)) return false;
    return !sepaEditModeByOperation[operationId];
  };

  const sepaCurrentIsLocked = sepaCurrentOperation
    ? isSepaLineLocked(sepaCurrentOperation.id)
    : false;

  const allSepaLinesResolved =
    selectedSepaBatch && sepaOperations.length > 0
      ? isSepaBatchFullyResolved(sepaOperations, sepaLineDecisions, selectedSepaBatch.type)
      : false;

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
          reasons: [
            sepaCurrentDecision?.status === "approved"
              ? "Rapprochement automatique"
              : "Facture retenue pour cette ligne",
          ],
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
      invoiceNotFound: false,
      selectedInvoiceIds: current.selectedInvoiceIds.includes(invoiceId)
        ? current.selectedInvoiceIds.filter((id) => id !== invoiceId)
        : [...current.selectedInvoiceIds, invoiceId],
      status: "pending",
    }));
  };

  const refreshRealInvoices = async () => {
    try {
      const res = await fetch("/api/invoices", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) return;
      const fetched: LocalInvoice[] = Array.isArray(data?.invoices) ? data.invoices : [];
      setRealInvoices(fetched);
      localInvoices.splice(0, localInvoices.length, ...fetched);
    } catch (error) {
      console.error("refreshRealInvoices error:", error);
    }
  };

  const persistTxnReconciliation = async (
    txnId: string,
    patch: Record<string, any>,
  ) => {
    const txn = transactions.find((t) => t.id === txnId);
    if (!txn?.sourceDocumentId) {
      console.warn("persistTxnReconciliation: opération sans sourceDocumentId", txnId);
      return;
    }
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

    if (!canPersistToImportBackend(txn.sourceDocumentId)) {
      return;
    }

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
          setBackendRecoPersistenceUnavailable(true);
          console.warn("Endpoint /imports/:id/reconciliation introuvable (404). Cache local uniquement.");
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
      await refreshRealInvoices();
    } catch (error) {
      console.error("syncInvoicesStatusFromTxn error:", error);
      toast?.error?.("Statut facture non synchronisé côté backend.");
    }
  };

  const applySepaBatchFromDecisions = (decisions: Record<string, SepaOperationDecision>) => {
    if (!selectedDetailsTxn || !selectedSepaBatch) return;

    const operations = selectedSepaBatch.operations;
    const batchType = selectedSepaBatch.type;
    const allResolved = isSepaBatchFullyResolved(operations, decisions, batchType);
    const isPayrollSepa = batchType === "payroll";

    const selectedInvoiceIds = isPayrollSepa
      ? []
      : Array.from(
          new Set(
            operations.flatMap((op) => {
              const d = decisions[op.id];
              if (!d || d.invoiceNotFound || d.status !== "approved") return [];
              return d.selectedInvoiceIds ?? [];
            })
          )
        );

    const notFoundLines = operations.filter((op) => decisions[op.id]?.invoiceNotFound);
    const notFoundComment =
      notFoundLines.length > 0
        ? notFoundLines
            .map((op) => `${op.creditorName || op.endToEndId} : facture introuvable`)
            .join(" | ")
        : undefined;

    setSepaBatchesByReference((prev) => {
      const currentBatch = prev[selectedSepaBatch.id];
      if (!currentBatch) return prev;
      const nextOps = currentBatch.operations.map((op) => {
        const d = decisions[op.id];
        if (!d || d.invoiceNotFound) {
          return { ...op, linkedInvoiceIds: [] };
        }
        const ids = d.selectedInvoiceIds ?? [];
        return { ...op, linkedInvoiceIds: ids.length > 0 ? ids : op.linkedInvoiceIds || [] };
      });
      return { ...prev, [selectedSepaBatch.id]: { ...currentBatch, operations: nextOps } };
    });

    const previousMatched = selectedDetailsTxn.matchedInvoiceIds ?? [];

    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === selectedDetailsTxn.id
          ? {
              ...txn,
              reconciledStatus: allResolved ? "rapproché" : txn.reconciledStatus,
              matchedInvoiceIds: allResolved ? selectedInvoiceIds : txn.matchedInvoiceIds ?? [],
              pendingInvoiceIds: allResolved ? [] : txn.pendingInvoiceIds ?? [],
              sepaLineDecisions: decisions,
              unreconciledCategory:
                allResolved && notFoundLines.length > 0 ? "facture_introuvable" : txn.unreconciledCategory,
              unreconciledComment: allResolved
                ? notFoundComment || txn.unreconciledComment
                : txn.unreconciledComment,
              reviewFlag: allResolved && notFoundLines.length > 0 ? true : txn.reviewFlag,
            }
          : txn
      )
    );

    void persistTxnReconciliation(selectedDetailsTxn.id, {
      reconciledStatus: allResolved ? "rapproché" : selectedDetailsTxn.reconciledStatus,
      matchedInvoiceIds: allResolved ? selectedInvoiceIds : selectedDetailsTxn.matchedInvoiceIds ?? [],
      pendingInvoiceIds: allResolved ? [] : selectedDetailsTxn.pendingInvoiceIds ?? [],
      sepaLineDecisions: decisions,
      unreconciledCategory: allResolved && notFoundLines.length > 0 ? "facture_introuvable" : null,
      unreconciledComment: allResolved ? notFoundComment || null : null,
      reviewFlag: allResolved && notFoundLines.length > 0,
    });

    if (allResolved) {
      const added = selectedInvoiceIds.filter((id) => !previousMatched.includes(id));
      const removed = previousMatched.filter((id) => !selectedInvoiceIds.includes(id));
      if (added.length || removed.length) {
        void syncInvoicesStatusFromTxn(added, removed);
      }
      toast?.success?.(
        notFoundLines.length > 0
          ? "Lot SEPA clôturé (dont ligne(s) sans facture)."
          : "Lot SEPA entièrement rapproché."
      );
    }
  };

  const setSepaInvoiceNotFound = (operationId: string, checked: boolean) => {
    if (!selectedSepaBatch || selectedSepaBatch.type === "payroll") return;
    const nextDecisions: Record<string, SepaOperationDecision> = {
      ...sepaLineDecisions,
      [operationId]: {
        ...(sepaLineDecisions[operationId] ?? {
          status: "pending",
          selectedInvoiceIds: [],
          rejectAllSuggestions: false,
        }),
        invoiceNotFound: checked,
        rejectAllSuggestions: false,
        selectedInvoiceIds: checked ? [] : sepaLineDecisions[operationId]?.selectedInvoiceIds ?? [],
        status: checked ? "approved" : "pending",
      },
    };
    setSepaLineDecisions(nextDecisions);
    applySepaBatchFromDecisions(nextDecisions);
    if (checked && !isSepaBatchFullyResolved(selectedSepaBatch.operations, nextDecisions, selectedSepaBatch.type)) {
      toast?.success?.("Ligne marquée facture introuvable. Traitez les autres lignes du lot.");
    }
  };

  const resolveManualInvoiceIdsToApply = (): string[] => {
    if (manualInvoiceSelection.length > 0) return manualInvoiceSelection;
    const top = manualSuggestions[0];
    return top?.invoice?.id ? [top.invoice.id] : [];
  };

  const applyManualReconciliation = () => {
    if (!selectedDetailsTxn) return;

    if (manualInvoiceNotFound) {
      const previousMatched = selectedDetailsTxn.matchedInvoiceIds ?? [];
      setTransactions((prev) =>
        prev.map((txn) =>
          txn.id === selectedDetailsTxn.id
            ? {
                ...txn,
                reconciledStatus: "rapproché",
                matchedInvoiceIds: [],
                pendingInvoiceIds: [],
                unreconciledCategory: "facture_introuvable",
                unreconciledComment:
                  manualComment.trim() || "Facture introuvable — clôture sans pièce.",
                reviewFlag: true,
              }
            : txn
        )
      );
      void persistTxnReconciliation(selectedDetailsTxn.id, {
        reconciledStatus: "rapproché",
        matchedInvoiceIds: [],
        pendingInvoiceIds: [],
        unreconciledCategory: "facture_introuvable",
        unreconciledComment: manualComment.trim() || "Facture introuvable — clôture sans pièce.",
        reviewFlag: true,
      });
      void syncInvoicesStatusFromTxn([], previousMatched);
      toast?.success?.("Opération clôturée (facture introuvable).");
      return;
    }

    const invoiceIdsToApply = resolveManualInvoiceIdsToApply();
    if (invoiceIdsToApply.length === 0) {
      toast?.error?.("Cochez au moins une facture, ou cochez « Facture introuvable ».");
      return;
    }
    const alreadyUsed = invoiceIdsToApply.find((id) =>
      isInvoiceUsedOnAnotherTxn(id, selectedDetailsTxn.id)
    );
    if (alreadyUsed) {
      toast?.error?.(
        "Cette facture est déjà rapprochée sur une autre opération bancaire. Retirez le lien sur l'autre ligne avant de la réutiliser."
      );
      return;
    }
    const previousMatched = selectedDetailsTxn.matchedInvoiceIds ?? [];

    const noAiSuggestionAccepted = manualRejectAllSuggestions && invoiceIdsToApply.length === 0;
    const generatedComment = noAiSuggestionAccepted
      ? ["Aucune proposition IA retenue", manualComment.trim()].filter(Boolean).join(" — ")
      : manualComment.trim() || undefined;

    setTransactions((prev) =>
      prev.map((txn) =>
        txn.id === selectedDetailsTxn.id
          ? {
              ...txn,
              reconciledStatus: invoiceIdsToApply.length > 0 ? "rapproché" : "non_rapproché",
              matchedInvoiceIds: invoiceIdsToApply.length > 0 ? invoiceIdsToApply : [],
              pendingInvoiceIds: invoiceIdsToApply.length > 0 ? [] : [],
              unreconciledCategory: manualCategory || undefined,
              unreconciledComment: generatedComment,
              reviewFlag: manualReviewFlag || noAiSuggestionAccepted,
            }
          : txn,
      ),
    );

    void persistTxnReconciliation(selectedDetailsTxn.id, {
      reconciledStatus: invoiceIdsToApply.length > 0 ? "rapproché" : "non_rapproché",
      matchedInvoiceIds: invoiceIdsToApply.length > 0 ? invoiceIdsToApply : [],
      pendingInvoiceIds: invoiceIdsToApply.length > 0 ? [] : [],
      unreconciledCategory: manualCategory || null,
      unreconciledComment: generatedComment || null,
      reviewFlag: manualReviewFlag || noAiSuggestionAccepted,
    });
    void syncInvoicesStatusFromTxn(
      invoiceIdsToApply.length > 0 ? invoiceIdsToApply : [],
      previousMatched.filter((id) => !invoiceIdsToApply.includes(id)),
    );

    toast?.success?.("Opération rapprochée.");
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
    setManualInvoiceNotFound(selectedDetailsTxn.unreconciledCategory === "facture_introuvable");
  };

  const commitSepaLineEdit = (operationId: string) => {
    if (!selectedDetailsTxn || !selectedSepaBatch) return;
    const decision = sepaLineDecisions[operationId];
    if (!decision) return;

    const markAsNoMatch = Boolean(decision.rejectAllSuggestions);
    const markAsNotFound = Boolean(decision.invoiceNotFound);
    if (!markAsNoMatch && !markAsNotFound && !(decision.selectedInvoiceIds?.length > 0)) {
      toast?.error?.(
        "Sélectionne une facture, coche « Facture introuvable » ou « Aucune facture correspondante »."
      );
      return;
    }

    const nextDecisions: Record<string, SepaOperationDecision> = {
      ...sepaLineDecisions,
      [operationId]: markAsNotFound
        ? {
            status: "approved",
            selectedInvoiceIds: [],
            rejectAllSuggestions: false,
            invoiceNotFound: true,
          }
        : markAsNoMatch
          ? {
              status: "review",
              selectedInvoiceIds: [],
              rejectAllSuggestions: true,
              invoiceNotFound: false,
              reviewNote: "En attente de la facture correspondante",
            }
          : {
              ...decision,
              status: "approved",
              rejectAllSuggestions: false,
              invoiceNotFound: false,
            },
    };

    setSepaLineDecisions(nextDecisions);
    applySepaBatchFromDecisions(nextDecisions);

    setSepaEditModeByOperation((prev) => ({ ...prev, [operationId]: false }));
    toast?.success?.(
      markAsNotFound
        ? "Ligne marquée facture introuvable."
        : markAsNoMatch
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
    let nextDecisionsSnapshot: Record<string, SepaOperationDecision> | null = null;
    setSepaLineDecisions((prev) => {
      const current = prev[sepaCurrentOperation.id] ?? {
        status: "pending",
        selectedInvoiceIds: [],
        rejectAllSuggestions: false,
      };
      let selectedInvoiceIds = [...(current.selectedInvoiceIds || [])];
      if (status === "approved" && selectedInvoiceIds.length === 0) {
        const top = sepaCurrentCandidates[0];
        if (top?.invoice?.id) selectedInvoiceIds = [top.invoice.id];
      }
      if (
        status === "approved" &&
        selectedInvoiceIds.length === 0 &&
        !current.invoiceNotFound &&
        selectedSepaBatch?.type !== "payroll"
      ) {
        toast?.error?.(
          "Sélectionne une facture ou coche « Facture introuvable » avant de valider."
        );
        return prev;
      }
      if (
        status === "approved" &&
        selectedSepaBatch?.type === "payroll" &&
        !current.selectedPayrollSlipRef &&
        !sepaCurrentOperation.payrollSlipRef
      ) {
        toast?.error?.("Aucune fiche de paie liée à cette ligne SEPA salaires.");
        return prev;
      }
      const slipRef =
        current.selectedPayrollSlipRef || sepaCurrentOperation.payrollSlipRef || undefined;
      const next = {
        ...prev,
        [sepaCurrentOperation.id]: {
          ...current,
          status,
          selectedInvoiceIds: selectedSepaBatch?.type === "payroll" ? [] : selectedInvoiceIds,
          selectedPayrollSlipRef:
            selectedSepaBatch?.type === "payroll" ? slipRef : current.selectedPayrollSlipRef,
          rejectAllSuggestions: false,
          invoiceNotFound:
            selectedSepaBatch?.type === "payroll" ? false : Boolean(current.invoiceNotFound),
        },
      };
      nextDecisionsSnapshot = next;
      return next;
    });

    if (selectedDetailsTxn && nextDecisionsSnapshot) {
      applySepaBatchFromDecisions(nextDecisionsSnapshot);
    }
    setSepaEditModeByOperation((prev) => ({ ...prev, [sepaCurrentOperation.id]: false }));
    toast?.success?.(
      selectedSepaBatch?.type === "payroll"
        ? "Ligne SEPA salaires validée avec la fiche de paie."
        : "Sous-opération SEPA mise à jour."
    );
  };

  const validateWholeSepaBatch = () => {
    try {
      if (!selectedDetailsTxn || !selectedSepaBatch) return;

      const operations = Array.isArray(selectedSepaBatch.operations)
        ? selectedSepaBatch.operations
        : [];
      const batchType = selectedSepaBatch.type;

      const unresolved = operations.filter(
        (op) => !isSepaLineResolved(sepaLineDecisions[op.id], op, batchType)
      );
      if (unresolved.length > 0) {
        toast?.error?.(
          `Il reste ${unresolved.length} ligne(s) SEPA à traiter (facture, facture introuvable, ou bulletin paie).`
        );
        return;
      }

      const reviewOnly = operations.filter((op) => {
        const d = sepaLineDecisions[op.id];
        return d?.status === "review" && !d?.invoiceNotFound;
      });
      if (reviewOnly.length > 0) {
        toast?.error?.(
          "Certaines lignes sont « à revoir ». Validez-les ou cochez « Facture introuvable »."
        );
        return;
      }

      applySepaBatchFromDecisions(sepaLineDecisions);
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
    const linkedBatch = current ? findSepaBatchForTransaction(current) : null;
    const batchKey = linkedBatch?.id ? String(linkedBatch.id) : null;

    if (batchKey && sepaBatchesByReference[batchKey]) {
      setSepaBatchesByReference((prev) => {
        const batch = prev[batchKey];
        if (!batch) return prev;
        return {
          ...prev,
          [batchKey]: {
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

      setTransactions((prev) =>
        prev.filter((t) => t.sourceDocumentId !== txn.sourceDocumentId)
      );
      setSepaBatchesByReference((prev) => {
        const next = { ...prev };
        Object.entries(next).forEach(([key, batch]) => {
          if (batch?.sourceDocumentId === txn.sourceDocumentId) {
            delete next[key];
          }
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

  const reconciledCount = filteredTxns.filter(
    (t) => getTxnReconciliationBadgeStatus(t) === "rapproché"
  ).length;
  const unreconciledCount = filteredTxns.filter(
    (t) => getTxnReconciliationBadgeStatus(t) !== "rapproché"
  ).length;
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
                      const batch = findSepaBatchForTransaction(txn);
                      const invoiceChips = getTxnInvoiceDisplayChips(txn, batch, realInvoices);
                      const hasDuplicateInvoices = invoiceChips.some((chip) =>
                        duplicateInvoiceAssignments.has(chip.key)
                      );
                      const recoBadgeStatus = getTxnReconciliationBadgeStatus(txn, batch);

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
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className={`font-mono font-semibold ${txn.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>
                              {formatCompactAmount(txn.amount, txn.currency)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {invoiceChips.length === 0 ? (
                              <span className="text-xs text-slate-500">Aucune</span>
                            ) : (
                              <div>
                                <div className="flex max-w-full flex-wrap gap-1 overflow-hidden">
                                  {invoiceChips.slice(0, 3).map((chip) => (
                                    <span
                                      key={chip.key}
                                      className={`rounded-full px-2 py-1 text-xs ${
                                        duplicateInvoiceAssignments.has(chip.key)
                                          ? "bg-amber-100 text-amber-900 ring-1 ring-amber-200"
                                          : "bg-slate-100 text-slate-700"
                                      }`}
                                    >
                                      {chip.label}
                                    </span>
                                  ))}
                                  {invoiceChips.length > 3 ? (
                                    <span className="text-xs text-slate-500">+{invoiceChips.length - 3}</span>
                                  ) : null}
                                </div>
                                {hasDuplicateInvoices ? (
                                  <p className="mt-1 text-xs text-amber-700">
                                    Facture déjà liée à une autre opération
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={recoBadgeStatus} compact />
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
                                  {recoBadgeStatus !== "non_rapproché" ? (
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {manualRecoLoading || manualRecoProcessing ? (
                      <p className="text-xs text-slate-500">Calcul des suggestions en cours…</p>
                    ) : null}
                    {selectedDetailsTxn.reconciledStatus !== "rapproché" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={manualRecoLoading}
                        onClick={() => void handleRecalculateReconciliation(selectedDetailsTxn)}
                      >
                        {manualRecoLoading ? "Recalcul…" : "Recalculer les suggestions"}
                      </Button>
                    ) : null}
                  </div>
                  {manualSuggestions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                      {realInvoices.length === 0
                        ? "Aucune facture réelle chargée pour proposer un rapprochement."
                        : manualRecoLoading || manualRecoProcessing
                          ? "Analyse en cours. Les propositions apparaîtront ici dès que le serveur aura terminé."
                          : getOpenInvoices().length === 0
                            ? "Toutes les factures sont déjà marquées rapprochées."
                            : "Aucune proposition pour l'instant. Utilisez Recalculer les suggestions ou vérifiez le statut des factures."}
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
                            <ReconciliationSuggestionChips candidate={candidate} />
                          </div>
                        </div>
                      );
                    })
                  )}

                  {selectedDetailsTxn.reconciledStatus !== "rapproché" ? (
                    <div className="space-y-3 border-t border-slate-200 pt-3">
                      <label className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
                        <input
                          type="checkbox"
                          checked={manualInvoiceNotFound}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setManualInvoiceNotFound(checked);
                            if (checked) {
                              setManualInvoiceSelection([]);
                              setManualRejectAllSuggestions(false);
                            }
                          }}
                        />
                        Facture introuvable
                      </label>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          onClick={applyManualReconciliation}
                          disabled={
                            !manualInvoiceNotFound && resolveManualInvoiceIdsToApply().length === 0
                          }
                        >
                          {manualInvoiceNotFound ? "Clôturer sans facture" : "Rapprocher"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
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
                            <div className="shrink-0 text-right space-y-1">
                              <span
                                className={`inline-block rounded-full px-2 py-1 text-xs ${getDecisionBadgeClass(decision.status)}`}
                              >
                                {getSepaLineStatusLabel(decision)}
                              </span>
                              <p className="text-sm font-semibold tabular-nums text-slate-900">
                                {formatMoney(op.amount, op.currency)}
                              </p>
                            </div>
                          </div>
                          {selectedSepaBatch?.type === "payroll" && op.payrollSlipRef ? (
                            <div className="mt-2">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-xs text-violet-700 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPayrollSlipPdf(op);
                                }}
                              >
                                <FileSearch className="h-3 w-3" />
                                Voir bulletin
                              </button>
                            </div>
                          ) : selectedSepaBatch?.type !== "payroll" ? (
                            <p className="mt-2 text-xs text-slate-500">
                              {decision.selectedInvoiceIds.length} facture(s)
                            </p>
                          ) : null}
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
                          <div className="shrink-0 text-right space-y-1">
                            <span
                              className={`inline-block rounded-full px-2 py-1 text-xs ${getDecisionBadgeClass(sepaCurrentDecision?.status ?? "pending")}`}
                            >
                              {getSepaLineStatusLabel(sepaCurrentDecision)}
                            </span>
                            <p className="text-sm font-semibold tabular-nums text-slate-900">
                              {formatMoney(sepaCurrentOperation.amount, sepaCurrentOperation.currency)}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">IBAN : {sepaCurrentOperation.creditorIban}</p>
                      </div>

                      <div className="space-y-3">
                        {sepaCurrentIsLocked ? (
                          sepaCurrentDecision?.invoiceNotFound ? (
                            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                              <p className="text-sm font-medium text-violet-900">
                                Facture introuvable — ligne clôturée sans pièce.
                              </p>
                              <p className="mt-1 text-xs text-violet-800">
                                Le lot SEPA pourra être validé lorsque toutes les lignes sont traitées.
                              </p>
                              <div className="mt-3">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="bg-white"
                                  onClick={() =>
                                    setSepaEditModeByOperation((prev) => ({
                                      ...prev,
                                      [sepaCurrentOperation.id]: true,
                                    }))
                                  }
                                >
                                  Modifier
                                </Button>
                              </div>
                            </div>
                          ) : (
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                            <p className="text-sm font-medium text-emerald-800">
                              Cette sous-opération est déjà rapprochée
                              {sepaCurrentDecision?.status === "approved" ? " (automatiquement ou manuellement)" : ""}.
                            </p>
                            <p className="mt-1 text-xs text-emerald-700">
                              {selectedSepaBatch?.type === "payroll"
                                ? "Rapprochement salaire ↔ bulletin de paie."
                                : "Aucune action requise. Utilisez « Modifier » pour changer la facture liée."}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {selectedSepaBatch?.type === "payroll" ? (
                                <>
                                  <span className="rounded-full bg-white px-2 py-1 text-xs text-emerald-800 ring-1 ring-emerald-200">
                                    {resolvePayrollSlipLabel(
                                      sepaCurrentDecision?.selectedPayrollSlipRef ||
                                        sepaCurrentOperation.payrollSlipRef
                                    ) || sepaCurrentOperation.creditorName}
                                  </span>
                                  {getPayrollSlipFileUrl(
                                    sepaCurrentOperation,
                                    sepaCurrentDecision?.selectedPayrollSlipRef ||
                                      sepaCurrentOperation.payrollSlipRef
                                  ) ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 bg-white text-emerald-900"
                                      onClick={() =>
                                        openPayrollSlipPdf(
                                          sepaCurrentOperation,
                                          sepaCurrentDecision?.selectedPayrollSlipRef ||
                                            sepaCurrentOperation.payrollSlipRef
                                        )
                                      }
                                    >
                                      <FileSearch className="mr-1 h-3.5 w-3.5" />
                                      Voir le bulletin
                                    </Button>
                                  ) : null}
                                </>
                              ) : (
                                (sepaCurrentDecision?.selectedInvoiceIds || []).map((invoiceId) => {
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
                                })
                              )}
                            </div>
                            {selectedSepaBatch?.type === "payroll"
                              ? renderPayrollMatchReasons(
                                  getPayrollMatchReasons(
                                    sepaCurrentOperation,
                                    sepaCurrentDecision?.selectedPayrollSlipRef ||
                                      sepaCurrentOperation.payrollSlipRef
                                  ),
                                  "emerald"
                                )
                              : null}
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
                          )
                        ) : selectedSepaBatch?.type === "payroll" ? (
                          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 space-y-3">
                            <p className="text-sm font-medium text-violet-900">Virement salaire</p>
                            {sepaCurrentOperation.payrollSlipRef ? (
                              <>
                                <p className="text-sm text-violet-800">
                                  Fiche de paie :{" "}
                                  <span className="font-semibold">
                                    {resolvePayrollSlipLabel(sepaCurrentOperation.payrollSlipRef)}
                                  </span>
                                </p>
                                {renderPayrollMatchReasons(
                                  getPayrollMatchReasons(sepaCurrentOperation)
                                )}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="bg-white"
                                  onClick={() => openPayrollSlipPdf(sepaCurrentOperation)}
                                >
                                  <FileSearch className="mr-1 h-3.5 w-3.5" />
                                  Voir le bulletin de paie
                                </Button>
                              </>
                            ) : (
                              <p className="text-sm text-amber-800">
                                Aucune fiche de paie trouvée pour ce salarié. Importez d&apos;abord le bulletin du
                                mois (module Bulletins de paie), puis réimportez ce fichier SEPA salaires.
                              </p>
                            )}
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
                                  <ReconciliationSuggestionChips candidate={candidate} />
                                </div>
                              </div>
                            );
                          })}
                          </>
                        )}
                      </div>

                      {!sepaCurrentIsLocked ? (
                        <>
                          {selectedSepaBatch?.type !== "payroll" ? (
                            <label className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
                              <input
                                type="checkbox"
                                checked={Boolean(sepaCurrentDecision?.invoiceNotFound)}
                                onChange={(e) =>
                                  setSepaInvoiceNotFound(sepaCurrentOperation.id, e.target.checked)
                                }
                              />
                              Facture introuvable
                            </label>
                          ) : null}
                          <label className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            <input
                              type="checkbox"
                              checked={Boolean(sepaCurrentDecision?.rejectAllSuggestions)}
                              disabled={Boolean(sepaCurrentDecision?.invoiceNotFound)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                updateSepaDecision(sepaCurrentOperation.id, (current) => ({
                                  ...current,
                                  rejectAllSuggestions: checked,
                                  invoiceNotFound: false,
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
                    <StatusBadge
                      status={getTxnReconciliationBadgeStatus(selectedDetailsTxn)}
                      compact
                    />
                    {getTxnReconciliationBadgeStatus(selectedDetailsTxn) !== "non_rapproché" ? (
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
                      {selectedDetailsTxn.reconciledStatus === "rapproché" || allSepaLinesResolved ? (
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
                                                  <ReconciliationSuggestionChips candidate={candidate} />
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
                                    <div className="shrink-0 text-right space-y-1">
                                      <span
                                        className={`inline-block rounded-full px-2 py-1 text-xs ${getDecisionBadgeClass(decision.status)}`}
                                      >
                                        {getSepaLineStatusLabel(decision)}
                                      </span>
                                      <p className="text-sm font-semibold tabular-nums text-slate-900">
                                        {formatMoney(op.amount, op.currency)}
                                      </p>
                                    </div>
                                  </div>
                                  {selectedSepaBatch?.type === "payroll" && op.payrollSlipRef ? (
                                    <div className="mt-2">
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 text-xs text-violet-700 hover:underline"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openPayrollSlipPdf(op);
                                        }}
                                      >
                                        <FileSearch className="h-3 w-3" />
                                        Voir bulletin
                                      </button>
                                    </div>
                                  ) : null}
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
                                <div className="shrink-0 text-right space-y-1">
                                  <span
                                    className={`inline-block rounded-full px-2 py-1 text-xs ${getDecisionBadgeClass(sepaCurrentDecision?.status ?? "pending")}`}
                                  >
                                    {getSepaLineStatusLabel(sepaCurrentDecision)}
                                  </span>
                                  <p className="text-sm font-semibold tabular-nums text-slate-900">
                                    {formatMoney(sepaCurrentOperation.amount, sepaCurrentOperation.currency)}
                                  </p>
                                </div>
                              </div>

                              <div className="space-y-3">
                                {sepaCurrentIsLocked ? (
                                  selectedSepaBatch?.type === "payroll" ? (
                                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                                      <p className="text-sm font-medium text-emerald-800">
                                        Rapprochement salaire validé avec le bulletin de paie.
                                      </p>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full bg-white px-2 py-1 text-xs text-emerald-800 ring-1 ring-emerald-200">
                                          {resolvePayrollSlipLabel(
                                            sepaCurrentDecision?.selectedPayrollSlipRef ||
                                              sepaCurrentOperation.payrollSlipRef
                                          ) || sepaCurrentOperation.creditorName}
                                        </span>
                                        {getPayrollSlipFileUrl(sepaCurrentOperation) ? (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-7 bg-white"
                                            onClick={() => openPayrollSlipPdf(sepaCurrentOperation)}
                                          >
                                            <FileSearch className="mr-1 h-3.5 w-3.5" />
                                            Voir le bulletin
                                          </Button>
                                        ) : null}
                                      </div>
                                      {renderPayrollMatchReasons(
                                        getPayrollMatchReasons(
                                          sepaCurrentOperation,
                                          sepaCurrentDecision?.selectedPayrollSlipRef ||
                                            sepaCurrentOperation.payrollSlipRef
                                        ),
                                        "emerald"
                                      )}
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          setSepaEditModeByOperation((prev) => ({
                                            ...prev,
                                            [sepaCurrentOperation.id]: true,
                                          }))
                                        }
                                      >
                                        Modifier
                                      </Button>
                                    </div>
                                  ) : (
                                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                                    <p className="text-sm font-medium text-emerald-800">
                                      Cette sous-opération a été rapprochée automatiquement.
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {(sepaCurrentDecision?.selectedInvoiceIds || []).map((invoiceId) => {
                                        const inv = resolveInvoicesByIds([invoiceId])[0];
                                        if (!inv) return null;
                                        return (
                                          <button
                                            key={invoiceId}
                                            type="button"
                                            onClick={() => openInvoicePdf(inv)}
                                            className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-50"
                                          >
                                            <FileSearch className="h-3 w-3" />
                                            {inv.invoiceNumber} · {inv.vendorCustomer}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <div className="mt-3">
                                      <Button
                                        variant="outline"
                                        size="sm"
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
                                  )
                                ) : selectedSepaBatch?.type === "payroll" ? (
                                  <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 space-y-3">
                                    <p className="text-sm font-medium text-violet-900">Bulletin de paie lié</p>
                                    {sepaCurrentOperation.payrollSlipRef ? (
                                      <>
                                        <p className="text-sm text-violet-800">
                                          {resolvePayrollSlipLabel(sepaCurrentOperation.payrollSlipRef)}
                                        </p>
                                        {renderPayrollMatchReasons(
                                          getPayrollMatchReasons(sepaCurrentOperation)
                                        )}
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="bg-white"
                                          onClick={() => openPayrollSlipPdf(sepaCurrentOperation)}
                                        >
                                          <FileSearch className="mr-1 h-3.5 w-3.5" />
                                          Voir le bulletin de paie
                                        </Button>
                                      </>
                                    ) : (
                                      <p className="text-sm text-amber-800">
                                        Aucune fiche trouvée — importez le bulletin du mois.
                                      </p>
                                    )}
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
                                            <ReconciliationSuggestionChips candidate={candidate} />
                                          </div>
                                        </label>
                                      </div>
                                    );
                                  })
                                )}
                              </div>

                              {!sepaCurrentIsLocked ? (
                                <div className="space-y-3">
                                  {selectedSepaBatch?.type !== "payroll" ? (
                                    <label className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(sepaCurrentDecision?.invoiceNotFound)}
                                        onChange={(e) =>
                                          setSepaInvoiceNotFound(sepaCurrentOperation.id, e.target.checked)
                                        }
                                      />
                                      Facture introuvable
                                    </label>
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
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                            <Button variant="outline" onClick={() => setDetailsDialogOpen(false)}>
                              Fermer
                            </Button>
                            {!allSepaLinesResolved ? (
                              <Button type="button" onClick={handleFinalizeSepaClick}>
                                Appliquer le lot SEPA
                              </Button>
                            ) : null}
                          </div>
                        </>
                      )}
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">Suggestions de rapprochement</p>
                    {selectedDetailsTxn.reconciledStatus !== "rapproché" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={manualRecoLoading}
                        onClick={() => void handleRecalculateReconciliation(selectedDetailsTxn)}
                      >
                        {manualRecoLoading ? "Recalcul…" : "Recalculer"}
                      </Button>
                    ) : null}
                  </div>
                  {manualRecoLoading || manualRecoProcessing ? (
                    <p className="text-xs text-slate-500">Calcul en cours…</p>
                  ) : null}
                  {manualSuggestions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                      {manualRecoLoading || manualRecoProcessing
                        ? "Analyse en cours…"
                        : "Aucune suggestion trouvée. Lancez un recalcul ou vérifiez le statut des factures."}
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
                                  <ReconciliationSuggestionChips candidate={candidate} />
                                </div>
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
                      <input
                        type="checkbox"
                        checked={manualInvoiceNotFound}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setManualInvoiceNotFound(checked);
                          if (checked) {
                            setManualInvoiceSelection([]);
                            setManualRejectAllSuggestions(false);
                          }
                        }}
                      />
                      Facture introuvable
                    </label>
                    <div className="flex justify-end">
                      <Button
                        onClick={applyManualReconciliation}
                        disabled={
                          !manualInvoiceNotFound && resolveManualInvoiceIdsToApply().length === 0
                        }
                      >
                        {manualInvoiceNotFound ? "Clôturer sans facture" : "Rapprocher"}
                      </Button>
                    </div>
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

export default Banque;
