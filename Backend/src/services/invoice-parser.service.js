import { COMPANY_IDENTITY } from "../config/company-identity.js";

function cleanValue(value) {
  if (!value) return null;
  return value.replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();
}

function sanitizePartyName(value) {
  const raw = cleanValue(String(value || ""));
  if (!raw) return null;

  // Cut noisy OCR tails that often contain amounts/addresses/legal text.
  const cut = raw
    .split(
      /\b(?:total|montant|tva|siret|siren|iban|bic|swift|r[èe]glement|date|facture|n[°º]|t[ée]l|email|@|adresse|page)\b/i
    )[0]
    .trim();

  // Keep only plausible company/person name characters.
  const cleaned = cut.replace(/[^A-Za-zÀ-ÿ0-9&'().,\-\/ ]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  // Avoid absurdly long names coming from OCR block concatenation.
  if (cleaned.length > 90) return cleaned.slice(0, 90).trim();
  return cleaned;
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

/** Returns true only for the MAIN company (CONSULT HIGHTECH), NOT for related entities. */
function isOwnCompany(name = "", siret = "") {
  const cleanSiret = String(siret || "").replace(/\D/g, "");

  if (cleanSiret && cleanSiret === COMPANY_IDENTITY.siret) return true;

  const normalizedName = normalize(name);
  if (!normalizedName) return false;

  return COMPANY_IDENTITY.aliases.map((a) => normalize(a)).some((alias) => {
    if (normalizedName === alias) return true;
    const escaped = alias.replace(/[-]/g, "[-\\s]?");
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalizedName);
  });
}

/**
 * Returns the related entity config { name, siret } if the given name/siret
 * matches one of the declared relatedEntities, otherwise null.
 */
function findRelatedEntity(name = "", siret = "") {
  const entities = COMPANY_IDENTITY.relatedEntities || [];
  const cleanSiret = String(siret || "").replace(/\D/g, "");
  const normalizedName = normalize(name);

  return entities.find((e) => {
    if (cleanSiret && cleanSiret === e.siret) return true;
    if (!normalizedName) return false;
    return (e.aliases || [e.name]).map((a) => normalize(a)).some((alias) => {
      if (normalizedName === alias) return true;
      const escaped = alias.replace(/[-]/g, "[-\\s]?");
      return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalizedName);
    });
  }) || null;
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
  return match ? sanitizePartyName(match[1]) : null;
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
      return sanitizePartyName(line);
    }
  }
  return null;
}

/**
 * Scan lines to find a company name that is NOT our own company.
 * Searches wider than extractTopCompany (up to 30 lines) and explicitly
 * skips lines that match COMPANY_IDENTITY aliases / SIRET.
 * Used to identify the true issuer when our company appears first in the OCR.
 */
function extractOtherCompanyName(lines) {
  for (const line of lines.slice(0, 30)) {
    if (
      /facture|date|client|page|reference|montant|total|iban|bic|net a payer|devise|échéance|siret|siren|tva|rcs|capital|adresse|immatricul/i.test(
        line
      )
    ) {
      continue;
    }

    if (line.length < 2 || !/[A-Za-z]/.test(line)) continue;
    if (/^\d[\d\s]*$/.test(line.trim())) continue; // skip pure numbers

    const cleaned = sanitizePartyName(line);
    if (!cleaned) continue;

    if (isOwnCompany(cleaned)) continue; // skip our own company name

    return cleaned;
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
      return sanitizePartyName(line);
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

  // Case 1: "Date Client Page ... XX/XX/XXXX <ClientName> N/N" pattern found.
  // The extracted name is the CLIENT (recipient of the invoice).
  if (explicitClient) {
    const clientName = sanitizePartyName(explicitClient);
    if (isOwnCompany(clientName)) {
      // WE are the client → we RECEIVED this invoice → purchase (achat)
      recipient.name = COMPANY_IDENTITY.canonicalName;
      recipient.siret = COMPANY_IDENTITY.siret;
      // The issuer is whoever is NOT us — look for a known entity or any other company name
      const otherBySearch = extractOtherCompanyName(lines);
      const otherByTop    = topCompany && !isOwnCompany(topCompany) ? topCompany : null;
      const issuerName = otherBySearch || otherByTop;
      if (issuerName) {
        issuer.name = sanitizePartyName(issuerName);
        const related = findRelatedEntity(issuer.name);
        if (related) issuer.siret = related.siret;
      }
    } else {
      // External client → we ISSUED this invoice → sale (vente)
      issuer.name = COMPANY_IDENTITY.canonicalName;
      issuer.siret = COMPANY_IDENTITY.siret;
      recipient.name = clientName;
      const related = findRelatedEntity(clientName);
      if (related) recipient.siret = related.siret;
    }
  }

  // Case 2: our main company name found in the document body, but no explicit client label
  if (!issuer.name && !recipient.name && ownIndex >= 0) {
    // We appear in the document — determine if we are issuer or recipient
    const otherBySearch = extractOtherCompanyName(lines);
    const otherByFooter = footerCompany && !isOwnCompany(footerCompany) ? footerCompany : null;
    const otherByTop    = topCompany    && !isOwnCompany(topCompany)    ? topCompany    : null;
    const otherName = otherBySearch || otherByFooter || otherByTop;
    if (otherName) {
      // Default: we are recipient (purchase), other company is issuer
      issuer.name = sanitizePartyName(otherName);
      const related = findRelatedEntity(issuer.name);
      if (related) issuer.siret = related.siret;
      recipient.name = COMPANY_IDENTITY.canonicalName;
      recipient.siret = COMPANY_IDENTITY.siret;
    }
  }

  // Case 3: no own-company anchor at all → use topCompany as issuer
  if (!issuer.name) {
    const candidate = extractOtherCompanyName(lines) || topCompany;
    if (candidate) {
      issuer.name = sanitizePartyName(candidate);
    }
  }

  if (!recipient.name && explicitClient) {
    recipient.name = sanitizePartyName(explicitClient);
  }

  // Issuer SIRET: already set from COMPANY_IDENTITY if issuer is us;
  // otherwise look it up near their name, then fall back to first SIRET in doc.
  if (!issuer.siret) {
    if (issuer.name && isOwnCompany(issuer.name)) {
      issuer.siret = COMPANY_IDENTITY.siret;
    } else {
      issuer.siret =
        extractSiretNearCompany(lines, issuer.name) ||
        extractSiret(text) ||
        extractSiren(text);
    }
  }

  issuer.taxNumber =
    extractTaxNumberNearCompany(lines, issuer.name) || extractTaxNumber(text);

  // Recipient SIRET: already set if it was a known related entity;
  // otherwise look it up near their name.
  if (!recipient.siret) {
    const relatedRec = recipient.name ? findRelatedEntity(recipient.name) : null;
    if (relatedRec) {
      recipient.siret = relatedRec.siret;
    } else {
      recipient.siret = extractSiretNearCompany(lines, recipient.name) || null;
    }
  }

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

    vendorCustomer: sanitizePartyName(counterpartyName),
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