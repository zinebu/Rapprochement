import { COMPANY_IDENTITY } from "../config/company-identity.js";

function cleanValue(value) {
  if (!value) return null;
  return value.replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();
}

function normalize(value) {
  return (value || "")
    .toLowerCase()
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[\-–—]+/g, "-")
    .trim();
}

function normalizeText(text) {
  return (text || "")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function extractFirstMatch(text, regex) {
  const match = text.match(regex);
  return match ? cleanValue(match[1]) : null;
}

function splitLines(text) {
  return (text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseMoneyToNumber(value) {
  if (typeof value === "number") {
    return Number.isNaN(value) ? null : value;
  }

  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .replace(/\u00A0/g, " ")
    .replace(/\s/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function isOwnCompany(name = "", siret = "") {
  const normalizedName = normalize(name);
  const aliases = COMPANY_IDENTITY.aliases.map((a) => normalize(a));
  const byName = aliases.some((alias) => normalizedName.includes(alias));
  const bySiret =
    String(siret || "").replace(/\D/g, "") === COMPANY_IDENTITY.siret;

  return byName || bySiret;
}

function parseFrDate(value) {
  if (!value) return null;

  const m = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;

  const [, dd, mm, yyyy] = m;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));

  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateToFr(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());

  return `${dd}/${mm}/${yyyy}`;
}

function addDays(date, days) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const copy = new Date(date);
  copy.setDate(copy.getDate() + Number(days || 0));
  return copy;
}

function endOfMonth(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date, months) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + Number(months || 0));
  return copy;
}

function extractSiret(text) {
  const match = text.match(/\b\d{14}\b/);
  return match ? match[0] : null;
}

function extractSiren(text) {
  const match = text.match(/\b\d{9}\b/);
  return match ? match[0] : null;
}

function extractTaxNumber(text) {
  const match = text.match(/\bFR\s?\d{2}\s?\d{9}\b/i);
  return match ? cleanValue(match[0]) : null;
}

function extractInvoiceNumber(text) {
  return (
    extractFirstMatch(text, /Facture\s*N[°º]?\s*:\s*([A-Z0-9\-\/]+)/i) ||
    extractFirstMatch(text, /FACTURE\s*N[°º]?\s*([A-Z0-9\-\/]+)/i) ||
    extractFirstMatch(text, /N[°º]\s*de\s*facture\s*:\s*([A-Z0-9\-\/]+)/i)
  );
}

function extractDateAny(text) {
  return (
    extractFirstMatch(text, /Date\s*:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i) ||
    extractFirstMatch(text, /DATE\s*:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i) ||
    extractFirstMatch(
      text,
      /Date\s+Client\s+Page\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i
    ) ||
    extractFirstMatch(text, /\b([0-9]{2}\/[0-9]{2}\/[0-9]{4})\b/)
  );
}

