import {

  exactReconciliationMatch,

  extractTransactionCounterparty,

  invoiceReferenceMatchesTransaction,

  invoicesShareSupplierFamily,

  supplierAmountDateMatch,

  supplierNameMatch,

  amountCoherentWithTransaction,

  findOpenInvoiceByReference,

} from "./reconciliation-scoring.service.js";



export function counterpartyNamesForMatch(transaction = {}) {

  return [

    extractTransactionCounterparty(transaction),

    transaction?.label,

    transaction?.reference,

  ]

    .map((s) => String(s || "").trim())

    .filter(Boolean);

}



export function anySupplierNameMatch(transaction, vendorName) {

  const vendor = String(vendorName || "");

  if (!vendor) return false;

  return counterpartyNamesForMatch(transaction).some((name) =>

    supplierNameMatch(name, vendor)

  );

}



const AMOUNT_TOLERANCE_EUR = 1.5;

const SINGLE_LINE_MAX_RATIO = 0.08;



function amountRatio(txnAbs, invAbs) {

  if (txnAbs < 1) return 1;

  return Math.abs(txnAbs - invAbs) / txnAbs;

}



function capSuggestionScore(aiScore, ratio, { exact = false } = {}) {

  if (exact) return 100;

  let max = 55;

  if (ratio <= 0.01) max = 90;

  else if (ratio <= 0.03) max = 85;

  else if (ratio <= SINGLE_LINE_MAX_RATIO) max = 78;

  return Math.min(Math.round(Number(aiScore || 0)), max);

}



function capCombinationScore(aiScore, diff, invoiceCount) {

  if (diff > AMOUNT_TOLERANCE_EUR) return 0;

  let max = diff === 0 ? 92 : 85;

  if (invoiceCount >= 3) max = Math.min(max, 82);

  return Math.min(Math.round(Number(aiScore || 0)), max);

}



function buildMatchSignals(transaction, inv, { exact, strong }) {

  const signals = [];

  if (exact) {

    signals.push("Rapprochement direct");

    signals.push("Référence facture identique");

  }

  if (strong || exact) {

    signals.push("Fournisseur identique");

    signals.push("Montant identique");

    signals.push("Date dans l'intervalle autorisé");

  }

  if (!exact && strong && !invoiceReferenceMatchesTransaction(transaction, inv)) {

    signals.push("Référence facture différente — à confirmer");

  }

  return signals;

}



/**

 * Correspondances 1:1 déterministes (fournisseur + montant exact) si l'IA ne renvoie rien.

 */

export function buildDeterministicStrictMatches(transaction, candidateInvoices = []) {

  const suggestions = [];

  const seen = new Set();



  for (const inv of candidateInvoices) {

    const id = String(inv?.id || inv?._id || "");

    if (!id || seen.has(id)) continue;

    if (!supplierAmountDateMatch(transaction, inv)) continue;



    seen.add(id);

    const exact = exactReconciliationMatch(transaction, inv);

    const invAbs = Math.abs(Number(inv?.amountGross || 0));

    suggestions.push({

      invoiceId: id,

      score: exact ? 100 : 88,

      matchTier: exact ? "exact" : "strong",

      autoReconcile: exact,

      reason: exact

        ? `Rapprochement direct : fournisseur, montant (${invAbs.toFixed(2)} €), date et référence facture`

        : `Fournisseur, montant (${invAbs.toFixed(2)} €) et date cohérents — référence SEPA différente`,

      signals: buildMatchSignals(transaction, inv, { exact, strong: !exact }),

      invoice: {

        id,

        invoiceNumber: inv?.invoiceNumber || "",

        vendorCustomer: inv?.vendorCustomer || "",

        amountGross: invAbs,

      },

    });

  }



  suggestions.sort((a, b) => b.score - a.score);

  return { suggestions: suggestions.slice(0, 5), combinations: [] };

}



export function buildAmountOnlyOpenHints(transaction, candidateInvoices = []) {

  const txnAbs = Math.abs(Number(transaction?.amount || 0));

  if (txnAbs < 50) return { suggestions: [], combinations: [] };



  const openStatuses = new Set(["", "non_rapprochée", "non_rapprochee", "non_rapproché", "open"]);

  const suggestions = [];

  const seen = new Set();



  for (const inv of candidateInvoices) {

    const id = String(inv?.id || inv?._id || "");

    if (!id || seen.has(id)) continue;

    const status = String(inv?.status || "").toLowerCase();

    if (status === "rapprochée" || status === "rapprochee" || status === "reconciled") {

      continue;

    }

    if (status && !openStatuses.has(status)) continue;



    const invAbs = Math.abs(Number(inv?.amountGross || 0));

    if (Math.abs(invAbs - txnAbs) > AMOUNT_TOLERANCE_EUR) continue;

    if (anySupplierNameMatch(transaction, inv?.vendorCustomer || "")) continue;



    seen.add(id);

    suggestions.push({

      invoiceId: id,

      score: 58,

      matchTier: "amount_only",

      autoReconcile: false,

      reason: `Montant correspondant (${invAbs.toFixed(2)} €) — confirmer le fournisseur`,

      signals: ["Montant proche"],

      invoice: {

        id,

        invoiceNumber: inv?.invoiceNumber || "",

        vendorCustomer: inv?.vendorCustomer || "",

        amountGross: invAbs,

      },

    });

  }



  suggestions.sort((a, b) => b.score - a.score);

  return { suggestions: suggestions.slice(0, 4), combinations: [] };

}



