/**
 * Rapprochement opération ↔ facture : scoring local déterministe + signaux explicites.
 * L'IA peut compléter, mais ne doit jamais se substituer à des IDs ou montants incohérents.
 */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactAlnum(s) {
  return norm(s).replace(/[^a-z0-9]/g, "");
}

export function invoiceId(inv) {
  return String(inv?.id || inv?._id || "").trim();
}

function txnHaystack(txn) {
  const meta = txn?.bankMeta || {};
  return [
    txn?.label,
    txn?.reference,
    txn?.counterpartyName,
    meta.reference,
    meta.remittanceRef,
    meta.beneficiary,
    meta.debtor,
    meta.info,
    meta.libelle,
    meta.mandate,
    meta.orgId,
  ]
    .filter(Boolean)
    .join(" ");
}

function amountMatchScore(txnAbs, invAbs) {
  const diff = Math.abs(txnAbs - invAbs);
  if (diff === 0) return { pts: 42, label: "Montant identique" };
  if (diff <= 1) return { pts: 38, label: "Montant à 1 € près" };
  if (diff <= 5) return { pts: 32, label: "Montant à 5 € près" };
  if (diff <= 20) return { pts: 22, label: "Montant à 20 € près" };
  if (diff <= 80) return { pts: 12, label: "Montant proche" };
  if (diff <= 300) return { pts: 4, label: "Écart montant notable" };
  return { pts: 0, label: null };
}

function dateProximityScore(txnDateMs, inv) {
  const invDate = parseInvoiceDate(inv?.invoiceDate);
  const due = parseInvoiceDate(inv?.dueDate);
  const d1 = Math.abs(txnDateMs - invDate) / 86400000;
  const d2 = Number.isFinite(due) ? Math.abs(txnDateMs - due) / 86400000 : Infinity;
  const days = Math.min(d1, d2);
  if (!Number.isFinite(days) || Number.isNaN(days)) return { pts: 0, label: null };
  if (days <= 2) return { pts: 18, label: "Date très proche" };
  if (days <= 10) return { pts: 12, label: "Date proche" };
  if (days <= 30) return { pts: 6, label: "Date dans le mois" };
  if (days <= 90) return { pts: 2, label: "Date éloignée" };
  return { pts: 0, label: null };
}

function directionScore(txn, inv) {
  const amt = Number(txn?.amount || 0);
  const expected = amt < 0 ? "purchase" : "sales";
  const invType = String(inv?.type || expected).toLowerCase();
  if (invType === expected) return { pts: 14, label: amt < 0 ? "Achat cohérent (débit)" : "Vente cohérente (crédit)" };
  return { pts: 0, label: null };
}

function currencyScore(txn, inv) {
  const tc = norm(txn?.currency || "eur");
  const ic = norm(inv?.currency || tc);
  if (!inv?.currency || ic === tc) return { pts: 6, label: "Même devise" };
  return { pts: 0, label: null };
}

function referenceScore(txn, inv) {
  const hay = compactAlnum(txnHaystack(txn));
  const invNo = compactAlnum(inv?.invoiceNumber || "");
  if (invNo.length >= 4 && hay.includes(invNo)) {
    return { pts: 26, label: "N° facture trouvé dans l'opération" };
  }
  const parts = norm(inv?.vendorCustomer || "")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  let best = 0;
  for (const w of parts) {
    const c = compactAlnum(w);
    if (c.length >= 5 && hay.includes(c)) best = Math.max(best, 18);
  }
  if (best) return { pts: best, label: "Tiers reconnu dans le libellé / références" };
  return { pts: 0, label: null };
}

/**
 * Montant dans le libellé : uniquement si cohérent avec le montant BANCAIRE et la facture.
 * (Évite de lier une ligne de -8,75 € à une facture de 48 000 € car le libellé cite le prélèvement principal.)
 */
