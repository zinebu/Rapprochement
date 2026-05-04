import { COMPANY_IDENTITY } from "../config/company-identity.js";

function cleanText(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFrAmount(value) {
  if (!value) return null;
  const normalized = String(value)
    .replace(/\u00A0/g, " ")
    .replace(/€/g, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeDateToIso(frDate) {
  const m = String(frDate || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function inferPaymentMethod(label = "", opType = "") {
  const hay = `${label} ${opType}`.toLowerCase();
  if (hay.includes("sepa")) return "SEPA";
  if (hay.includes("prél") || hay.includes("prelev")) return "PRELEVEMENT";
  if (hay.includes("chèque") || hay.includes("cheque")) return "CHEQUE";
  if (hay.includes("carte") || hay.includes("cb")) return "CARTE";
  if (hay.includes("vir")) return "VIREMENT";
  return "AUTRE";
}

function inferSignedAmount(amount, bankOperationType = "", label = "", trailingDetails = "", rawAmountText = "") {
  const absAmount = Math.abs(Number(amount) || 0);
  const hay = normalize(`${bankOperationType} ${label} ${trailingDetails}`);
  const raw = String(rawAmountText || "").replace(/\s/g, "");

  // Explicit sign on extracted amount has highest priority.
  if (/^-/.test(raw)) return -absAmount;
  if (/^\+/.test(raw)) return absAmount;

  // Strong outgoing markers (supplier transfer remittance, card/fees/debit/prelevement).
  const outgoingStrong =
    /\brem\s+vir\s+sepa\b/i.test(hay) ||
    /\bfourn(?:isseur)?\b/i.test(hay) ||
    /\bvir\.?\s*[eé]mis\b/i.test(hay) ||
    /\bvirement\s+sortant\b/i.test(hay) ||
    /\bpr[eé]l[eè]v/i.test(hay) ||
    /\bcb\b|\bcarte\b|\bfrais\b|\bcommission\b|\bd[eé]bit\b|\bdebit\b|\bpaiement\b/i.test(hay) ||
    /[Ee][ch][ée]ance\s*cr[ée]dits?/i.test(hay);

  // Incoming markers.
  const incomingStrong =
    /\bvir\.?\s*re[çc]u\b/i.test(hay) ||
    /\bvirement\s+entrant\b/i.test(hay) ||
    /\bencaissement\b/i.test(hay) ||
    /\bversement\b/i.test(hay) ||
    /\bremise\b/i.test(hay) ||
    /\bcr[ée]dit\b|\bcredit\b/i.test(hay);

  if (outgoingStrong && !incomingStrong) return -absAmount;
  if (incomingStrong && !outgoingStrong) return absAmount;

  // Conservative default: outgoing for unknown transfer-like operations.
  return -absAmount;
}

function isOwnCompanyName(name) {
  const n = normalize(name);
  const aliases = (COMPANY_IDENTITY?.aliases || []).map(normalize);
  return aliases.some((a) => n.includes(a));
}

function trimAtKnownLabels(value) {
  return cleanText(value).split(
    /\b(?:Debiteur|Beneficiaire|Ultimate Creditor|Mandat|ORGID|Reference|Ref Remise|Info Compl|Libelle|Id Beneficiaire)\s*:/i
  )[0];
}

function extractBankMeta(block) {
  const meta = {
    debtor: null,
    beneficiary: null,
    ultimateCreditor: null,
    mandate: null,
    orgId: null,
    reference: null,
    remittanceRef: null,
    info: null,
    libelle: null,
  };

  const parts = String(block || "")
    .split(/Infos compl\.\s*:\s*/i)
    .map((p) => cleanText(p))
    .filter(Boolean);

  for (const part of parts) {
    const value = trimAtKnownLabels(part);
    if (/^Debiteur\s*:/i.test(part)) meta.debtor = trimAtKnownLabels(part.replace(/^Debiteur\s*:/i, ""));
    else if (/^Beneficiaire\s*:/i.test(part)) meta.beneficiary = trimAtKnownLabels(part.replace(/^Beneficiaire\s*:/i, ""));
    else if (/^Ultimate Creditor\s*:/i.test(part)) meta.ultimateCreditor = trimAtKnownLabels(part.replace(/^Ultimate Creditor\s*:/i, ""));
    else if (/^Mandat\s*:/i.test(part)) meta.mandate = trimAtKnownLabels(part.replace(/^Mandat\s*:/i, ""));
    else if (/^ORGID\s*:/i.test(part)) meta.orgId = trimAtKnownLabels(part.replace(/^ORGID\s*:/i, ""));
    else if (/^Reference\s*:/i.test(part)) meta.reference = trimAtKnownLabels(part.replace(/^Reference\s*:/i, ""));
    else if (/^Ref Remise\s*:/i.test(part)) meta.remittanceRef = trimAtKnownLabels(part.replace(/^Ref Remise\s*:/i, ""));
    else if (/^Info Compl\s*:/i.test(part)) meta.info = trimAtKnownLabels(part.replace(/^Info Compl\s*:/i, ""));
    else if (/^Libelle\s*:/i.test(part)) meta.libelle = trimAtKnownLabels(part.replace(/^Libelle\s*:/i, ""));
    else if (!meta.info && value) meta.info = value;
  }

  return meta;
}

function extractCounterpartyFromLabel(label) {
  const cleaned = cleanText(label);
  const slashMatch = cleaned.match(/\/\s*([A-Z0-9 ._-]{3,})$/i);
  if (slashMatch) return cleanText(slashMatch[1]);
  return null;
}

function resolveCounterpartyName(operationType, meta, label) {
  const ordered =
    operationType === "encaissement"
      ? [meta?.debtor, meta?.ultimateCreditor, meta?.beneficiary]
      : [meta?.beneficiary, meta?.ultimateCreditor, meta?.debtor];

  const firstNonOwn = ordered.find((v) => v && !isOwnCompanyName(v));
  const base = cleanText(firstNonOwn || ordered.find(Boolean) || "");
  if (base && !isOwnCompanyName(base)) return base;
  const fromLabel = extractCounterpartyFromLabel(label);
  const resolved = cleanText(fromLabel || base || "");
  if (!resolved || isOwnCompanyName(resolved)) return null;
  return resolved;
}

function parseBankStatementFromText(text, fallbackFileName = "") {
  const normalized = String(text || "").replace(/\r/g, "\n");
  if (
    !/EXTRAIT DE COMPTE|RELEV[EÉ]/i.test(normalized) &&
    !/solde cr[ée]diteur/i.test(normalized)
  ) {
    return null;
  }

  const fromToMatch = normalized.match(
    /EXTRAIT DE COMPTE DU\s+(\d{2}\/\d{2}\/\d{4})\s+AU\s+(\d{2}\/\d{2}\/\d{4})/i
  );
  const bankMatch = normalized.match(/Banque\s*:\s*(.+)/i);
  const ibanMatch = normalized.match(/Num[eé]ro\s*:\s*([A-Z]{2}[0-9A-Z ]{10,})\s+Devise/i);
  const bicMatch = normalized.match(/BIC\s*:\s*([A-Z0-9]{8,11})/i);
  const currencyMatch = normalized.match(/Devise\s*:\s*([A-Z]{3})/i);
  const companyMatch = normalized.match(/Soci[ée]t[ée]\s*:\s*(.+)\s+Banque\s*:/i);
  const openingMatch = normalized.match(/Solde créditeur au .*?\s([0-9 ]+,[0-9]{2})\s*€/i);
  const closingMatch = normalized.match(/Solde créditeur au .*?\s([0-9 ]+,[0-9]{2})\s*€/gi);

  const operations = [];
  const operationRegex =
    /(\d{2}\/\d{2}\/\d{4})\s+([0-9A-Z]+)\s+([\s\S]*?)\s+(\d{2}\/\d{2}\/\d{4})\s+((?:05|06|62|72|B2)\s*-\s*[\s\S]*?)\s+([+-]?\s*[0-9]{1,3}(?:\s[0-9]{3})*,[0-9]{2})([\s\S]*?)(?=(?:\d{2}\/\d{2}\/\d{4}\s+[0-9A-Z]+)|TOTAL\b|$)/gi;

  for (const match of normalized.matchAll(operationRegex)) {
    const txnDate = normalizeDateToIso(match[1]);
    const piece = cleanText(match[2]);
    const rawLabel = cleanText(match[3]);
    const valueDate = normalizeDateToIso(match[4]);
    const bankOperationType = cleanText(match[5]);
    const rawAmountText = cleanText(match[6]);
    const amount = parseFrAmount(rawAmountText);
    const trailingDetails = cleanText(match[7]);

    if (amount == null) continue;
    // Ignore header false-positives like "DU ... AU ..." matched as an operation.
    if (!/^\d{5,}$/.test(piece)) continue;

    const signedAmount = inferSignedAmount(
      amount,
      bankOperationType,
      rawLabel,
      trailingDetails,
      rawAmountText
    );

    const operationType = signedAmount >= 0 ? "encaissement" : "decaissement";
    const paymentMethod = inferPaymentMethod(rawLabel, bankOperationType);
    const refMatch = rawLabel.match(/\/\s*([A-Z0-9._-]+)$/i);
    const detailBlock = `${rawLabel}\n${bankOperationType}\n${trailingDetails}`;
    const bankMeta = extractBankMeta(detailBlock);
    const counterpartyName =
      resolveCounterpartyName(operationType, bankMeta, rawLabel) || null;

    operations.push({
      id: `scanned-${txnDate || "date"}-${piece}`,
      txnDate,
      valueDate,
      label: rawLabel,
      reference: refMatch ? cleanText(refMatch[1]) : piece,
      amount: signedAmount,
      currency: (currencyMatch?.[1] || "EUR").toUpperCase(),
      operationType,
      paymentMethod,
      bankOperationType,
      counterpartyName,
      bankMeta,
      source: "scanned",
    });
  }

  return {
    documentType: "bank_statement",
    account: {
      bankName: bankMatch ? cleanText(bankMatch[1]) : null,
      companyName: companyMatch ? cleanText(companyMatch[1]) : null,
      iban: ibanMatch ? cleanText(ibanMatch[1]) : null,
      bic: bicMatch ? cleanText(bicMatch[1]) : null,
      currency: (currencyMatch?.[1] || "EUR").toUpperCase(),
      statementFrom: fromToMatch ? normalizeDateToIso(fromToMatch[1]) : null,
      statementTo: fromToMatch ? normalizeDateToIso(fromToMatch[2]) : null,
      openingBalance: parseFrAmount(openingMatch?.[1] || null),
      closingBalance: closingMatch?.length
        ? parseFrAmount(
            cleanText(closingMatch[closingMatch.length - 1]).replace(
              /^.*?([0-9 ]+,[0-9]{2}).*$/i,
              "$1"
            )
          )
        : null,
      sourceName: fallbackFileName || null,
    },
    operations,
    summarizedOperation:
      operations.length === 0
        ? {
            id: `scanned-bank-${Date.now()}`,
            txnDate: fromToMatch ? normalizeDateToIso(fromToMatch[2]) : null,
            label: `Relevé bancaire scanné (${fallbackFileName || "document"})`,
            reference: fallbackFileName || "releve-scan",
            amount: 0,
            currency: (currencyMatch?.[1] || "EUR").toUpperCase(),
            operationType: "encaissement",
            paymentMethod: "AUTRE",
            counterpartyName: companyMatch ? cleanText(companyMatch[1]) : "Relevé bancaire",
            source: "scanned",
          }
        : null,
  };
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function get(node, path) {
  let current = node;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = current[key];
  }
  return current ?? null;
}

function parseSepaXml(structuredXml, rawText = "", fallbackFileName = "") {
  const root =
    get(structuredXml, ["Document", "CstmrCdtTrfInitn"]) ||
    get(structuredXml, ["CstmrCdtTrfInitn"]) ||
    null;
  if (!root) return null;

  const pmtInf = toArray(root.PmtInf)[0] || {};
  const txList = toArray(pmtInf.CdtTrfTxInf);
  const paymentInfoId = cleanText(pmtInf.PmtInfId || root.GrpHdr?.MsgId || fallbackFileName || "SEPA");
  const debtorName = cleanText(pmtInf.Dbtr?.Nm || "");
  const debtorIban = cleanText(pmtInf.DbtrAcct?.Id?.IBAN || "");
  const executionDate = cleanText(pmtInf.ReqdExctnDt || root.GrpHdr?.CreDtTm || "").slice(0, 10);
  const currency = cleanText(pmtInf.DbtrAcct?.Ccy || "EUR").toUpperCase() || "EUR";
  const ctrlSumRaw = pmtInf.CtrlSum ?? root.GrpHdr?.CtrlSum ?? null;
  const ctrlSum = Number(ctrlSumRaw);
  const nbOfTxsRaw = pmtInf.NbOfTxs ?? root.GrpHdr?.NbOfTxs ?? txList.length;
  const nbOfTxs = Number(nbOfTxsRaw);

  const operations = txList.map((tx, index) => {
    const amountNode = tx.Amt?.InstdAmt || {};
    const amount = Number(amountNode["#text"] ?? amountNode ?? 0) || 0;
    const creditorName = cleanText(tx.Cdtr?.Nm || "");
    const creditorIban = cleanText(tx.CdtrAcct?.Id?.IBAN || "");
    const creditorBic = cleanText(tx.CdtrAgt?.FinInstnId?.BICFI || tx.CdtrAgt?.FinInstnId?.BIC || "");
    const endToEndId = cleanText(tx.PmtId?.EndToEndId || `${paymentInfoId}-${index + 1}`);
    const instrId = cleanText(tx.PmtId?.InstrId || "");
    const remittanceInfo = cleanText(tx.RmtInf?.Ustrd || tx.RmtInf?.Strd?.RfrdDocInf?.Nb || "");

    return {
      id: `${paymentInfoId}-line-${index + 1}`,
      creditorName,
      creditorIban,
      creditorBic: creditorBic || null,
      amount,
      currency: cleanText(amountNode?.["@_Ccy"] || currency || "EUR"),
      instrId: instrId || null,
      endToEndId,
      remittanceInfo,
    };
  });

  if (!operations.length && !/pain\.001|sepa/i.test(rawText)) {
    return null;
  }

  const totalAmount = operations.reduce((sum, op) => sum + (Number(op.amount) || 0), 0);
  const ctrlOrSum = Number.isNaN(ctrlSum) ? totalAmount : ctrlSum;

  return {
    documentType: "sepa_xml",
    sepaBatch: {
      id: paymentInfoId,
      type: "invoice",
      label: `SEPA scanné — ${paymentInfoId}`,
      executionDate: executionDate || null,
      totalAmount: ctrlOrSum,
      numberOfTransactions: Number.isNaN(nbOfTxs) ? operations.length : nbOfTxs,
      debtorName: debtorName || null,
      debtorIban: debtorIban || null,
      debtorCurrency: currency,
      operations,
    },
    summarizedOperation: {
      id: `scanned-sepa-${paymentInfoId}`,
      txnDate: executionDate || null,
      label: `SEPA XML ${paymentInfoId}`,
      reference: paymentInfoId,
      amount: -Math.abs(ctrlOrSum),
      currency,
      operationType: "decaissement",
      paymentMethod: "SEPA",
      counterpartyName: debtorName || "SEPA",
      source: "scanned",
    },
  };
}

export function extractBankOrSepaData({
  extractedText,
  mimeType,
  originalName,
  extractedStructuredData,
}) {
  const name = String(originalName || "").toLowerCase();

  if (
    mimeType === "application/xml" ||
    mimeType === "text/xml" ||
    name.endsWith(".xml")
  ) {
    return parseSepaXml(extractedStructuredData, extractedText, originalName);
  }

  return parseBankStatementFromText(extractedText, originalName);
}
