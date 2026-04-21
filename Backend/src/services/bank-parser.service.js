function cleanText(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
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

function detectCounterpartyFromBlock(block) {
  // First try to extract from specific fields - more aggressive patterns
  const candidates = [
    /Infos compl\. : Debiteur:\s*([A-Z][A-Za-z\s&\-\.]{2,}?)(?=\s+Infos|\.|\s*$)/i,
    /Infos compl\. : Beneficiaire:\s*([A-Z][A-Za-z\s&\-\.]{2,}?)(?=\s+Infos|\.|\s*$)/i,
    /Infos compl\. : Ultimate Creditor:\s*([A-Z][A-Za-z\s&\-\.]{2,}?)(?=\s+Infos|\.|\s*$)/i,
  ];
  
  for (const rx of candidates) {
    const m = block.match(rx);
    if (m) return cleanText(m[1]);
  }
  
  // Try to extract company name at the beginning of the block
  const startPatterns = [
    /^([A-Z][A-Za-z\s&\-\.]{3,}?)(?=\s+(?:NN|REF|ID|Mandat|RCUR|Infos|3\d))/i,
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i, // Multiple word company names
    /^([A-Z][A-Z\s]+){2,}/i, // All caps company names
  ];
  
  for (const pattern of startPatterns) {
    const m = block.match(pattern);
    if (m) return cleanText(m[1]);
  }
  
  return null;
}

function extractCleanLabel(rawLabel, bankOperationType, trailingDetails) {
  const fullText = `${rawLabel} ${bankOperationType} ${trailingDetails}`.trim();
  
  // Try to extract meaningful information patterns
  const patterns = [
    // SEPA patterns
    /(?:SEPA|PRLV|VIR)\s*[:\-]?\s*([A-Z][A-Za-z\s&\-\.]+?)(?:\s+(?:Mandat|Ref|ID|NN\d+)|$)/i,
    /([A-Z][A-Za-z\s&\-\.]{3,}?)(?:\s+Mandat:|NN\d+|$)/i,
    
    // Company name patterns (usually followed by codes/refs)
    /^([A-Z][A-Za-z\s&\-\.]{3,}?)(?:\s+[A-Z]{2}\d+|\s+NN\d+|\s+Mandat:|\s+RCUR|$)/i,
    
    // Clean patterns that look like company names
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
    
    // Remove common prefixes
    /^(?:VIR|PRLV|SEPA|CB|CARTE)\s*(?:[A-Z]{2}\d+\s*)?(.+?)\s*(?:Mandat|Ref|ID|NN\d+|$)/i,
  ];
  
  for (const pattern of patterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      let cleanName = cleanText(match[1]);
      
      // Clean up common artifacts
      cleanName = cleanName
        .replace(/\s+(?:Mandat|RCUR|Infos|compl|Ultimate|Creditor|Debiteur|Beneficiaire).*$/i, '')
        .replace(/\s+[A-Z]{2}\d+[A-Z]*.*$/, '') // Remove references like NN753184902DDGFI
        .replace(/\s+NN\d+.*$/, '') // Remove NN numbers
        .replace(/\s+REF\s*:.*$/i, '') // Remove REF fields
        .replace(/\s+ID\s*:.*$/i, '') // Remove ID fields
        .replace(/\s+$/, '') // Remove trailing spaces
        .trim();
      
      if (cleanName.length >= 3 && cleanName.length <= 50) {
        return cleanName;
      }
    }
  }
  
  // Fallback: extract first meaningful words
  const words = fullText.split(/\s+/).filter(word => 
    word.length > 2 && 
    !/^(NN|REF|ID|Mandat|RCUR|Infos|compl|Ultimate|Creditor|Debiteur|Beneficiaire)$/i.test(word) &&
    !/^[A-Z]{2}\d+[A-Z]*$/.test(word)
  );
  
  if (words.length > 0) {
    return words.slice(0, 3).join(' ').substring(0, 50);
  }
  
  // Last resort: return a cleaned version but limit length
  return cleanText(rawLabel.substring(0, 50));
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
    /(\d{2}\/\d{2}\/\d{4})\s+([0-9A-Z]+)\s+([\s\S]*?)\s+(\d{2}\/\d{2}\/\d{4})\s+((?:05|06|62|72|B2)\s*-\s*[\s\S]*?)\s+([0-9]{1,3}(?:\s[0-9]{3})*,[0-9]{2})([\s\S]*?)(?=(?:\d{2}\/\d{2}\/\d{4}\s+[0-9A-Z]+)|TOTAL\b|$)/gi;

  for (const match of normalized.matchAll(operationRegex)) {
    const txnDate = normalizeDateToIso(match[1]);
    const piece = cleanText(match[2]);
    const rawLabel = cleanText(match[3]);
    const valueDate = normalizeDateToIso(match[4]);
    const bankOperationType = cleanText(match[5]);
    const amount = parseFrAmount(match[6]);
    const trailingDetails = cleanText(match[7]);

    if (amount == null) continue;
    // Ignore header false-positives like "DU ... AU ..." matched as an operation.
    if (!/^\d{5,}$/.test(piece)) continue;

    let signedAmount = -Math.abs(amount);
    if (/Vir\.\s*re[çc]u/i.test(bankOperationType)) signedAmount = Math.abs(amount);
    if (/[Ee][ch][ée]ance\s*cr[ée]dits?/i.test(bankOperationType)) {
      signedAmount = -Math.abs(amount);
    }

    const operationType = signedAmount >= 0 ? "encaissement" : "decaissement";
    const paymentMethod = inferPaymentMethod(rawLabel, bankOperationType);
    const refMatch = rawLabel.match(/\/\s*([A-Z0-9._-]+)$/i);
    const detailBlock = `${rawLabel}\n${bankOperationType}\n${trailingDetails}`;
    
    // Extract clean label for better display
    const cleanLabel = extractCleanLabel(rawLabel, bankOperationType, trailingDetails);

    operations.push({
      id: `scanned-${txnDate || "date"}-${piece}`,
      txnDate,
      valueDate,
      label: cleanLabel,
      rawLabel: rawLabel, // Keep original for reference
      reference: refMatch ? cleanText(refMatch[1]) : piece,
      amount: signedAmount,
      currency: (currencyMatch?.[1] || "EUR").toUpperCase(),
      operationType,
      paymentMethod,
      bankOperationType,
      counterpartyName: detectCounterpartyFromBlock(detailBlock),
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

  const operations = txList.map((tx, index) => {
    const amountNode = tx.Amt?.InstdAmt || {};
    const amount = Number(amountNode["#text"] ?? amountNode ?? 0) || 0;
    const creditorName = cleanText(tx.Cdtr?.Nm || "");
    const creditorIban = cleanText(tx.CdtrAcct?.Id?.IBAN || "");
    const creditorBic = cleanText(tx.CdtrAgt?.FinInstnId?.BICFI || tx.CdtrAgt?.FinInstnId?.BIC || "");
    const endToEndId = cleanText(tx.PmtId?.EndToEndId || `${paymentInfoId}-${index + 1}`);
    const remittanceInfo = cleanText(tx.RmtInf?.Ustrd || tx.RmtInf?.Strd?.RfrdDocInf?.Nb || "");

    return {
      id: `${paymentInfoId}-line-${index + 1}`,
      creditorName,
      creditorIban,
      creditorBic: creditorBic || null,
      amount,
      currency: cleanText(amountNode?.["@_Ccy"] || currency || "EUR"),
      endToEndId,
      remittanceInfo,
    };
  });

  if (!operations.length && !/pain\.001|sepa/i.test(rawText)) {
    return null;
  }

  const totalAmount = operations.reduce((sum, op) => sum + (Number(op.amount) || 0), 0);

  return {
    documentType: "sepa_xml",
    sepaBatch: {
      id: paymentInfoId,
      type: "invoice",
      label: `SEPA scanné — ${paymentInfoId}`,
      executionDate: executionDate || null,
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
      amount: -Math.abs(totalAmount),
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
