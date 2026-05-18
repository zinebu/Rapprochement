import { formatDate } from "@/pages/imports";
import { Briefcase, Users } from "lucide-react";
import { localInvoices, sepaBatchesByReference } from "./data";
import type {
  CurrencyCode,
  LocalBankAccount,
  LocalInvoice,
  LocalTransaction,
  SepaBatchOperation,
  SepaBatchType,
  SepaOperationCandidate,
  SepaOperationDecision,
  SepaOperationDecisionStatus,
} from "./types";

export function formatMoney(amount: number, currency: CurrencyCode) {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatDisplayDate(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;

  if (typeof formatDate === "function") {
    try {
      return formatDate(raw);
    } catch {
      return d.toLocaleDateString("fr-FR");
    }
  }

  return d.toLocaleDateString("fr-FR");
}

export function normalizeText(value?: string) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function extractInvoiceNumberFromText(text: string): string | null {
  const m =
    text.match(/\b(FAC-\d{4}-\d{3,4})\b/i)?.[1] ??
    text.match(/\b([A-Z]{2,5}-\d{4}-\d{2,4})\b/i)?.[1] ??
    null;
  return m ? m.toUpperCase() : null;
}

export function formatOperationLabel(label: string, rawLabel?: string): string {
  // If we have a clean label, use it
  if (label && label.length > 0 && label !== rawLabel) {
    return label;
  }
  
  // If we only have the raw label, try to clean it
  const text = rawLabel || label;
  
  // Remove common bank operation artifacts
  let clean = text
    .replace(/\s+(?:Mandat|RCUR|Infos|compl|Ultimate|Creditor|Debiteur|Beneficiaire).*$/gi, '')
    .replace(/\s+[A-Z]{2}\d+[A-Z]*.*$/, '') // Remove references like NN753184902DDGFI
    .replace(/\s+NN\d+.*$/, '') // Remove NN numbers
    .replace(/\s+REF\s*:.*$/gi, '') // Remove REF fields
    .replace(/\s+ID\s*:.*$/gi, '') // Remove ID fields
    .replace(/\s+$/, '') // Remove trailing spaces
    .trim();
  
  // If the cleaned version is too short, return the original truncated
  if (clean.length < 3) {
    return text.length > 50 ? text.substring(0, 47) + '...' : text;
  }
  
  // Limit length and return
  return clean.length > 50 ? clean.substring(0, 47) + '...' : clean;
}

export function getCurrencyBadgeClass(currency: CurrencyCode) {
  if (currency === "EUR") return "bg-blue-50 text-blue-700 ring-1 ring-blue-100";
  if (currency === "MAD") return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
  return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
}

export function getSepaBadgeConfig(batchType: SepaBatchType) {
  if (batchType === "payroll") {
    return {
      label: "SEPA salaires",
      className: "bg-violet-50 text-violet-700 ring-1 ring-violet-100",
      icon: Briefcase,
    };
  }

  return {
    label: "SEPA décaissement",
    className: "bg-sky-50 text-sky-700 ring-1 ring-sky-100",
    icon: Users,
  };
}

export function isPayrollCharge(txn: LocalTransaction): boolean {
  const label = txn.label.toUpperCase();
  const ref = txn.reference.toUpperCase();
  return label.includes("URSSAF") || ref.includes("URSSAF");
}

export function isSepaBatchTransaction(txn: LocalTransaction) {
  return txn.paymentMethod === "SEPA" && Boolean(sepaBatchesByReference[txn.reference]);
}

export function getInvoicesByIds(ids?: string[]) {
  if (!ids?.length) return [];
  return ids
    .map((id) => localInvoices.find((invoice) => invoice.id === id))
    .filter(Boolean) as LocalInvoice[];
}

export function getTxnInvoiceIds(txn?: LocalTransaction | null) {
  if (!txn) return [];
  return txn.reconciledStatus === "rapproché"
    ? txn.matchedInvoiceIds ?? []
    : txn.pendingInvoiceIds ?? [];
}

export function getAccountById(accounts: LocalBankAccount[], id: string) {
  return accounts.find((account) => account.id === id) ?? null;
}

export function amountMatchesRange(amount: number, minAmount: string, maxAmount: string) {
  const absAmount = Math.abs(amount);
  const min = minAmount !== "" ? Number(minAmount) : null;
  const max = maxAmount !== "" ? Number(maxAmount) : null;

  if (min !== null && !Number.isNaN(min) && absAmount < min) return false;
  if (max !== null && !Number.isNaN(max) && absAmount > max) return false;

  return true;
}

function parseDateMs(value?: string | null): number {
  const raw = String(value ?? "").trim();
  if (!raw) return NaN;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.getTime() : NaN;
}

function minDaysBetweenTxnAndInvoice(txn: LocalTransaction, inv: LocalInvoice): number {
  const txnMs = parseDateMs(txn.txnDate);
  if (!Number.isFinite(txnMs)) return 9999;
  const invMs = parseDateMs(inv.invoiceDate);
  const dueMs = parseDateMs(inv.dueDate);
  const candidates: number[] = [];
  if (Number.isFinite(invMs)) candidates.push(Math.abs(txnMs - invMs) / 86400000);
  if (Number.isFinite(dueMs)) candidates.push(Math.abs(txnMs - dueMs) / 86400000);
  return candidates.length ? Math.min(...candidates) : 9999;
}

const BANK_AMOUNT_TOLERANCE_EUR = 1.5;
const BANK_SINGLE_LINE_MAX_RATIO = 0.08;
const BANK_DATE_TOLERANCE_DAYS = 92;

function compactAlnum(value?: string | null): string {
  return normalizeText(value || "").replace(/[^a-z0-9]/g, "");
}

function txnHaystack(txn: LocalTransaction): string {
  const meta = (txn as { bankMeta?: Record<string, string> }).bankMeta || {};
  const sepa = (txn as { sepaOperation?: Record<string, string> }).sepaOperation || {};
  return [
    txn.label,
    txn.reference,
    txn.counterpartyName,
    meta.reference,
    meta.remittanceRef,
    meta.beneficiary,
    meta.debtor,
    meta.info,
    meta.libelle,
    sepa.creditorName,
    sepa.remittanceInfo,
    sepa.endToEndId,
  ]
    .filter(Boolean)
    .join(" ");
}

const SUPPLIER_STOP_WORDS = new Set([
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

/** Aligné sur le matching fournisseur du moteur backend. */
export function supplierNameLooksSame(a?: string | null, b?: string | null): boolean {
  const na = normalizeText(a || "");
  const nb = normalizeText(b || "");
  if (!na || !nb) return false;
  if (na === nb) return true;
  const tokenize = (s: string) =>
    s.split(/\s+/).filter((w) => w.length >= 4 && !SUPPLIER_STOP_WORDS.has(w));
  const wa = tokenize(na);
  const wb = tokenize(nb);
  if (wa.length > 0 && wb.length > 0 && wa.some((w) => wb.includes(w))) return true;
  return false;
}

export function supplierMatchesTransaction(txn: LocalTransaction, inv: LocalInvoice): boolean {
  const vendor = String(inv.vendorCustomer || "").trim();
  if (!vendor) return false;
  const names = [txn.counterpartyName, txn.label, txn.reference].filter(Boolean);
  if (names.some((name) => supplierNameLooksSame(name, vendor))) return true;
  const hay = compactAlnum(txnHaystack(txn));
  const parts = normalizeText(vendor)
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  for (const w of parts) {
    const c = compactAlnum(w);
    if (c.length >= 5 && hay.includes(c)) return true;
  }
  return false;
}

export function invoiceReferenceMatchesTransaction(
  txn: LocalTransaction,
  inv: LocalInvoice
): boolean {
  const invNo = compactAlnum(inv.invoiceNumber);
  if (invNo.length < 3) return false;
  const hay = compactAlnum(txnHaystack(txn));
  if (hay.includes(invNo)) return true;
  const extracted = extractInvoiceNumberFromText(txn.label || "");
  if (extracted) {
    const wanted = compactAlnum(extracted);
    if (wanted.length >= 3 && (invNo.includes(wanted) || wanted.includes(invNo))) return true;
  }
  const sepa = (txn as { sepaOperation?: { remittanceInfo?: string; endToEndId?: string } })
    .sepaOperation;
  const sepaRef = compactAlnum(sepa?.remittanceInfo || "");
  const sepaE2e = compactAlnum(sepa?.endToEndId || "");
  if (sepaRef && (sepaRef.includes(invNo) || invNo.includes(sepaRef))) return true;
  if (sepaE2e && (sepaE2e.includes(invNo) || invNo.includes(sepaE2e))) return true;
  const txnRef = compactAlnum(txn.reference);
  if (txnRef.length >= 3 && (invNo.includes(txnRef) || txnRef.includes(invNo))) return true;
  return false;
}

/** Faux positifs évidents (ex. -30 € vs facture 35 € sans lien fournisseur). */
export function isObviousBadBankMatch(
  txn: LocalTransaction,
  inv: LocalInvoice,
  score: number
): boolean {
  const txnAbs = Math.abs(txn.amount);
  if (txnAbs < 0.01) return true;
  const details = getMatchDetails(txn, inv);
  const ratio = details.amountDiff / txnAbs;
  const supplierHit = supplierMatchesTransaction(txn, inv);
  const refHit = invoiceReferenceMatchesTransaction(txn, inv);

  if (ratio > BANK_SINGLE_LINE_MAX_RATIO && !supplierHit && !refHit) return true;
  if (ratio > 0.15 && score < 50 && !supplierHit && !refHit) return true;

  const daysDiff = minDaysBetweenTxnAndInvoice(txn, inv);
  if (daysDiff > 365 && ratio > 0.02 && !refHit && !supplierHit) return true;

  return false;
}

export type BankSuggestionDisplayOptions = {
  /** Proposition déjà filtrée par le moteur backend (cache / IA). */
  trustBackend?: boolean;
};

export function shouldDisplayBankSuggestion(
  txn: LocalTransaction,
  inv: LocalInvoice,
  score: number,
  options?: BankSuggestionDisplayOptions
): boolean {
  if (options?.trustBackend) {
    return score >= 35 && !isObviousBadBankMatch(txn, inv, score);
  }

  const txnAbs = Math.abs(txn.amount);
  if (txnAbs < 0.01) return false;
  const details = getMatchDetails(txn, inv);
  const amountOk =
    details.amountDiff <=
    Math.max(BANK_AMOUNT_TOLERANCE_EUR, txnAbs * BANK_SINGLE_LINE_MAX_RATIO);
  const supplierHit = supplierMatchesTransaction(txn, inv);
  const refHit = invoiceReferenceMatchesTransaction(txn, inv);
  const daysDiff = minDaysBetweenTxnAndInvoice(txn, inv);
  const dateOk =
    daysDiff <= BANK_DATE_TOLERANCE_DAYS || !Number.isFinite(parseDateMs(txn.txnDate));

  if (refHit && amountOk) return score >= 35;
  if (supplierHit && amountOk && dateOk) return score >= 35;
  if (details.amountDiff <= 0.01 && supplierHit) return true;
  return false;
}

/** @deprecated Préférer shouldDisplayBankSuggestion */
export function isPlausibleBankInvoiceMatch(
  txn: LocalTransaction,
  inv: LocalInvoice,
  score: number
): boolean {
  return shouldDisplayBankSuggestion(txn, inv, score, { trustBackend: false });
}

export function computeMatchScore(txn: LocalTransaction, inv: LocalInvoice): number {
  let score = 0;
  const txnAbs = Math.abs(txn.amount);
  const diff = Math.abs(txnAbs - inv.amountGross);
  const ratio = inv.amountGross === 0 ? 0 : txnAbs / inv.amountGross;

  if ((inv.currency ?? txn.currency) !== txn.currency) return 0;

  if (diff === 0) score += 42;
  else if (diff <= 0.5) score += 36;
  else if (
    diff <= BANK_AMOUNT_TOLERANCE_EUR ||
    (txnAbs > 0 && diff / txnAbs <= BANK_SINGLE_LINE_MAX_RATIO)
  ) {
    score += 28;
  } else if (diff <= 5 && txnAbs > 0 && diff / txnAbs <= 0.05) score += 14;
  else if (ratio >= 0.2 && ratio <= 0.8) score += 10;

  const daysDiff = minDaysBetweenTxnAndInvoice(txn, inv);

  if (daysDiff <= 3) score += 26;
  else if (daysDiff <= 15) score += 18;
  else if (daysDiff <= 45) score += 10;
  else if (daysDiff > 365) score -= 40;
  else if (daysDiff > 120) score -= 22;

  if (supplierMatchesTransaction(txn, inv)) score += 22;
  else if (invoiceReferenceMatchesTransaction(txn, inv)) score += 14;

  const extractedInvoiceNo = extractInvoiceNumberFromText(txn.label);
  if (extractedInvoiceNo && extractedInvoiceNo === inv.invoiceNumber.toUpperCase()) {
    score += 20;
  }

  const invoiceType = inv.type ?? (txn.amount < 0 ? "purchase" : "sales");
  if ((txn.amount < 0 && invoiceType === "purchase") || (txn.amount > 0 && invoiceType === "sales")) {
    score += 6;
  } else {
    score -= 24;
  }

  return Math.max(0, Math.min(100, score));
}

export function getMatchDetails(txn: LocalTransaction, inv: LocalInvoice) {
  const txnAbs = Math.abs(txn.amount);
  const amountDiff = Math.abs(txnAbs - inv.amountGross);
  const ratio = inv.amountGross === 0 ? 0 : txnAbs / inv.amountGross;
  const isPartial = ratio >= 0.2 && ratio <= 0.8 && amountDiff > 5;
  const partialPercent = Math.round(ratio * 100);
  const remaining = inv.amountGross - txnAbs;
  const txnMs = parseDateMs(txn.txnDate);
  const invMs = parseDateMs(inv.invoiceDate);
  const dueMs = parseDateMs(inv.dueDate);
  const daysDiffInvoice =
    Number.isFinite(txnMs) && Number.isFinite(invMs)
      ? Math.round(Math.abs(txnMs - invMs) / 86400000)
      : 9999;
  const daysDiffDue =
    Number.isFinite(txnMs) && Number.isFinite(dueMs)
      ? Math.round(Math.abs(txnMs - dueMs) / 86400000)
      : 9999;
  const invoiceType = inv.type ?? (txn.amount < 0 ? "purchase" : "sales");
  const directionMatch =
    (txn.amount < 0 && invoiceType === "purchase") ||
    (txn.amount > 0 && invoiceType === "sales");

  return {
    amountDiff,
    daysDiffInvoice,
    daysDiffDue,
    directionMatch,
    isPartial,
    partialPercent,
    remaining,
  };
}

export function buildCandidateReasons(txn: LocalTransaction, inv: LocalInvoice, score: number) {
  const details = getMatchDetails(txn, inv);
  const reasons: string[] = [];
  const extracted = extractInvoiceNumberFromText(txn.label);

  if (extracted && extracted === inv.invoiceNumber.toUpperCase()) {
    reasons.push("Référence facture détectée dans le libellé");
  }
  const txnAbs = Math.abs(txn.amount);
  const relDiff = txnAbs > 0 ? details.amountDiff / txnAbs : 1;

  if (details.amountDiff === 0) {
    reasons.push("Montant exact");
  } else if (details.amountDiff <= 1 || relDiff <= 0.02) {
    reasons.push("Montant très proche");
  } else if (relDiff <= 0.08) {
    reasons.push(`Écart ${formatMoney(details.amountDiff, txn.currency)}`);
  } else if (details.isPartial) {
    reasons.push(`Paiement partiel possible (${details.partialPercent}%)`);
  }
  const minDays = Math.min(details.daysDiffInvoice || 9999, details.daysDiffDue || 9999);
  if (minDays <= 45) {
    reasons.push("Date cohérente avec la facture");
  } else if (minDays > 120) {
    reasons.push("Dates éloignées — à vérifier");
  }
  if (details.directionMatch) {
    reasons.push("Sens comptable cohérent");
  }
  if (normalizeText(txn.label).includes(normalizeText(inv.vendorCustomer))) {
    reasons.push("Contrepartie proche du libellé");
  }
  if ((inv.currency ?? txn.currency) === txn.currency) {
    reasons.push(`Même devise (${txn.currency})`);
  }

  return reasons.slice(0, 3);
}

export function getAvailableInvoicesForTxn(txn: LocalTransaction | null, alreadyUsedIds: string[] = []) {
  if (!txn) return [] as LocalInvoice[];

  const normalizedCounterparty = normalizeText(txn.counterpartyName);
  const used = new Set(alreadyUsedIds);

  return [...localInvoices]
    .filter((invoice) => (invoice.currency ?? txn.currency) === txn.currency)
    .filter((invoice) => {
      const invoiceType = invoice.type ?? (txn.amount < 0 ? "purchase" : "sales");
      return txn.amount < 0 ? invoiceType === "purchase" : invoiceType === "sales";
    })
    .filter((invoice) => !used.has(invoice.id) || getTxnInvoiceIds(txn).includes(invoice.id))
    .sort((a, b) => {
      const aScore = computeMatchScore(txn, a);
      const bScore = computeMatchScore(txn, b);
      const aSuggested = normalizeText(a.vendorCustomer) === normalizedCounterparty || aScore >= 60;
      const bSuggested = normalizeText(b.vendorCustomer) === normalizedCounterparty || bScore >= 60;
      if (aSuggested !== bSuggested) return aSuggested ? -1 : 1;
      if (aScore !== bScore) return bScore - aScore;
      return new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime();
    });
}

export function buildSepaOperationTransaction(batchTxn: LocalTransaction, op: SepaBatchOperation): LocalTransaction {
  return {
    ...batchTxn,
    id: `${batchTxn.id}::${op.id}`,
    amount: batchTxn.amount < 0 ? -Math.abs(op.amount) : Math.abs(op.amount),
    label: `${op.creditorName} ${op.remittanceInfo} ${op.endToEndId}`.trim(),
    reference: op.endToEndId,
    counterpartyName: op.creditorName,
    currency: op.currency,
  };
}

export function getAvailableInvoicesForSepaOperation(
  batchTxn: LocalTransaction,
  op: SepaBatchOperation,
  currentSelections: string[],
  allUsedIds: string[],
): SepaOperationCandidate[] {
  const pseudoTxn = buildSepaOperationTransaction(batchTxn, op);
  const used = new Set(allUsedIds);

  return localInvoices
    .filter((inv) => (inv.currency ?? pseudoTxn.currency) === pseudoTxn.currency)
    .filter((inv) => (pseudoTxn.amount < 0 ? (inv.type ?? "purchase") === "purchase" : (inv.type ?? "sales") === "sales"))
    .filter((inv) => !used.has(inv.id) || currentSelections.includes(inv.id) || (op.linkedInvoiceIds ?? []).includes(inv.id))
    .map((invoice) => {
      const score = computeMatchScore(pseudoTxn, invoice);
      return {
        invoice,
        score,
        details: getMatchDetails(pseudoTxn, invoice),
        reasons: buildCandidateReasons(pseudoTxn, invoice, score),
      };
    })
    .filter((candidate) => candidate.score >= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export function getDecisionBadgeClass(status: SepaOperationDecisionStatus) {
  switch (status) {
    case "approved":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
    case "rejected":
      return "bg-red-50 text-red-700 ring-1 ring-red-100";
    case "review":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-100";
    default:
      return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
  }
}

export function getDecisionLabel(status: SepaOperationDecisionStatus) {
  switch (status) {
    case "approved":
      return "Rapprochée";
    case "rejected":
      return "Rejetée";
    case "review":
      return "À revoir";
    default:
      return "À traiter";
  }
}

export function getSepaDecisionAmount(decision: SepaOperationDecision) {
  return decision.selectedInvoiceIds
    .map((id) => localInvoices.find((inv) => inv.id === id)?.amountGross ?? 0)
    .reduce((sum, value) => sum + value, 0);
}

export function formatCompactAmount(amount: number, currency: CurrencyCode) {
  const sign = amount < 0 ? "-" : "+";
  return `${sign}${formatMoney(Math.abs(amount), currency)}`;
}