function extractPaymentTerms(text) {
  if (!text) return null;

  const explicitLabel =
    extractFirstMatch(text, /Modalit[ée]s?\s+de\s+r[èe]glement\s*:\s*(.+)/i) ||
    extractFirstMatch(text, /Date d['’]échéance\s*:\s*(.+)/i);

  if (explicitLabel) return cleanValue(explicitLabel);

  if (/60\s+jours?\s+fin\s+de\s+mois/i.test(text)) return "60 jours fin de mois";
  if (/45\s+jours?\s+fin\s+de\s+mois/i.test(text)) return "45 jours fin de mois";
  if (/30\s+jours?/i.test(text)) return "30 jours";
  if (/comptant|paiement\s+imm[ée]diat|paiable\s+[àa]\s+r[ée]ception/i.test(text)) {
    return "comptant";
  }

  return null;
}

function looksLikeLatePenaltyClause(text) {
  if (!text) return false;

  return (
    /int[ée]r[êe]t\s+de\s+retard/i.test(text) ||
    /p[ée]nalit[ée]s?\s+de\s+retard/i.test(text) ||
    /indemnit[ée]\s+forfaitaire/i.test(text) ||
    /apr[èe]s\s+la\s+date\s+de\s+r[èe]glement\s+pr[ée]vu/i.test(text) ||
    /au-del[àa]\s+d['’]un\s+d[ée]lai/i.test(text)
  );
}

function extractDueDateAny(text, invoiceDateText = null) {
  const explicitDueDate =
    extractFirstMatch(
      text,
      /[ÉE]ch[ée]ance\s*:?\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i
    ) ||
    extractFirstMatch(
      text,
      /Date d['’]échéance\s*:?\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i
    ) ||
    extractFirstMatch(
      text,
      /Devise\s+[ÉE]ch[ée]ance.*?\n?EUR\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i
    );

  if (explicitDueDate) {
    return explicitDueDate;
  }

  const paymentTerms = extractPaymentTerms(text);
  const invoiceDate = parseFrDate(invoiceDateText);

  if (paymentTerms && invoiceDate) {
    const normalizedTerms = normalize(paymentTerms);

    if (/comptant|paiement immediat|paiable a reception/.test(normalizedTerms)) {
      return formatDateToFr(invoiceDate);
    }

    if (/60\s+jours?\s+fin\s+de\s+mois/.test(normalizedTerms)) {
      const eom = endOfMonth(invoiceDate);
      const due = addDays(eom, 60);
      return formatDateToFr(due);
    }

    if (/45\s+jours?\s+fin\s+de\s+mois/.test(normalizedTerms)) {
      const eom = endOfMonth(invoiceDate);
      const due = addDays(eom, 45);
      return formatDateToFr(due);
    }

    const daysMatch = normalizedTerms.match(/(\d+)\s+jours?/);
    if (daysMatch) {
      const due = addDays(invoiceDate, Number(daysMatch[1]));
      return formatDateToFr(due);
    }

    const monthsMatch = normalizedTerms.match(/(\d+)\s+mois/);
    if (monthsMatch) {
      const due = addMonths(invoiceDate, Number(monthsMatch[1]));
      return formatDateToFr(due);
    }
  }

  if (looksLikeLatePenaltyClause(text)) {
    return null;
  }

  return null;
}

function extractIban(text) {
  const match = text.match(/\bIBAN\s+([A-Z]{2}[0-9A-Z ]{10,})/i);
  return match
    ? cleanValue(match[1]).replace(/\s*[-–]\s*BIC.*$/i, "").trim()
    : null;
}

function extractSwift(text) {
  const match = text.match(/\bBIC[:\s]+([A-Z0-9]{8,11})\b/i);
  return match ? cleanValue(match[1]) : null;
}

function extractAmountNet(text) {
  return (
    extractFirstMatch(text, /H\.?T\.?\s*:\s*([0-9\s.,]+)/i) ||
    extractFirstMatch(text, /Total\s+HT\s*[:\-]?\s*([0-9\s.,]+)/i) ||
    extractFirstMatch(
      text,
      /Total\s+HT[\s\S]{0,30}?([0-9]{1,3}(?:\s[0-9]{3})*,[0-9]{2})/i
    )
  );
}

function extractVatAmount(text) {
  return (
    extractFirstMatch(text, /T\.?V\.?A\.?\s*:\s*([0-9\s.,]+)/i) ||
    extractFirstMatch(text, /Montant\s+TVA\s*[:\-]?\s*([0-9\s.,]+)/i)
  );
}

function extractAmountInclVat(text) {
  return (
    extractFirstMatch(
      text,
      /NET\s+A\s+PAYER\s+EURO[\s\S]{0,50}?([0-9]{1,3}(?:\s[0-9]{3})*,[0-9]{2})/i
    ) ||
    extractFirstMatch(text, /Total\s+TTC\s*[:\-]?\s*([0-9\s.,]+)/i) ||
    extractFirstMatch(
      text,
      /Total\s+TTC[\s\S]{0,30}?([0-9]{1,3}(?:\s[0-9]{3})*,[0-9]{2})/i
    )
  );
}

function extractRecipientFromClientLabel(text) {
  const match = text.match(
    /Date\s+Client\s+Page\s+[0-9]{2}\/[0-9]{2}\/[0-9]{4}\s+(.+?)\s+\d+\b/i
  );
  return match ? cleanValue(match[1]) : null;
}

function extractTopCompany(lines) {
  for (const line of lines.slice(0, 12)) {
    if (
      /facture|date|client|page|reference|montant|total|iban|bic|net a payer|devise|échéance/i.test(
        line
      )
    ) {
      continue;
    }

    if (line.length >= 3 && /[A-Za-z]/.test(line)) {
      return cleanValue(line);
    }
  }
  return null;
}

function extractFooterCompany(lines) {
  const reversed = [...lines].reverse();

  for (const line of reversed.slice(0, 12)) {
    if (
      /(siret|siren|rcs|tva|capital|boulevard|rue|avenue|paris|nanterre|iban|bic)/i.test(
        line
      )
    ) {
      continue;
    }

    if (line.length >= 3 && /[A-Za-z]/.test(line)) {
      return cleanValue(line);
    }
  }

  return null;
}

function findOwnCompanyLineIndex(lines) {
  const aliases = COMPANY_IDENTITY.aliases.map((a) => normalize(a));

  return lines.findIndex((line) => {
    const n = normalize(line);
    return aliases.some((alias) => n.includes(alias));
  });
}

function extractSiretNearCompany(lines, companyName) {
  if (!companyName) return null;

  const normalizedCompany = normalize(companyName);
  const index = lines.findIndex((line) =>
    normalize(line).includes(normalizedCompany)
  );

  if (index === -1) return null;

  const window = lines.slice(Math.max(0, index - 3), index + 4).join("\n");
  return extractSiret(window) || extractSiren(window);
}

function extractTaxNumberNearCompany(lines, companyName) {
  if (!companyName) return null;

  const normalizedCompany = normalize(companyName);
  const index = lines.findIndex((line) =>
    normalize(line).includes(normalizedCompany)
  );

  if (index === -1) return null;

  const window = lines.slice(Math.max(0, index - 3), index + 4).join("\n");
  return extractTaxNumber(window);
}

function detectParties(text) {
  const lines = splitLines(text);

  const ownIndex = findOwnCompanyLineIndex(lines);
  const explicitClient = extractRecipientFromClientLabel(text);
  const topCompany = extractTopCompany(lines);
  const footerCompany = extractFooterCompany(lines);

  let issuer = {
    name: null,
    siret: null,
    taxNumber: null,
    address: null,
  };

  let recipient = {
    name: null,
    siret: null,
    taxNumber: null,
    address: null,
  };

  if (explicitClient) {
    issuer.name = COMPANY_IDENTITY.canonicalName;
    issuer.siret = COMPANY_IDENTITY.siret;
    recipient.name = explicitClient;
  }

  if (!issuer.name && ownIndex >= 0) {
    recipient.name = cleanValue(lines[ownIndex]);
    recipient.siret = COMPANY_IDENTITY.siret;

    if (footerCompany && !isOwnCompany(footerCompany)) {
      issuer.name = footerCompany;
    } else if (topCompany && !isOwnCompany(topCompany)) {
      issuer.name = topCompany;
    }
  }

  if (!issuer.name && topCompany) {
    issuer.name = topCompany;
  }

  if (!recipient.name && explicitClient) {
    recipient.name = explicitClient;
  }

  issuer.siret =
    issuer.siret ||
    extractSiretNearCompany(lines, issuer.name) ||
    extractSiret(text) ||
    extractSiren(text);

  issuer.taxNumber =
    extractTaxNumberNearCompany(lines, issuer.name) || extractTaxNumber(text);

  recipient.siret =
    recipient.siret ||
    extractSiretNearCompany(lines, recipient.name) ||
    null;

  recipient.taxNumber =
    extractTaxNumberNearCompany(lines, recipient.name) || null;

  return { issuer, recipient };
}

export function extractInvoiceFieldsFromText(text) {
  if (!text || typeof text !== "string") return null;

  const normalized = normalizeText(text);

  const hasInvoiceHints =
    /facture|invoice|échéance|iban|bic|net a payer|total ttc|total ht/i.test(
      normalized
    );

  if (!hasInvoiceHints) return null;

  const parties = detectParties(normalized);

  let flow = "unknown";
  let counterpartyName = null;
  let counterpartyRole = null;

  if (isOwnCompany(parties.issuer.name, parties.issuer.siret)) {
    flow = "sales";
    counterpartyName = parties.recipient.name;
    counterpartyRole = "client";
  } else if (isOwnCompany(parties.recipient.name, parties.recipient.siret)) {
    flow = "purchase";
    counterpartyName = parties.issuer.name;
    counterpartyRole = "supplier";
  }

  const invoiceDate = extractDateAny(normalized);
  const dueDate = extractDueDateAny(normalized, invoiceDate);

  const parsedAmountNet = parseMoneyToNumber(extractAmountNet(normalized));
  const parsedVatAmount = parseMoneyToNumber(extractVatAmount(normalized));
  const parsedAmountInclVat = parseMoneyToNumber(
    extractAmountInclVat(normalized)
  );

  console.log("DEBUG invoice-parser:", {
    invoiceNumber: extractInvoiceNumber(normalized),
    amountNet: parsedAmountNet,
    vatAmount: parsedVatAmount,
    amountInclVat: parsedAmountInclVat,
  });

  return {
    documentType: "invoice",

    issuer: parties.issuer,
    recipient: parties.recipient,

    vendorCustomer: counterpartyName,
    counterpartyRole,

    invoiceNumber: extractInvoiceNumber(normalized),
    invoiceDate,
    dueDate,

    vatNumber: extractTaxNumber(normalized),
    iban: extractIban(normalized),
    swift: extractSwift(normalized),
    reasonOfPayment: extractInvoiceNumber(normalized),

    amountNet: parsedAmountNet,
    vatAmount: parsedVatAmount,
    amountInclVat: parsedAmountInclVat,

    invoiceNature: flow,
  };
  
}
export function scoreInvoiceExtraction(fields) {
  let score = 0;
  if (fields?.invoiceNumber) score += 1;
  if (fields?.invoiceDate) score += 1;
  if (fields?.amountInclVat != null) score += 1;
  if (fields?.issuer?.name) score += 1;
  if (fields?.recipient?.name) score += 1;
  if (fields?.invoiceNature && fields.invoiceNature !== "unknown") score += 1;
  return score;
}