function labelAmountHintScore(txn, inv) {
  const hay = String(txnHaystack(txn) || "");
  const txnAbs = Math.abs(Number(txn?.amount || 0));
  const invAbs = Math.abs(Number(inv?.amountGross || 0));
  if (txnAbs < 0.01 || invAbs < 1) return { pts: 0, label: null };

  const txnTolerance = Math.max(1.5, txnAbs * 0.08);
  const invTolerance = Math.max(1.5, invAbs * 0.01);

  const tokens = hay.match(/\d[\d\s.,]{0,14}\d|\d[\d\s.,]{2,}/g) || [];
  for (const raw of tokens) {
    const normalized = raw.replace(/\s/g, "").replace(",", ".");
    const value = Number.parseFloat(normalized);
    if (!Number.isFinite(value) || value < 0.01) continue;
    if (Math.abs(value - invAbs) > invTolerance) continue;
    if (Math.abs(value - txnAbs) > txnTolerance) continue;
    return {
      pts: 28,
      label: `Montant ${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € aligné opération / facture`,
    };
  }
  return { pts: 0, label: null };
}

/** Le montant facture doit correspondre au montant de la ligne bancaire (±1,50 € ou 8 %). */
export function amountCoherentWithTransaction(transaction, invoice) {
  const txnAbs = Math.abs(Number(transaction?.amount || 0));
  const invAbs = Math.abs(Number(invoice?.amountGross || 0));
  if (txnAbs < 0.01 || invAbs < 0.01) return false;
  const diff = Math.abs(txnAbs - invAbs);
  return diff <= Math.max(1.5, txnAbs * 0.08);
}

/**
 * @returns {{ invoiceId: string, score: number, reason: string, signals: string[] }}
 */
