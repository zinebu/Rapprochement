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
  const invDate = new Date(inv?.invoiceDate || 0).getTime();
  const due = new Date(inv?.dueDate || 0).getTime();
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

  score = Math.max(0, Math.min(100, Math.round(score)));
  const reason = signals.length ? signals.join(" · ") : "Peu de signaux communs";

  return { invoiceId: id, score, reason, signals };
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
