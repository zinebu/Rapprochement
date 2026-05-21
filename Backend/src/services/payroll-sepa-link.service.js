/**
 * Rapproche les lignes d'un fichier SEPA salaires avec les fiches du module Bulletins de paie.
 */

function normalizeEmployeeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIban(value) {
  return String(value || "")
    .replace(/\s/g, "")
    .toUpperCase();
}

function nameTokens(name) {
  return normalizeEmployeeName(name)
    .split(" ")
    .filter((t) => t.length >= 2);
}

function namesMatch(a, b) {
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

function amountsMatch(a, b, tolerance = 0.02) {
  const x = Math.round(Number(a || 0) * 100) / 100;
  const y = Math.round(Number(b || 0) * 100) / 100;
  return Math.abs(x - y) <= tolerance;
}

/**
 * @param {Array<{ structuredData?: { payrollBatch?: object }, _id?: string, id?: string }>} documents
 */
export function listPayrollBatchesFromDocuments(documents = []) {
  const batches = [];
  for (const doc of documents) {
    const batch = doc?.structuredData?.payrollBatch;
    if (!batch || !Array.isArray(batch.slips) || batch.slips.length === 0) continue;
    const docId = String(doc._id?.toString?.() || doc.id || "");
    batches.push({
      ...batch,
      sourceDocumentId: docId,
    });
  }
  return batches;
}

export function buildPayrollSlipMatchReasons(operation, slip, batch = null) {
  const reasons = [];
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
  const periodLabel = batch?.periodLabel || slip.periodLabel;
  if (periodLabel) {
    reasons.push(`Période bulletin : ${periodLabel}`);
  }
  if (slipNet != null && amountsMatch(opAmount, slipNet)) {
    reasons.push("Montants identiques");
  }

  return reasons.slice(0, 5);
}

function findSlipForOperation(operation, payrollBatches) {
  const opIban = normalizeIban(operation.creditorIban);
  const opAmount = Number(operation.amount || 0);
  const opName = operation.creditorName || "";

  let best = null;
  let bestScore = 0;

  for (const batch of payrollBatches) {
    const docId = batch.sourceDocumentId || null;
    for (const slip of batch.slips || []) {
      const slipIban = normalizeIban(slip.iban);
      const slipNet = slip.netPay;
      const slipName = slip.employeeName || "";

      let score = 0;
      if (opIban && slipIban && opIban === slipIban) score += 50;
      if (amountsMatch(opAmount, slipNet)) score += 40;
      if (namesMatch(opName, slipName)) score += 30;

      if (score > bestScore) {
        bestScore = score;
        best = { slip, batch, docId, score };
      }
    }
  }

  if (!best || bestScore < 70) return null;

  return {
    ...best,
    reasons: buildPayrollSlipMatchReasons(operation, best.slip, best.batch),
  };
}

function inferPayrollBatchLink(sepaBatch, payrollBatches, linkedOps) {
  const remittance = String(sepaBatch?.operations?.[0]?.remittanceInfo || "");
  const periodFromRemittance = remittance.match(/PAIE-(\d{4})(\d{2})/i);
  const periodLabel =
    sepaBatch?.periodLabel ||
    (periodFromRemittance ? `${periodFromRemittance[2]}/${periodFromRemittance[1]}` : null);

  if (periodLabel) {
    const hit = payrollBatches.find((b) => b.periodLabel === periodLabel);
    if (hit) {
      return {
        payrollBatchId: hit.id,
        payrollBatchDocumentId: hit.sourceDocumentId,
        periodLabel,
      };
    }
  }

  const docIds = new Set(linkedOps.map((o) => o.payrollSlipDocumentId).filter(Boolean));
  if (docIds.size === 1) {
    const docId = [...docIds][0];
    const hit = payrollBatches.find((b) => b.sourceDocumentId === docId);
    if (hit) {
      return {
        payrollBatchId: hit.id,
        payrollBatchDocumentId: hit.sourceDocumentId,
        periodLabel: hit.periodLabel || periodLabel,
      };
    }
  }

  return { payrollBatchId: null, payrollBatchDocumentId: null, periodLabel };
}

/**
 * @param {object} sepaBatch
 * @param {Array} payrollBatches
 */
export function linkPayrollSepaBatch(sepaBatch, payrollBatches = []) {
  if (!sepaBatch || sepaBatch.type !== "payroll" || !Array.isArray(sepaBatch.operations)) {
    return sepaBatch;
  }
  if (!payrollBatches.length) return sepaBatch;

  const operations = sepaBatch.operations.map((op) => {
    const hit = findSlipForOperation(op, payrollBatches);
    if (!hit) return op;
    const { slip, docId, reasons } = hit;
    return {
      ...op,
      payrollSlipRef: slip.id,
      payrollSlipDocumentId: docId,
      employeeId: slip.matricule || null,
      employeeName: slip.employeeName || op.creditorName,
      payrollSlipMatchReasons: reasons,
    };
  });

  const batchMeta = inferPayrollBatchLink(
    { ...sepaBatch, operations },
    payrollBatches,
    operations
  );

  return {
    ...sepaBatch,
    ...batchMeta,
    operations,
    linkedSlipCount: operations.filter((o) => o.payrollSlipRef).length,
  };
}

export function isPayrollSepaContent({ root, pmtInf, rawText = "" }) {
  const hay = [
    root?.GrpHdr?.MsgId,
    pmtInf?.PmtInfId,
    pmtInf?.Dbtr?.Nm,
    rawText,
  ]
    .concat(
      (Array.isArray(pmtInf?.CdtTrfTxInf) ? pmtInf.CdtTrfTxInf : [pmtInf?.CdtTrfTxInf])
        .filter(Boolean)
        .flatMap((tx) => [tx?.RmtInf?.Ustrd, tx?.Cdtr?.Nm])
    )
    .filter(Boolean)
    .join(" ");

  return (
    /\bsalaires?\b/i.test(hay) ||
    /\bpaie\b/i.test(hay) ||
    /\bpayroll\b/i.test(hay) ||
    /\bPAIE-\d{6}/i.test(hay) ||
    /MsgId[^<]*Salaires/i.test(rawText)
  );
}