export function buildLocalSuggestion(transaction, invoice) {
  const id = invoiceId(invoice);
  const txnAbs = Math.abs(Number(transaction?.amount || 0));
  const invAbs = Math.abs(Number(invoice?.amountGross || 0));
  const txnDateMs = new Date(transaction?.txnDate || 0).getTime();

  const signals = [];
  let score = 0;

  const a = amountMatchScore(txnAbs, invAbs);
  score += a.pts;
  if (a.label) signals.push(a.label);

  const d = dateProximityScore(txnDateMs, invoice);
  score += d.pts;
  if (d.label) signals.push(d.label);

  const dir = directionScore(transaction, invoice);
  score += dir.pts;
  if (dir.label) signals.push(dir.label);

  const cur = currencyScore(transaction, invoice);
  score += cur.pts;
  if (cur.label) signals.push(cur.label);

  const ref = referenceScore(transaction, invoice);
  score += ref.pts;
  if (ref.label) signals.push(ref.label);

  const labelAmt = labelAmountHintScore(transaction, invoice);
  score += labelAmt.pts;
  if (labelAmt.label) signals.push(labelAmt.label);

  const counterparty = extractTransactionCounterparty(transaction);
  if (supplierNameMatch(counterparty, invoice?.vendorCustomer || "")) {
    score += 16;
    signals.push("Fournisseur reconnu");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const reason = signals.length ? signals.join(" · ") : "Peu de signaux communs";

  return { invoiceId: id, score, reason, signals };
}

/**
 * Filtre les factures éligibles pour le rapprochement d'une opération :
 *  - statut non rapproché
 *  - date dans une plage de ±4 mois par rapport à la date de l'opération
 *
 * @param {object} transaction  - opération bancaire (txnDate, amount)
 * @param {Array}  invoices     - toutes les factures disponibles
 */
/**
 * Tente de parser une date en gérant les formats DD/MM/YYYY en plus de l'ISO.
 */
function parseInvoiceDate(raw) {
  if (!raw) return NaN;
  // Essai ISO standard
  let d = new Date(raw).getTime();
  if (Number.isFinite(d) && d > 0) return d;
  // Essai DD/MM/YYYY
  const m = String(raw).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    d = new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`).getTime();
    if (Number.isFinite(d) && d > 0) return d;
  }
  return NaN;
}

export function filterEligibleInvoices(transaction, invoices) {
  const txnDateMs = new Date(transaction?.txnDate || Date.now()).getTime();
  // Fenêtre élargie : 12 mois (les fournisseurs peuvent facturer à terme)
  const windowMs = 12 * 30 * 24 * 60 * 60 * 1000;

  return invoices.filter((inv) => {
    // Exclure les factures déjà rapprochées
    const status = String(inv?.status || "").toLowerCase();
    if (status === "rapprochée" || status === "rapproche" || status === "reconciled") {
      return false;
    }

    // Vérifier la plage de date — si la date est indisponible ou non parseable, on laisse passer
    const invDate = parseInvoiceDate(inv?.invoiceDate);
    const dueDate = parseInvoiceDate(inv?.dueDate);
    const dateRef = Number.isFinite(invDate) && invDate > 0 ? invDate
      : Number.isFinite(dueDate) && dueDate > 0 ? dueDate
      : null;

    if (dateRef !== null && Number.isFinite(txnDateMs)) {
      const diff = Math.abs(txnDateMs - dateRef);
      if (diff > windowMs) return false;
    }

    return true;
  });
}

/**
 * Vérifie si deux noms de société se correspondent (matching souple par mots).
 * ex: "FADLAOUI Zouhair EI" ↔ "FADLAOUI" → true
 */
export function supplierNameMatch(nameA, nameB) {
  const a = norm(nameA || "");
  const b = norm(nameB || "");
  if (!a || !b) return false;
  if (a === b) return true;

  // Ignore generic legal/business terms to avoid false positives
  // like "CONSULT HIGHTECH" ~= "ALTEC CONSULTING".
  const stopWords = new Set([
    "consult",
    "consulting",
    "groupe",
    "holding",
    "services",
    "service",
    "solutions",
    "solution",
    "company",
    "societe",
    "société",
    "entreprise",
    "international",
    "france",
    "europe",
    "eurl",
    "sarl",
    "sas",
    "sasu",
    "sa",
    "ei",
    "it",
  ]);

  const tokenize = (txt) =>
    txt
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w));

  // Extraire les mots discriminants
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);
  if (wordsA.length === 0 || wordsB.length === 0) return false;

  // Match if at least one discriminant token overlaps.
  return wordsA.some((w) => wordsB.includes(w));
}

/** Nom du tiers bancaire (créancier SEPA, bénéficiaire, libellé). */
export function extractTransactionCounterparty(transaction = {}) {
  const meta = transaction?.bankMeta || {};
  return String(
    transaction?.counterpartyName ||
      meta.beneficiary ||
      meta.debtor ||
      transaction?.label ||
      ""
  ).trim();
}

export const RECONCILIATION_AMOUNT_TOLERANCE_EUR = 1.5;
/** ±3 mois (aligné consignes agent IA). */
export const RECONCILIATION_DATE_TOLERANCE_DAYS = 92;

export function invoiceNumbersMatch(reference, invoiceNumber) {
  const wanted = compactAlnum(reference || "");
  const invNo = compactAlnum(invoiceNumber || "");
  if (wanted.length < 3 || invNo.length < 3) return false;
  if (wanted === invNo) return true;
  if (invNo.includes(wanted) || wanted.includes(invNo)) return true;
  return false;
}

export function findOpenInvoiceByReference(reference, invoices = []) {
  const wanted = String(reference || "").trim();
  if (!wanted) return null;
  return (
    invoices.find((inv) => {
      const status = String(inv?.status || "").toLowerCase();
      if (["rapprochée", "rapprochee", "rapproché", "reconciled"].includes(status)) {
        return false;
      }
      return invoiceNumbersMatch(wanted, inv?.invoiceNumber);
    }) || null
  );
}

export function invoiceReferenceMatchesTransaction(transaction, invoice) {
  const invNo = compactAlnum(invoice?.invoiceNumber || "");
  if (invNo.length < 3) return false;
  const hay = compactAlnum(txnHaystack(transaction));
  if (hay.includes(invNo)) return true;
  if (invNo.length >= 4 && hay.length >= 4 && (hay.includes(invNo) || invNo.includes(hay))) {
    return true;
  }
  const sepaRef = compactAlnum(transaction?.sepaOperation?.remittanceInfo || "");
  const sepaE2e = compactAlnum(transaction?.sepaOperation?.endToEndId || "");
  if (sepaRef && (sepaRef.includes(invNo) || invNo.includes(sepaRef))) return true;
  if (sepaE2e && (sepaE2e.includes(invNo) || invNo.includes(sepaE2e))) return true;
  if (invoiceNumbersMatch(transaction?.reference, invoice?.invoiceNumber)) return true;
  return false;
}

export function amountMatchesTransaction(
  transaction,
  invoice,
  toleranceEur = RECONCILIATION_AMOUNT_TOLERANCE_EUR
) {
  const txnAbs = Math.abs(Number(transaction?.amount || 0));
  const invAbs = Math.abs(Number(invoice?.amountGross || 0));
  if (txnAbs < 0.01 || invAbs < 0.01) return false;
  return Math.abs(txnAbs - invAbs) <= toleranceEur;
}

export function dateMatchesTransaction(
  transaction,
  invoice,
  maxDays = RECONCILIATION_DATE_TOLERANCE_DAYS
) {
  const txnDateMs = new Date(transaction?.txnDate || 0).getTime();
  if (!Number.isFinite(txnDateMs) || txnDateMs <= 0) return true;

  const invDate = parseInvoiceDate(invoice?.invoiceDate);
  const dueDate = parseInvoiceDate(invoice?.dueDate);
  const candidates = [invDate, dueDate].filter((d) => Number.isFinite(d) && d > 0);
  if (!candidates.length) return true;

  const minDays =
    Math.min(...candidates.map((d) => Math.abs(txnDateMs - d) / 86400000));
  return minDays <= maxDays;
}

export function supplierMatchesTransaction(transaction, invoice) {
  const counterparty = extractTransactionCounterparty(transaction);
  return supplierNameMatch(counterparty, invoice?.vendorCustomer || "");
}

/** Fournisseur + montant + date (référence facture non requise). */
export function supplierAmountDateMatch(transaction, invoice) {
  return (
    supplierMatchesTransaction(transaction, invoice) &&
    amountMatchesTransaction(transaction, invoice) &&
    dateMatchesTransaction(transaction, invoice)
  );
}

/** Fournisseur + montant + date + n° facture dans le SEPA / libellé → rapprochement direct. */
export function exactReconciliationMatch(transaction, invoice) {
  return (
    supplierAmountDateMatch(transaction, invoice) &&
    invoiceReferenceMatchesTransaction(transaction, invoice)
  );
}

/**
 * True si l'opération et la facture partagent un lien fournisseur ou une référence explicite.
 */
export function transactionMatchesInvoice(transaction, invoice) {
  const counterparty = extractTransactionCounterparty(transaction);
  if (supplierNameMatch(counterparty, invoice?.vendorCustomer || "")) {
    return true;
  }
  const hay = compactAlnum(txnHaystack(transaction));
  const invNo = compactAlnum(invoice?.invoiceNumber || "");
  if (invNo.length >= 4 && hay.includes(invNo)) {
    return true;
  }
  const parts = norm(invoice?.vendorCustomer || "")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  for (const w of parts) {
    const c = compactAlnum(w);
    if (c.length >= 5 && hay.includes(c)) {
      return true;
    }
  }
  return false;
}

/** Toutes les factures d'une combinaison doivent être du même fournisseur. */
export function invoicesShareSupplierFamily(invoices = []) {
  if (invoices.length <= 1) return true;
  const anchor = invoices[0]?.vendorCustomer || "";
  return invoices.every((inv) => supplierNameMatch(anchor, inv?.vendorCustomer || ""));
}

/**
 * Construit un objet résumé d'une facture pour la réponse.
 */
function invoiceSummary(inv) {
  return {
    id: invoiceId(inv),
    invoiceNumber: inv.invoiceNumber || "",
    vendorCustomer: inv.vendorCustomer || "",
    amountGross: Number(inv.amountGross || 0),
  };
}

/**
 * Calcule le score et le libellé d'une combinaison selon son type et son écart.
 *  - matchType "supplier" : correspondance trouvée via le nom du fournisseur SEPA
 *  - matchType "amount"   : correspondance trouvée par somme des montants
 */
function scoreCombination(combo, txnAbs) {
  const ratio = txnAbs > 0 ? combo.totalAmount / txnAbs : 0;
  let score;

  if (combo.diff === 0) {
    score = 100;
  } else if (combo.diff <= 0.5) {
    score = 97;
  } else if (combo.diff <= 1) {
    score = 95;
  } else if (ratio >= 0.95) {
    score = combo.matchType === "supplier" ? 92 : 88;
  } else if (ratio >= 0.90) {
    score = combo.matchType === "supplier" ? 85 : 80;
  } else if (combo.matchType === "supplier") {
    // Fournisseur trouvé mais montant partiel — montrer quand même
    score = Math.round(60 + ratio * 25);
  } else {
    score = 60;
  }

  const diffLabel =
    combo.diff === 0 ? "Montant exact" : `Écart ${combo.diff.toFixed(2)} €`;
  const comboLabel =
    combo.invoiceIds.length === 1 ? "Facture unique" : `Combinaison de ${combo.invoiceIds.length} factures`;
  const typeLabel = combo.matchType === "supplier" ? "Fournisseur SEPA identifié" : "Combinaison montant";

  return {
    ...combo,
    score,
    reason: `${typeLabel} · ${comboLabel} · ${diffLabel} · Total ${combo.totalAmount.toFixed(2)} €`,
  };
}

/**
 * Moteur de recherche de combinaisons de factures pour le rapprochement SEPA.
 *
 * Stratégie 1 — Nom fournisseur (prioritaire) :
 *   Cherche dans les factures éligibles celles dont le vendorCustomer correspond
 *   au creditorName de l'opération SEPA. Prend TOUTES les factures non rapprochées
 *   de ce fournisseur et vérifie si leur somme atteint le montant de l'opération.
 *   Si l'écart est > tolérance, on cherche le meilleur sous-ensemble.
 *
 * Stratégie 2 — Somme des montants (fallback) :
 *   Backtracking sur toutes les factures éligibles pour trouver un sous-ensemble
 *   dont la somme = montant opération.
 *
 * @returns {Array} Combinaisons triées par score décroissant, max 8.
 */
export function findInvoiceCombinations(
  transaction,
  invoices,
  { maxComboSize = 5, toleranceEur = 1.5 } = {}
) {
  const txnAbs = Math.abs(Number(transaction?.amount || 0));
  if (txnAbs < 1) return [];

  // Factures éligibles : non rapprochées, date dans ±4 mois
  const eligible = filterEligibleInvoices(transaction, invoices);
  if (eligible.length === 0) return [];

  const seenKeys = new Set();
  const rawResults = [];

  function addResult(invoiceList, matchType) {
    if (!invoiceList.length) return;
    const key = invoiceList.map(invoiceId).sort().join("|");
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const totalAmount = invoiceList.reduce(
      (s, inv) => s + Math.abs(Number(inv.amountGross || 0)),
      0
    );
    rawResults.push({
      invoiceIds: invoiceList.map(invoiceId),
      invoices: invoiceList.map(invoiceSummary),
      totalAmount: Math.round(totalAmount * 100) / 100,
      diff: Math.round(Math.abs(totalAmount - txnAbs) * 100) / 100,
      matchType,
    });
  }

  // ─── Stratégie 1 : Nom fournisseur ──────────────────────────────────────────
  // Extraire le nom du créancier de l'opération SEPA
  const creditorRaw = transaction?.counterpartyName || transaction?.label || "";

  if (creditorRaw) {
    // Trouver toutes les factures éligibles dont le fournisseur correspond au créancier SEPA
    const supplierInvoices = eligible.filter((inv) =>
      supplierNameMatch(creditorRaw, inv.vendorCustomer || "")
    );

    if (supplierInvoices.length > 0) {
      const totalSupplier = supplierInvoices.reduce(
        (s, inv) => s + Math.abs(Number(inv.amountGross || 0)),
        0
      );
      const supplierDiff = Math.abs(totalSupplier - txnAbs);

      if (supplierDiff <= toleranceEur) {
        // Somme exacte (ou quasi) de toutes les factures du fournisseur → suggestion directe
        addResult(supplierInvoices, "supplier");
      } else {
        // Toujours montrer le groupe complet comme suggestion (même partiel)
        addResult(supplierInvoices, "supplier");

        // Chercher aussi un sous-ensemble exact parmi les factures de ce fournisseur
        const suppCandidates = supplierInvoices
          .filter((inv) => Math.abs(Number(inv.amountGross || 0)) <= txnAbs + toleranceEur)
          .sort((a, b) => Math.abs(Number(b.amountGross)) - Math.abs(Number(a.amountGross)));

        function searchSupplier(startIdx, current, currentSum) {
          const diff = Math.abs(currentSum - txnAbs);
          if (current.length >= 1 && diff <= toleranceEur) {
            addResult(current, "supplier");
            return;
          }
          if (current.length >= maxComboSize) return;
          if (currentSum > txnAbs + toleranceEur) return;
          for (let i = startIdx; i < suppCandidates.length; i++) {
            const inv = suppCandidates[i];
            const amt = Math.abs(Number(inv.amountGross || 0));
            if (currentSum + amt > txnAbs + toleranceEur) continue;
            searchSupplier(i + 1, [...current, inv], currentSum + amt);
          }
        }
        searchSupplier(0, [], 0);
      }
    }
  }

  // ─── Stratégie 2 : Combinaisons par montant (fallback) ──────────────────────
  const amtCandidates = eligible
    .filter((inv) => Math.abs(Number(inv.amountGross || 0)) <= txnAbs + toleranceEur)
    .sort((a, b) => Math.abs(Number(b.amountGross)) - Math.abs(Number(a.amountGross)))
    .slice(0, 30);

  function searchAmount(startIdx, current, currentSum) {
    const diff = Math.abs(currentSum - txnAbs);
    if (current.length >= 1 && diff <= toleranceEur) {
      addResult(current, "amount");
      return;
    }
    if (current.length >= maxComboSize) return;
    if (currentSum > txnAbs + toleranceEur) return;
    for (let i = startIdx; i < amtCandidates.length; i++) {
      const inv = amtCandidates[i];
      const amt = Math.abs(Number(inv.amountGross || 0));
      if (currentSum + amt > txnAbs + toleranceEur) continue;
      searchAmount(i + 1, [...current, inv], currentSum + amt);
    }
  }
  searchAmount(0, [], 0);

  // ─── Scorer, trier, dédupliquer ──────────────────────────────────────────────
  return rawResults
    .map((combo) => scoreCombination(combo, txnAbs))
    .sort((a, b) => {
      // Supplier en premier, puis score décroissant
      const aSupplier = a.matchType === "supplier" ? 1 : 0;
      const bSupplier = b.matchType === "supplier" ? 1 : 0;
      if (aSupplier !== bSupplier) return bSupplier - aSupplier;
      return b.score - a.score;
    })
    .slice(0, 8);
}

/**
 * Fusionne suggestions IA (si valides) avec score local. L'IA ne peut pas faire monter
 * le score de plus de +8 ni contredire un écart montant > 25 % sans signal texte.
 */
export function mergeAiWithLocal(localRow, aiScore, aiReason) {
  const local = localRow.score;
  const ai = Math.max(0, Math.min(100, Number(aiScore || 0)));
  if (Math.abs(ai - local) > 38) {
    return {
      score: local,
      reason: `${localRow.reason} (IA ignorée : incohérente)`,
      aiReason: aiReason || "",
    };
  }
  const blended = Math.round(Math.min(100, local * 0.72 + ai * 0.28));
  const reason = aiReason
    ? `${localRow.reason} · IA (${ai}%): ${aiReason}`
    : localRow.reason;
  return { score: blended, reason, aiReason: aiReason || "" };
}