export function buildReconciledInvoiceHints(transaction, allInvoices = []) {

  const suggestions = [];

  const seen = new Set();



  for (const inv of allInvoices) {

    const id = String(inv?.id || inv?._id || "");

    if (!id || seen.has(id)) continue;

    const status = String(inv?.status || "").toLowerCase();

    if (!["rapprochée", "rapprochee", "rapproché", "reconciled"].includes(status)) continue;

    if (!supplierAmountDateMatch(transaction, inv)) continue;



    seen.add(id);

    const invAbs = Math.abs(Number(inv?.amountGross || 0));

    suggestions.push({

      invoiceId: id,

      score: 72,

      matchTier: "hint",

      autoReconcile: false,

      reason: `Facture déjà rapprochée · fournisseur, montant (${invAbs.toFixed(2)} €) et date cohérents`,

      signals: ["Déjà rapprochée", "Fournisseur", "Montant", "Date"],

      alreadyReconciled: true,

    });

  }



  suggestions.sort((a, b) => b.score - a.score);

  return { suggestions: suggestions.slice(0, 5), combinations: [] };

}



/**

 * Filtre les sorties IA :

 * - propose si fournisseur + montant + date OK (référence non obligatoire)

 * - score 100 + autoReconcile si référence facture aussi identique

 */

export function applyStrictProposalGates(transaction, mapped, candidateInvoices = []) {

  const txnAbs = Math.abs(Number(transaction?.amount || 0));

  const invoiceById = new Map(

    candidateInvoices.map((inv) => [String(inv?.id || inv?._id || ""), inv]).filter(([id]) => id)

  );



  const suggestions = [];

  for (const row of mapped.suggestions || []) {

    const inv = invoiceById.get(String(row.invoiceId || ""));

    if (!inv) continue;

    const aiScore = Math.round(Number(row.score || 0));
    const refHit = invoiceReferenceMatchesTransaction(transaction, inv);
    const supplierHit = anySupplierNameMatch(transaction, inv?.vendorCustomer || "");
    const mediumTier =
      aiScore >= 55 &&
      (refHit || (supplierHit && amountCoherentWithTransaction(transaction, inv)));

    if (!supplierAmountDateMatch(transaction, inv) && !mediumTier) continue;



    const exact = exactReconciliationMatch(transaction, inv);

    const invAbs = Math.abs(Number(inv.amountGross || 0));

    const ratio = amountRatio(txnAbs, invAbs);

    if (!exact && ratio > SINGLE_LINE_MAX_RATIO) continue;



    const score = capSuggestionScore(

      exact ? 100 : Math.max(row.score || 0, 82),

      ratio,

      { exact }

    );

    if (!exact && score < 40) continue;



    const matchSignals = buildMatchSignals(transaction, inv, { exact, strong: !exact });

    const aiSignals = Array.isArray(row.signals) ? row.signals : [];



    suggestions.push({

      ...row,

      score,

      matchTier: exact ? "exact" : "strong",

      autoReconcile: exact,

      reason: exact

        ? row.reason ||

          `Rapprochement direct · ${inv.invoiceNumber || ""} · ${invAbs.toFixed(2)} €`

        : row.reason ||

          `Fournisseur, montant et date cohérents · référence à confirmer · ${invAbs.toFixed(2)} €`,

      signals: [...new Set([...matchSignals, ...aiSignals])],

    });

  }



  const combinations = [];

  for (const combo of mapped.combinations || []) {

    const ids = (combo.invoiceIds || []).map((id) => String(id)).filter(Boolean);

    const invs = ids.map((id) => invoiceById.get(id)).filter(Boolean);

    if (invs.length !== ids.length || invs.length === 0) continue;



    if (!invs.every((inv) => supplierAmountDateMatch(transaction, inv))) continue;

    if (!invoicesShareSupplierFamily(invs)) continue;



    const totalAmount =

      Math.round(invs.reduce((s, inv) => s + Math.abs(Number(inv.amountGross || 0)), 0) * 100) /

      100;

    const diff = Math.round(Math.abs(totalAmount - txnAbs) * 100) / 100;

    if (diff > AMOUNT_TOLERANCE_EUR) continue;



    const allExact = invs.every((inv) => exactReconciliationMatch(transaction, inv));

    const score = allExact

      ? 100

      : capCombinationScore(combo.score, diff, invs.length);

    if (score < 40) continue;



    combinations.push({

      ...combo,

      invoiceIds: ids,

      invoices: combo.invoices,

      totalAmount,

      diff,

      matchType: "supplier",

      matchTier: allExact ? "exact" : "strong",

      autoReconcile: allExact,

      score,

      reason:

        combo.reason ||

        (allExact

          ? `Rapprochement direct · ${invs.length} facture(s) · total ${totalAmount.toFixed(2)} €`

          : `Fournisseur, montants et dates cohérents · ${invs.length} facture(s) · total ${totalAmount.toFixed(2)} €`),

    });

  }



  suggestions.sort((a, b) => b.score - a.score);

  combinations.sort((a, b) => b.score - a.score);



  return {

    suggestions: suggestions.slice(0, 8),

    combinations: combinations.slice(0, 8),

  };

}



