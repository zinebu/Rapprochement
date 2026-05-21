/**
 * Extraction d'un grand bulletin de paie multi-salariés (PDF texte) en fiches individuelles.
 */

function parseFrenchAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw)
    .trim()
    .replace(/\u00A0/g, " ")
    .replace(/\s/g, "")
    .replace(/€/gi, "")
    .replace(/Eur/gi, "")
    .replace(/Frs/gi, "")
    .replace(",", ".");
  const n = Number(str);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function parseFrenchDateToIso(value) {
  const m = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48);
}

function extractCompanyHeader(block) {
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let companyName = null;
  let companyAddress = null;
  let siret = null;

  const bulletinIdx = lines.findIndex((l) => /^BULLETIN DE PAIE du/i.test(l));
  const after = bulletinIdx >= 0 ? lines.slice(bulletinIdx + 1) : lines;

  for (let i = 0; i < Math.min(after.length, 8); i++) {
    const line = after[i];
    if (/^\d{5}\s/.test(line)) {
      companyAddress = [after[i - 1], line].filter(Boolean).join(", ");
      if (i >= 1 && !companyName) companyName = after[i - 1];
      break;
    }
    if (!companyName && line.length >= 2 && !/^\d/.test(line)) {
      companyName = line;
    }
  }

  const siretMatch = block.match(/Siret\s*\/\s*APE\s+(\d{14})/i);
  if (siretMatch) siret = siretMatch[1];

  return { companyName, companyAddress, siret };
}

/** Civilité + nom avant l'adresse (souvent "Mr NOM Prénom 7 rue …" sur une seule ligne PDF). */
function extractEmployeeNameFromSlipText(text) {
  const block = String(text || "");
  if (!block) return { employeeName: null, civility: null };

  const civilityPattern = "(?:Mr|Mme|Mlle|M\\.)";
  // Nom suivi d'un numéro de voie (début d'adresse)
  const inlineRe = new RegExp(
    `\\b(${civilityPattern})\\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'\\-]+(?:\\s+[A-Za-zÀ-ÿ'\\-]+){1,3})(?=\\s+\\d)`,
    "i"
  );
  const inlineMatch = block.match(inlineRe);
  if (inlineMatch) {
    return {
      civility: inlineMatch[1].replace(/\.$/, ""),
      employeeName: inlineMatch[2].trim(),
    };
  }

  // Texte multi-lignes : ligne dédiée "Mr NOM Prénom"
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const lineMatch = line.match(
      new RegExp(`\\b(${civilityPattern})\\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'\\-]+(?:\\s+[A-Za-zÀ-ÿ'\\-]+){1,3})\\b`, "i")
    );
    if (lineMatch && !/Convention Collective/i.test(lineMatch[0])) {
      return {
        civility: lineMatch[1].replace(/\.$/, ""),
        employeeName: lineMatch[2].trim(),
      };
    }
  }

  // Après "Convention Collective …" (flux compact type MENISYS)
  const afterConv = block.match(
    new RegExp(
      `Convention Collective[\\s\\S]{0,120}?\\b(${civilityPattern})\\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'\\-]+(?:\\s+[A-Za-zÀ-ÿ'\\-]+){1,3})`,
      "i"
    )
  );
  if (afterConv) {
    return {
      civility: afterConv[1].replace(/\.$/, ""),
      employeeName: afterConv[2].trim(),
    };
  }

  return { employeeName: null, civility: null };
}

