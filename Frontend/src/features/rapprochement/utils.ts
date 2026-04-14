import type { BankTransaction, Invoice } from "@/lib/mock-data";
import { DEFAULT_SEPA_OPERATIONS, SEPA_BATCHES_BY_REFERENCE } from "./data";
import type {
  CurrencyCode,
  SepaBatch,
  SepaBatchOperation,
  SepaOperationCandidate,
  SepaOperationDecision,
  SepaOperationDecisionStatus,
} from "./types";

export function isSepaBatch(txn: BankTransaction): boolean {
  return txn.reference.toUpperCase().startsWith("SEPA-") || txn.label.toUpperCase().includes("SEPA");
}

export function getSepaBatchForTransaction(txn: BankTransaction): SepaBatch {
  const existing = SEPA_BATCHES_BY_REFERENCE[txn.reference];
  if (existing) return existing;

  return {
    reference: txn.reference,
    label: "SEPA — Virement de masse (décaissements fournisseurs)",
    executionDate: txn.txnDate,
    operations: DEFAULT_SEPA_OPERATIONS.map((op, index) => ({
      ...op,
      id: `${txn.id}-op-${index + 1}`,
      endToEndId: `${txn.reference}-E2E-${index + 1}`,
    })),
  };
}

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function extractInvoiceNumberFromText(text: string): string | null {
  const m =
    text.match(/\b(FAC-\d{4}-\d{3,4})\b/i)?.[1] ??
    text.match(/\b([A-Z]{2,5}-\d{4}-\d{2,4})\b/i)?.[1] ??
    null;
  return m ? m.toUpperCase() : null;
}

export function inferCurrencyFromText(text: string): CurrencyCode | null {
  const normalized = normalize(text);

  if (
    normalized.includes(" usd") ||
    normalized.includes(" dollar") ||
    normalized.includes(" us$") ||
    normalized.includes("compte usd")
  ) {
    return "USD";
  }

  if (
    normalized.includes(" mad") ||
    normalized.includes(" dirham") ||
    normalized.includes(" dh") ||
    normalized.includes(" compte maroc") ||
    normalized.includes(" compte mad")
  ) {
    return "MAD";
  }

  if (
    normalized.includes(" eur") ||
    normalized.includes(" euro") ||
    normalized.includes(" sepa") ||
    normalized.includes(" compte euro") ||
    normalized.includes(" compte eur")
  ) {
    return "EUR";
  }

  return null;
}

export function getTransactionCurrency(txn: BankTransaction): CurrencyCode {
  const raw = (txn as any).currency ?? (txn as any).accountCurrency ?? (txn as any).devise;
  if (raw === "EUR" || raw === "MAD" || raw === "USD") return raw;

  return (
    inferCurrencyFromText(
      `${(txn as any).accountName ?? ""} ${(txn as any).accountLabel ?? ""} ${txn.label} ${txn.reference} ${((txn as any).counterparty ?? "")}`,
    ) ?? (isSepaBatch(txn) ? "EUR" : "EUR")
  );
}

export function getInvoiceCurrency(inv: Invoice): CurrencyCode {
  const raw = (inv as any).currency ?? (inv as any).devise;
  if (raw === "EUR" || raw === "MAD" || raw === "USD") return raw;

  return inferCurrencyFromText(`${inv.invoiceNumber} ${inv.vendorCustomer} ${inv.category}`) ?? "EUR";
}

export function getAccountBadge(currency: CurrencyCode) {
  switch (currency) {
    case "MAD":
      return { label: "Compte exploitation MAD", short: "MAD" };
    case "USD":
      return { label: "Compte international USD", short: "USD" };
    default:
      return { label: "Compte exploitation EUR", short: "EUR" };
  }
}

export function getCurrencyBadgeClass(currency: CurrencyCode) {
  switch (currency) {
    case "MAD":
      return "border-amber-200 bg-amber-100 text-amber-800";
    case "USD":
      return "border-emerald-200 bg-emerald-100 text-emerald-800";
    default:
      return "border-blue-200 bg-blue-100 text-blue-800";
  }
}

export function shouldShowAccountBadge(txn: BankTransaction) {
  const text = normalize(`${txn.label} ${txn.reference}`);
  return text.includes("prelev") || text.includes("prlv") || isSepaBatch(txn);
}

export function computeMatchScore(txn: BankTransaction, inv: Invoice): number {
  let score = 0;
  const txnAbs = Math.abs(txn.amount);
  const diff = Math.abs(txnAbs - inv.amountGross);
  const ratio = inv.amountGross === 0 ? 0 : txnAbs / inv.amountGross;

  if (getTransactionCurrency(txn) !== getInvoiceCurrency(inv)) {
    return 0;
  }

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

  const label = normalize(txn.label);
  const counterparty = normalize((txn as any).counterparty ?? "");
  const name = normalize(inv.vendorCustomer);
  const words = Array.from(new Set(name.split(/\s+/).filter((w) => w.length > 2)));
  const matchCount = words.filter((w) => label.includes(w) || counterparty.includes(w)).length;
  if (matchCount > 0) score += Math.min(matchCount * 8, 20);

  const extractedInvoiceNo = extractInvoiceNumberFromText(txn.label);
  if (extractedInvoiceNo && extractedInvoiceNo === inv.invoiceNumber.toUpperCase()) {
    score += 20;
  }

  if ((txn.amount < 0 && inv.type === "purchase") || (txn.amount > 0 && inv.type === "sales")) {
    score += 6;
  } else {
    score -= 24;
  }

  return Math.max(0, Math.min(100, score));
}