/** Complète les suggestions IA avec les matchs fournisseur+montant+date absents de la réponse. */

export function mergeStrongMatchesIntoSuggestions(
  transaction,
  suggestions = [],
  allInvoices = []
) {
  const openInvoices = listOpenInvoices(allInvoices);
  const seen = new Set(suggestions.map((s) => String(s.invoiceId || "")));
  const merged = [...suggestions];
  const deterministic = buildDeterministicStrictMatches(transaction, openInvoices);
  for (const row of deterministic.suggestions || []) {
    const id = String(row.invoiceId || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, 8);
}

function listOpenInvoices(invoices = []) {
  return invoices.filter((inv) => {
    const status = String(inv?.status || "").toLowerCase();
    return !["rapprochée", "rapprochee", "rapproché", "reconciled"].includes(status);
  });
}

function invoiceRowSummary(inv) {
  return {
    id: String(inv?.id || inv?._id || ""),
    invoiceNumber: inv?.invoiceNumber || "",
    vendorCustomer: inv?.vendorCustomer || "",
    amountGross: Number(inv?.amountGross || 0),
  };
}

function transactionFromMissingRow(transaction, miss = {}) {
  const ref = String(miss?.invoiceReference || "").trim();
  const amount = Number(miss?.amount ?? Math.abs(Number(transaction?.amount || 0)));
  return {
    ...transaction,
    counterpartyName: miss?.creditorName || transaction?.counterpartyName,
    reference: ref || transaction?.reference,
    amount: amount > 0 ? -amount : transaction?.amount,
    label: [miss?.creditorName, ref].filter(Boolean).join(" ").trim() || transaction?.label,
    sepaOperation: {
      ...(transaction?.sepaOperation || {}),
      creditorName: miss?.creditorName || transaction?.sepaOperation?.creditorName,
      remittanceInfo: ref || transaction?.sepaOperation?.remittanceInfo,
      amount: Math.abs(amount) || transaction?.sepaOperation?.amount,
    },
  };
}

export function resolveAiMissingInvoices(
  transaction,
  aiMissing = [],
  existingSuggestions = [],
  allInvoices = []
) {
  const openInvoices = listOpenInvoices(allInvoices);
  const seen = new Set(existingSuggestions.map((s) => String(s.invoiceId || "")));
  const added = [];
  const stillMissing = [];

  for (const miss of aiMissing || []) {
    const txnProbe = transactionFromMissingRow(transaction, miss);
    const ref = String(miss?.invoiceReference || "").trim();

    let hit =
      (ref ? findOpenInvoiceByReference(ref, openInvoices) : null) ||
      openInvoices.find((inv) => invoiceReferenceMatchesTransaction(txnProbe, inv)) ||
      openInvoices.find((inv) => supplierAmountDateMatch(txnProbe, inv)) ||
      null;

    if (hit && !seen.has(String(hit.id || hit._id))) {
      const id = String(hit.id || hit._id);
      seen.add(id);
      const exact = exactReconciliationMatch(txnProbe, hit);
      const invAbs = Math.abs(Number(hit.amountGross || 0));
      added.push({
        invoiceId: id,
        score: exact ? 100 : 88,
        matchTier: exact ? "exact" : "strong",
        autoReconcile: exact,
        reason: exact
          ? `Facture ${hit.invoiceNumber} — rapprochement direct (référence SEPA)`
          : `Facture ${hit.invoiceNumber} — fournisseur, montant (${invAbs.toFixed(2)} €) et date cohérents`,
        signals: buildMatchSignals(txnProbe, hit, { exact, strong: !exact }),
        invoice: invoiceRowSummary(hit),
      });
      continue;
    }

    stillMissing.push(miss);
  }

  return { suggestions: added, missingInvoices: stillMissing };
}