function parseSingleSlip(block, index, periodStart, periodEnd) {
  const text = String(block || "").trim();
  if (!text) return null;

  const matriculeMatch = text.match(/Matricule\s+(\d+)/i);
  const matricule = matriculeMatch ? matriculeMatch[1] : String(index + 1).padStart(3, "0");

  const { employeeName, civility } = extractEmployeeNameFromSlipText(text);

  const jobMatch = text.match(/Emploi\s+([^\n]+?)\s+Catégorie/i);
  const jobTitle = jobMatch ? jobMatch[1].trim() : null;

  const grossMatch = text.match(/TOTAL BRUT\s+([\d\s,]+)/i);
  const grossSalary = grossMatch ? parseFrenchAmount(grossMatch[1]) : null;

  const netMatch = text.match(/Net à payer au salarié\s+([\d\s,]+)/i);
  const netPay = netMatch ? parseFrenchAmount(netMatch[1]) : null;

  const employerCostMatch = text.match(/Coût Entreprise\s+Mois\s*:\s*([\d\s,]+)/i);
  const employerCost = employerCostMatch ? parseFrenchAmount(employerCostMatch[1]) : null;

  const paidMatch = text.match(/Réglé le\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const paymentDate = paidMatch ? parseFrenchDateToIso(paidMatch[1]) : null;

  const ibanMatch = text.match(/IBAN\s+([A-Z]{2}[\dA-Z]{10,30})/i);
  const iban = ibanMatch ? ibanMatch[1] : null;

  const id = `slip-${matricule}-${slugify(employeeName || `ligne-${index + 1}`)}`;

  return {
    id,
    matricule,
    employeeName: employeeName || `Salarié ${matricule}`,
    civility,
    jobTitle,
    periodStart,
    periodEnd,
    grossSalary,
    netPay,
    employerCost,
    paymentDate,
    iban,
    pageStart: index + 1,
    pageEnd: index + 1,
  };
}

/**
 * @param {string} extractedText
 * @param {{ originalName?: string, pageCount?: number }} [meta]
 */
export function parsePayrollBulletinFromText(extractedText, meta = {}) {
  const text = String(extractedText || "").trim();
  if (!text) return null;

  const nameHint = String(meta.originalName || "");
  const looksLikePayroll =
    /bulletin\s+de\s+paie|grand\s+bulletin|menisys|paie\s*-\s*\d{2}/i.test(text) ||
    /bulletin|paie|payroll|salari/i.test(nameHint);

  if (!looksLikePayroll && !/BULLETIN DE PAIE du/i.test(text)) {
    return null;
  }

  const periodHeader = text.match(
    /BULLETIN DE PAIE du\s+(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/i
  );
  const periodStart = periodHeader ? parseFrenchDateToIso(periodHeader[1]) : null;
  const periodEnd = periodHeader ? parseFrenchDateToIso(periodHeader[2]) : null;

  const blocks = text
    .split(/(?=BULLETIN DE PAIE du\s+\d{2}\/\d{2}\/\d{4})/i)
    .map((b) => b.trim())
    .filter((b) => /BULLETIN DE PAIE du/i.test(b));

  if (blocks.length === 0) return null;

  const companyFromFirst = extractCompanyHeader(blocks[0]);
  const slips = blocks
    .map((block, index) => parseSingleSlip(block, index, periodStart, periodEnd))
    .filter(Boolean);

  if (slips.length === 0) return null;

  const pageCount = Number(meta.pageCount) || slips.length;
  slips.forEach((slip, i) => {
    slip.pageStart = Math.min(i + 1, pageCount);
    slip.pageEnd = Math.min(i + 1, pageCount);
  });

  const totalGross = slips.reduce((s, x) => s + (Number(x.grossSalary) || 0), 0);
  const totalNet = slips.reduce((s, x) => s + (Number(x.netPay) || 0), 0);
  const totalEmployer = slips.reduce((s, x) => s + (Number(x.employerCost) || 0), 0);

  const periodLabel =
    periodStart && periodEnd
      ? `${periodStart.slice(5, 7)}/${periodStart.slice(0, 4)}`
      : null;

  const batchId =
    slugify(nameHint.replace(/\.[^.]+$/, "")) ||
    `bulletin-${periodLabel || "import"}-${Date.now()}`;

  return {
    documentType: "payroll_bulk",
    payrollBatch: {
      id: batchId,
      label: nameHint.replace(/\.[^.]+$/, "") || `Bulletin ${periodLabel || ""}`.trim(),
      periodLabel,
      periodStart,
      periodEnd,
      companyName: companyFromFirst.companyName,
      companyAddress: companyFromFirst.companyAddress,
      companySiret: companyFromFirst.siret,
      numberOfSlips: slips.length,
      totalGross: Math.round(totalGross * 100) / 100,
      totalNet: Math.round(totalNet * 100) / 100,
      totalEmployerCost: Math.round(totalEmployer * 100) / 100,
      currency: "EUR",
      slips,
    },
  };
}

export function isStrongPayrollStructuredData(data) {
  if (!data || data.documentType !== "payroll_bulk") return false;
  const slips = data?.payrollBatch?.slips;
  return Array.isArray(slips) && slips.length >= 1;
}

export function nameLooksLikePayrollFile(fileName = "") {
  return /bulletin|paie|payroll|menisys|fiche.?paie|salari/i.test(String(fileName || ""));
}
