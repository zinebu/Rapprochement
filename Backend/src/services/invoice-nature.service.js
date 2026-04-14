import { COMPANY_IDENTITY } from "../config/company-identity.js";

function normalize(value) {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isOwnCompany(name = "", siret = "") {
  const aliases = COMPANY_IDENTITY.aliases.map((a) => normalize(a));
  const n = normalize(name);
  const byName = aliases.some((alias) => n.includes(alias));
  const bySiret =
    String(siret || "").replace(/\D/g, "") === COMPANY_IDENTITY.siret;

  return byName || bySiret;
}

export function inferInvoiceNatureHints({ extractedText, structuredData }) {
  const text = normalize(extractedText);

  const hints = {
    probableNature: "unknown",
    confidence: "low",
    reasons: [],
  };

  if (!text) return hints;

  const issuer = structuredData?.issuer || {};
  const recipient = structuredData?.recipient || {};

  if (isOwnCompany(issuer.name, issuer.siret)) {
    hints.probableNature = "sales";
    hints.confidence = "high";
    hints.reasons.push("own_company_detected_as_issuer");
    return hints;
  }

  if (isOwnCompany(recipient.name, recipient.siret)) {
    hints.probableNature = "purchase";
    hints.confidence = "high";
    hints.reasons.push("own_company_detected_as_recipient");
    return hints;
  }

  if (text.includes("date client page") || /client\s*:/i.test(text)) {
    hints.probableNature = "sales";
    hints.confidence = "medium";
    hints.reasons.push("explicit_client_label_detected");
    return hints;
  }

  if (
    /bill to|invoice to|facturé à|adresse de facturation/i.test(text) &&
    COMPANY_IDENTITY.aliases.some((alias) => text.includes(normalize(alias)))
  ) {
    hints.probableNature = "purchase";
    hints.confidence = "medium";
    hints.reasons.push("own_company_detected_in_billing_block");
    return hints;
  }

  return hints;
}