export function getMatchDetails(txn: BankTransaction, inv: Invoice) {
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
  const directionMatch =
    (txn.amount < 0 && inv.type === "purchase") ||
    (txn.amount > 0 && inv.type === "sales");

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

export function buildSepaOperationTransaction(batchTxn: BankTransaction, op: SepaBatchOperation): BankTransaction {
  return {
    ...batchTxn,
    id: `${batchTxn.id}::${op.id}`,
    amount: batchTxn.amount < 0 ? -Math.abs(op.amount) : Math.abs(op.amount),
    label: `${op.creditorName} ${op.remittanceInfo} ${op.endToEndId}`.trim(),
    reference: op.endToEndId,
    statementId: (batchTxn as any).statementId,
    txnDate: batchTxn.txnDate,
    counterparty: op.creditorName,
    ...({ currency: "EUR", accountCurrency: "EUR" } as any),
  };
}

export function buildCandidateReasons(txn: BankTransaction, inv: Invoice, score: number) {
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
  if (normalize(txn.label).includes(normalize(inv.vendorCustomer))) {
    reasons.push("Contrepartie proche du libellé");
  }
  if (score >= 80) {
    reasons.push("Suggestion prioritaire");
  }

  if (getTransactionCurrency(txn) === getInvoiceCurrency(inv)) {
    reasons.push(`Même devise (${getTransactionCurrency(txn)})`);
  }

  return reasons.slice(0, 3);
}

export function getAvailableInvoicesForSepaOperation(
  batchTxn: BankTransaction,
  op: SepaBatchOperation,
  invoices: Invoice[],
  transactions: BankTransaction[],
  currentSelections: string[],
): SepaOperationCandidate[] {
  const pseudoTxn = buildSepaOperationTransaction(batchTxn, op);
  const alreadyMatchedElsewhere = new Set(
    transactions
      .filter((t) => t.id !== batchTxn.id)
      .flatMap((t) => t.matchedInvoiceIds ?? []),
  );

  return invoices
    .filter((inv) => !alreadyMatchedElsewhere.has(inv.id) || currentSelections.includes(inv.id))
    .filter((inv) => getInvoiceCurrency(inv) === "EUR")
    .filter((inv) => (batchTxn.amount < 0 ? inv.type === "purchase" : inv.type === "sales"))
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

export function getSepaDecisionAmount(decision: SepaOperationDecision, invoices: Invoice[]) {
  return decision.selectedInvoiceIds
    .map((id) => invoices.find((inv) => inv.id === id)?.amountGross ?? 0)
    .reduce((sum, value) => sum + value, 0);
}

export function getDecisionBadgeClass(status: SepaOperationDecisionStatus) {
  switch (status) {
    case "approved":
      return "bg-success/15 text-success";
    case "rejected":
      return "bg-destructive/10 text-destructive";
    case "review":
      return "bg-warning/15 text-warning";
    default:
      return "bg-muted text-muted-foreground";
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

export function ensureDemoTransactions(input: BankTransaction[]): BankTransaction[] {
  const base = [...input];
  const existingIds = new Set(base.map((t) => t.id));

  const extra: BankTransaction[] = [
    {
      id: "txn-demo-mad-1",
      txnDate: "2026-03-22",
      label: "Chèque encaissé Client Nova",
      reference: "CHQ-2026-03-001",
      amount: 5000,
      reconciledStatus: "rapproché",
      counterparty: "Client Nova",
      statementId: "stmt-demo-mad",
      balance: 184550,
      ...({ currency: "MAD", accountCurrency: "MAD", accountName: "Compte exploitation MAD" } as any),
    } as BankTransaction,
    {
      id: "txn-demo-mad-2",
      txnDate: "2026-03-19",
      label: "Paiement carte Papeterie Rabat",
      reference: "CB-2026-03-19-001",
      amount: -850,
      reconciledStatus: "non_rapproché",
      counterparty: "Papeterie Rabat",
      statementId: "stmt-demo-mad",
      balance: 179550,
      ...({ currency: "MAD", accountCurrency: "MAD", accountName: "Compte exploitation MAD" } as any),
    } as BankTransaction,
    {
      id: "txn-demo-mad-3",
      txnDate: "2026-03-18",
      label: "Virement reçu Client Atlas",
      reference: "VIR-ENC-2026-03-18-001",
      amount: 25000,
      reconciledStatus: "rapproché",
      counterparty: "Client Atlas",
      statementId: "stmt-demo-mad",
      balance: 180400,
      ...({ currency: "MAD", accountCurrency: "MAD", accountName: "Compte exploitation MAD", matchedInvoiceIds: ["inv-demo-mad-sales-1","inv-demo-mad-sales-2","inv-demo-mad-sales-3"] } as any),
    } as BankTransaction,
    {
      id: "txn-demo-usd-1",
      txnDate: "2026-03-21",
      label: "Wire transfer AWS",
      reference: "WIRE-USD-2026-03-21-001",
      amount: -1200,
      reconciledStatus: "non_rapproché",
      counterparty: "AWS",
      statementId: "stmt-demo-usd",
      balance: 46800,
      ...({ currency: "USD", accountCurrency: "USD", accountName: "Compte international USD" } as any),
    } as BankTransaction,
    {
      id: "txn-demo-usd-2",
      txnDate: "2026-03-20",
      label: "Prélèvement Stripe Atlas USD",
      reference: "PRLV-USD-2026-03-20-001",
      amount: -340,
      reconciledStatus: "non_rapproché",
      counterparty: "Stripe Atlas",
      statementId: "stmt-demo-usd",
      balance: 48000,
      ...({ currency: "USD", accountCurrency: "USD", accountName: "Compte international USD" } as any),
    } as BankTransaction,
  ];

  const merged = [...base];
  for (const txn of extra) {
    if (!existingIds.has(txn.id)) merged.push(txn);
  }

  return merged.map((txn) => {
    if (isSepaBatch(txn)) {
      const batch = getSepaBatchForTransaction(txn);
      return {
        ...txn,
        label: "SEPA LOT — DÉCAISSEMENTS FOURNISSEURS",
        amount: -Math.abs(txn.amount || batch.operations.reduce((sum, op) => sum + op.amount, 0)),
        reconciledStatus: "non_rapproché" as const,
        matchedInvoiceIds: undefined,
        ...({ currency: "EUR", accountCurrency: "EUR", accountName: "Compte exploitation EUR" } as any),
      };
    }

    return txn;
  });
}

export function ensureDemoInvoices(input: Invoice[]): Invoice[] {
  const base = [...input];
  const existingIds = new Set(base.map((inv) => inv.id));

  const extra: Invoice[] = [
    {
      id: "inv-demo-mad-1",
      invoiceNumber: "FAC-MAD-2026-001",
      vendorCustomer: "Papeterie Rabat",
      invoiceDate: "2026-03-15",
      dueDate: "2026-03-20",
      amountGross: 850,
      type: "purchase",
      category: "Fournitures",
      status: "non_rapprochée",
      ...({ currency: "MAD" } as any),
    } as Invoice,
    {
      id: "inv-demo-mad-sales-1",
      invoiceNumber: "FAC-MAD-2026-007",
      vendorCustomer: "Client Atlas",
      invoiceDate: "2026-03-05",
      dueDate: "2026-03-18",
      amountGross: 8000,
      type: "sales",
      category: "Prestations",
      status: "rapprochée",
      ...({ currency: "MAD" } as any),
    } as Invoice,
    {
      id: "inv-demo-mad-sales-2",
      invoiceNumber: "FAC-MAD-2026-008",
      vendorCustomer: "Client Atlas",
      invoiceDate: "2026-03-06",
      dueDate: "2026-03-18",
      amountGross: 9000,
      type: "sales",
      category: "Prestations",
      status: "rapprochée",
      ...({ currency: "MAD" } as any),
    } as Invoice,
    {
      id: "inv-demo-mad-sales-3",
      invoiceNumber: "FAC-MAD-2026-009",
      vendorCustomer: "Client Atlas",
      invoiceDate: "2026-03-07",
      dueDate: "2026-03-18",
      amountGross: 8000,
      type: "sales",
      category: "Prestations",
      status: "rapprochée",
      ...({ currency: "MAD" } as any),
    } as Invoice,
    {
      id: "inv-demo-usd-1",
      invoiceNumber: "FAC-USD-2026-001",
      vendorCustomer: "AWS",
      invoiceDate: "2026-03-18",
      dueDate: "2026-03-21",
      amountGross: 1200,
      type: "purchase",
      category: "Cloud",
      status: "non_rapprochée",
      ...({ currency: "USD" } as any),
    } as Invoice,
    {
      id: "inv-demo-usd-2",
      invoiceNumber: "FAC-USD-2026-002",
      vendorCustomer: "Stripe Atlas",
      invoiceDate: "2026-03-18",
      dueDate: "2026-03-20",
      amountGross: 340,
      type: "purchase",
      category: "Abonnement",
      status: "non_rapprochée",
      ...({ currency: "USD" } as any),
    } as Invoice,
  ];

  const merged = [...base];
  for (const invoice of extra) {
    if (!existingIds.has(invoice.id)) merged.push(invoice);
  }
  return merged;
}
