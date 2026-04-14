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

export function formatDisplayDate(value: string) {
  if (typeof formatDate === "function") return formatDate(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
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

export function computeMatchScore(txn: LocalTransaction, inv: LocalInvoice): number {
  let score = 0;
  const txnAbs = Math.abs(txn.amount);
  const diff = Math.abs(txnAbs - inv.amountGross);
  const ratio = inv.amountGross === 0 ? 0 : txnAbs / inv.amountGross;

  if ((inv.currency ?? txn.currency) !== txn.currency) return 0;

  if (diff === 0) score += 42;
  else if (diff <= 0.5) score += 36;
  else if (diff <= 5) score += 22;
  else if (ratio >= 0.2 && ratio <= 0.8) score += 14;

  const txnDate = new Date(txn.txnDate).getTime();
  const invDate = new Date(inv.invoiceDate).getTime();
  const dueDate = new Date(inv.dueDate).getTime();
  const daysDiff = Math.min(
    Math.abs(txnDate - invDate) / 86400000,
    Math.abs(txnDate - dueDate) / 86400000,
  );

  if (daysDiff <= 3) score += 26;
  else if (daysDiff <= 15) score += 18;
  else if (daysDiff <= 30) score += 10;

  const label = normalizeText(txn.label);
  const counterparty = normalizeText(txn.counterpartyName);
  const name = normalizeText(inv.vendorCustomer);
  const words = Array.from(new Set(name.split(/\s+/).filter((w) => w.length > 2)));
  const matchCount = words.filter((w) => label.includes(w) || counterparty.includes(w)).length;
  if (matchCount > 0) score += Math.min(matchCount * 8, 20);

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
  const txnDate = new Date(txn.txnDate).getTime();
  const invDate = new Date(inv.invoiceDate).getTime();
  const dueDate = new Date(inv.dueDate).getTime();
  const daysDiffInvoice = Math.round(Math.abs(txnDate - invDate) / 86400000);
  const daysDiffDue = Math.round(Math.abs(txnDate - dueDate) / 86400000);
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
  if (details.amountDiff === 0) {
    reasons.push("Montant exact");
  } else if (details.amountDiff <= 5) {
    reasons.push("Montant très proche");
  } else if (details.isPartial) {
    reasons.push(`Paiement partiel possible (${details.partialPercent}%)`);
  }
  if (details.daysDiffDue <= 7) {
    reasons.push("Date cohérente avec l'échéance");
  }
  if (details.directionMatch) {
    reasons.push("Sens comptable cohérent");
  }
  if (normalizeText(txn.label).includes(normalizeText(inv.vendorCustomer))) {
    reasons.push("Contrepartie proche du libellé");
  }
  if (score >= 80) {
    reasons.push("Suggestion prioritaire");
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
