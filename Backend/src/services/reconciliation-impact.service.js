import {
  buildLocalSuggestion,
  filterEligibleInvoices,
  invoiceId,
} from "./reconciliation-scoring.service.js";
import {
  listAllInvoicesForReconciliation,
  listOpenInvoices,
} from "./reconciliation-invoices.service.js";
import { listBankTransactionsFromImports } from "./reconciliation-bank-transactions.service.js";

const RECONCILED_STATUSES = new Set([
  "rapprochée",
  "rapprochee",
  "rapproché",
  "reconciled",
]);

function readRecoConfig() {
  const pct = Number(process.env.RECO_AMOUNT_TOLERANCE_PCT ?? "0.05");
  const abs = Number(process.env.RECO_AMOUNT_TOLERANCE_ABS ?? "20");
  const days = Number(process.env.RECO_DATE_WINDOW_DAYS ?? "365");
  const minLocalScore = Number(process.env.RECO_IMPACT_MIN_LOCAL_SCORE ?? "18");
  return {
    amountTolerancePct: Number.isFinite(pct) ? pct : 0.05,
    amountToleranceAbs: Number.isFinite(abs) ? abs : 20,
    dateWindowDays: Number.isFinite(days) ? days : 365,
    minLocalScore: Number.isFinite(minLocalScore) ? minLocalScore : 18,
  };
}

export function isTransactionLockedForAutoRecalc(transaction = {}) {
  const id = String(transaction?.id || "");
  // Une ligne SEPA ou un lot batch:: se rapproche indépendamment du parent.
  if (id.includes("::")) {
    return false;
  }
  const status = String(transaction?.reconciledStatus || "").toLowerCase();
  return RECONCILED_STATUSES.has(status);
}

function amountWithinTolerance(targetAbs, valueAbs, config) {
  if (targetAbs <= 0 || valueAbs <= 0) return false;
  const maxDiff = Math.max(
    config.amountToleranceAbs,
    targetAbs * config.amountTolerancePct
  );
  return Math.abs(targetAbs - valueAbs) <= maxDiff;
}

function currencyCompatible(transaction, invoice) {
  const tc = String(transaction?.currency || "EUR").toUpperCase();
  const ic = String(invoice?.currency || tc).toUpperCase();
  return !invoice?.currency || ic === tc;
}

function directionCompatible(transaction, invoice) {
  const amt = Number(transaction?.amount || 0);
  const expected = amt < 0 ? "purchase" : "sales";
  const invType = String(invoice?.type || expected).toLowerCase();
  return invType === expected;
}

function referenceMatchesTransaction(transaction, invoice) {
  const hay = [
    transaction?.label,
    transaction?.reference,
    transaction?.counterpartyName,
    transaction?.bankMeta?.reference,
    transaction?.bankMeta?.remittanceRef,
    transaction?.bankMeta?.beneficiary,
    transaction?.bankMeta?.debtor,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const invNo = String(invoice?.invoiceNumber || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (invNo.length >= 4 && hay.includes(invNo)) return true;

  const vendor = String(invoice?.vendorCustomer || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const parts = vendor.split(/\s+/).filter((w) => w.length >= 4);
  return parts.some((w) => hay.includes(w));
}

/**
 * Une nouvelle facture peut compléter un montant d'opération déjà partiellement couvert
 * (ex. OP 10k, F1 4k + F2 6k, nouvelle F3 10k ou F4 3k + reste 7k).
 */
function hasCombinationPotential(transaction, invoice, otherOpenInvoices, config) {
  const txnAbs = Math.abs(Number(transaction?.amount || 0));
  const invAbs = Math.abs(Number(invoice?.amountGross || 0));
  if (txnAbs <= 0 || invAbs <= 0) return false;

  if (amountWithinTolerance(txnAbs, invAbs, config)) return true;

  if (invAbs >= txnAbs) return false;

  const remainder = txnAbs - invAbs;
  const others = otherOpenInvoices.filter(
    (o) => String(invoiceId(o)) !== String(invoiceId(invoice))
  );

  for (const other of others) {
    const otherAbs = Math.abs(Number(other?.amountGross || 0));
    if (amountWithinTolerance(remainder, otherAbs, config)) return true;
  }

  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const sum =
        Math.abs(Number(others[i]?.amountGross || 0)) +
        Math.abs(Number(others[j]?.amountGross || 0));
      if (amountWithinTolerance(remainder, sum, config)) return true;
    }
  }

  return false;
}

/**
 * Détermine si une facture peut influencer le rapprochement d'une opération bancaire.
 */
export function isInvoiceRelevantToTransaction(
  transaction,
  invoice,
  otherOpenInvoices = [],
  config = readRecoConfig()
) {
  if (isTransactionLockedForAutoRecalc(transaction)) return false;
  if (!currencyCompatible(transaction, invoice)) return false;
  if (!directionCompatible(transaction, invoice)) return false;

  const eligible = filterEligibleInvoices(transaction, [invoice]);
  if (!eligible.length) return false;

  const txnAbs = Math.abs(Number(transaction?.amount || 0));
  const invAbs = Math.abs(Number(invoice?.amountGross || 0));

  if (amountWithinTolerance(txnAbs, invAbs, config)) return true;
  if (referenceMatchesTransaction(transaction, invoice)) return true;

  const local = buildLocalSuggestion(transaction, invoice);
  if (Number(local?.score || 0) >= config.minLocalScore) return true;

  if (hasCombinationPotential(transaction, invoice, otherOpenInvoices, config)) {
    return true;
  }

  return false;
}

/**
 * Retourne les opérations bancaires à recalculer lorsqu'une nouvelle facture arrive.
 */
export async function findImpactedBankTransactions(newInvoice, options = {}) {
  const invoice = newInvoice;
  if (!invoice || !invoiceId(invoice)) return [];

  const config = { ...readRecoConfig(), ...options };
  const allTransactions =
    options.transactions || (await listBankTransactionsFromImports());
  const allInvoices =
    options.allInvoices || (await listAllInvoicesForReconciliation());
  const openInvoices = options.openInvoices || listOpenInvoices(allInvoices);

  const others = openInvoices.filter(
    (inv) => String(invoiceId(inv)) !== String(invoiceId(invoice))
  );

  const impacted = [];
  for (const txn of allTransactions) {
    if (isTransactionLockedForAutoRecalc(txn)) continue;
    if (
      isInvoiceRelevantToTransaction(txn, invoice, others, config)
    ) {
      impacted.push(txn);
    }
  }

  return impacted;
}
