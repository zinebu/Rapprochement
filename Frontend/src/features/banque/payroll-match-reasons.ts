import type { SepaBatchOperation } from "./types";

export type PayrollSlipIndexEntry = {
  employeeName: string;
  matricule?: string;
  sourceDocumentId: string;
  batchId: string;
  netPay?: number | null;
  iban?: string | null;
  periodLabel?: string | null;
};

function normalizeEmployeeName(value?: string | null) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIban(value?: string | null) {
  return String(value || "")
    .replace(/\s/g, "")
    .toUpperCase();
}

function nameTokens(name: string) {
  return normalizeEmployeeName(name)
    .split(" ")
    .filter((t) => t.length >= 2);
}

function namesMatch(a?: string | null, b?: string | null) {
  const na = normalizeEmployeeName(a);
  const nb = normalizeEmployeeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = nameTokens(na);
  const tb = nameTokens(nb);
  if (!ta.length || !tb.length) return false;
  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t)).length;
  const minLen = Math.min(ta.length, tb.length);
  return overlap >= minLen && overlap >= 2;
}

function amountsMatch(a: number, b: number, tolerance = 0.02) {
  const x = Math.round(Number(a || 0) * 100) / 100;
  const y = Math.round(Number(b || 0) * 100) / 100;
  return Math.abs(x - y) <= tolerance;
}

export type PayrollSlipAmountSummary = {
  sepaAmount: number;
  slipNet: number | null;
  diff: number | null;
  amountsMatch: boolean;
  currency: string;
};

/** Montants SEPA / bulletin (affichés à côté de la ligne, pas dans les raisons). */
export function getPayrollSlipAmountSummary(
  operation: Pick<SepaBatchOperation, "amount" | "currency">,
  slip: Pick<PayrollSlipIndexEntry, "netPay"> | null | undefined
): PayrollSlipAmountSummary {
  const sepaAmount = Number(operation.amount || 0);
  const currency = operation.currency || "EUR";
  const slipNet = slip?.netPay != null ? Number(slip.netPay) : null;
  const diff = slipNet != null ? Math.abs(sepaAmount - slipNet) : null;
  return {
    sepaAmount,
    slipNet,
    diff,
    amountsMatch: slipNet != null ? amountsMatch(sepaAmount, slipNet) : false,
    currency,
  };
}

export function getPayrollSlipAmountSummaryForOperation(
  operation: SepaBatchOperation,
  slipIndex: Record<string, PayrollSlipIndexEntry>,
  slipRef?: string | null
): PayrollSlipAmountSummary | null {
  const ref = slipRef || operation.payrollSlipRef;
  if (!ref) return null;
  const slip = slipIndex[ref];
  if (!slip) return null;
  return getPayrollSlipAmountSummary(operation, slip);
}

/** Raisons affichées pour un rapprochement SEPA salaire ↔ bulletin. */
export function buildPayrollSlipMatchReasons(
  operation: Pick<
    SepaBatchOperation,
    "amount" | "currency" | "creditorName" | "creditorIban" | "employeeId"
  >,
  slip: Pick<PayrollSlipIndexEntry, "employeeName" | "matricule" | "netPay" | "iban" | "periodLabel">
): string[] {
  const reasons: string[] = [];
  const opIban = normalizeIban(operation.creditorIban);
  const slipIban = normalizeIban(slip.iban);
  const opAmount = Number(operation.amount || 0);
  const slipNet = slip.netPay != null ? Number(slip.netPay) : null;

  if (opIban && slipIban && opIban === slipIban) {
    reasons.push("IBAN salarié identique");
  }
  if (namesMatch(operation.creditorName, slip.employeeName)) {
    reasons.push("Nom salarié cohérent");
  }
  const opEmpId = String(operation.employeeId || "").trim();
  const slipMat = String(slip.matricule || "").trim();
  if (opEmpId && slipMat && opEmpId === slipMat) {
    reasons.push("Matricule identique");
  }
  if (slip.periodLabel) {
    reasons.push(`Période bulletin : ${slip.periodLabel}`);
  }
  if (slipNet != null && amountsMatch(opAmount, slipNet)) {
    reasons.push("Montants identiques");
  }

  return reasons.slice(0, 5);
}

export function getPayrollSlipMatchReasonsForOperation(
  operation: SepaBatchOperation,
  slipIndex: Record<string, PayrollSlipIndexEntry>,
  slipRef?: string | null
): string[] {
  const ref = slipRef || operation.payrollSlipRef;
  if (!ref) return [];
  const slip = slipIndex[ref];
  if (!slip) {
    return Array.isArray(operation.payrollSlipMatchReasons)
      ? operation.payrollSlipMatchReasons.filter(
          (r) => !/^(Virement SEPA|Net bulletin|Écart)\s*:/.test(r)
        )
      : [];
  }
  return buildPayrollSlipMatchReasons(operation, slip);
}
