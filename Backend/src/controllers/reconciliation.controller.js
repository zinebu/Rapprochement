import {
  runGlobalReconciliationAgent,
  scoreReconciliationWithAgent,
  scoreSepaReconciliationWithAgent,
} from "../services/openai-agents.service.js";
import {
  buildLocalSuggestion,
  findInvoiceCombinations,
  filterEligibleInvoices,
  mergeAiWithLocal,
} from "../services/reconciliation-scoring.service.js";
import {
  listPurchaseInvoices as listPurchaseInvoicesFromStore,
  updatePurchaseInvoicesStatusByIds,
} from "../modules/invoices/purchase.store.js";
import {
  listSalesInvoices as listSalesInvoicesFromStore,
  updateSalesInvoicesStatusByIds,
} from "../modules/invoices/sales.store.js";

export async function scoreReconciliation(req, res) {
  try {
    const engineVersion = "reco-v3-sepa-context-guard";
    const { transaction, invoices } = req.body || {};
    if (!transaction || !Array.isArray(invoices)) {
      return res.status(400).json({ error: "transaction et invoices requis" });
    }

    const isSepaTxn =
      Boolean(transaction?.sepaContext) ||
      String(transaction?.paymentMethod || "").toUpperCase() === "SEPA" ||
      /\bsepa\b/i.test(String(transaction?.label || "")) ||
      /\bsepa\b/i.test(String(transaction?.reference || "")) ||
      String(transaction?.id || "").startsWith("batch::") ||
      String(transaction?.id || "").includes("::");

    // 1. Filtrer les factures éligibles : non rapprochées + plage 12 mois
    const eligible = filterEligibleInvoices(transaction, invoices);

    // 2. Combinaisons uniquement pour SEPA.
    //    Pour les opérations classiques, on garde le comportement ai-only/local sans combos.
    const combinations = isSepaTxn
      ? findInvoiceCombinations(transaction, eligible.length > 0 ? eligible : invoices)
      : [];

    const candidateInvoices = eligible.length > 0 ? eligible : invoices;

    // 3. Suggestions individuelles locales (fallback + garde-fous)
    const localSuggestions = candidateInvoices
      .map((inv) => buildLocalSuggestion(transaction, inv))
      .filter((s) => s.score >= 15)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    // 4. Suggestions IA (prioritaires), fusionnées avec le scoring local pour rester explicables.
    const validInvoiceIds = new Set(candidateInvoices.map((inv) => String(inv.id || inv._id || "")));
    const localById = new Map(localSuggestions.map((s) => [String(s.invoiceId), s]));
    const invoiceById = new Map(
      candidateInvoices.map((inv) => [String(inv.id || inv._id || ""), inv])
    );

    let aiSuggestions = null;
    try {
      aiSuggestions = await scoreReconciliationWithAgent({
        transaction,
        invoices: candidateInvoices,
      });
    } catch (error) {
      console.warn("scoreReconciliationWithAgent fallback local:", error?.message || error);
      aiSuggestions = null;
    }

    let suggestions = localSuggestions;
    if (Array.isArray(aiSuggestions) && aiSuggestions.length > 0) {
      const merged = aiSuggestions
        .map((ai) => {
          const invoiceId = String(ai?.invoiceId || "");
          if (!invoiceId || !validInvoiceIds.has(invoiceId)) return null;
          const baseLocal =
            localById.get(invoiceId) ||
            buildLocalSuggestion(transaction, invoiceById.get(invoiceId));
          if (!baseLocal) return null;

          const blended = mergeAiWithLocal(
            baseLocal,
            Number(ai?.score || 0),
            String(ai?.reason || "")
          );
          const aiSignals = Array.isArray(ai?.signals)
            ? ai.signals.map((s) => String(s)).filter(Boolean)
            : [];

          return {
            invoiceId,
            score: blended.score,
            reason: blended.reason,
            signals: [...new Set([...(baseLocal.signals || []), ...aiSignals])],
          };
        })
        .filter(Boolean)
        .filter((s) => s.score >= 20)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      if (merged.length > 0) suggestions = merged;
    }

    // Strict production guardrail:
    // Never suggest absurd matches (huge amount gap + unrelated supplier name).
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
    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const tokenize = (s) => norm(s).split(/\s+/).filter((w) => w.length >= 4 && !stopWords.has(w));
    const similarSupplier = (a, b) => {
      const ta = tokenize(a);
      const tb = tokenize(b);
      if (ta.length === 0 || tb.length === 0) return false;
      return ta.some((w) => tb.includes(w));
    };

    const txnAbs = Math.abs(Number(transaction?.amount || 0));
    const txnCounterparty =
      transaction?.counterpartyName ||
      transaction?.bankMeta?.beneficiary ||
      transaction?.bankMeta?.debtor ||
      "";
    suggestions = suggestions.filter((s) => {
      const inv = invoiceById.get(String(s.invoiceId));
      if (!inv) return false;
      const invAbs = Math.abs(Number(inv.amountGross || 0));
      const amountDiff = Math.abs(txnAbs - invAbs);
      const sameSupplier = similarSupplier(txnCounterparty, inv.vendorCustomer || "");
      const hasCounterparty = tokenize(txnCounterparty).length > 0;
      const hasRefSignal =
        String(s.reason || "").toLowerCase().includes("référence") ||
        String(s.reason || "").toLowerCase().includes("reference") ||
        (Array.isArray(s.signals) &&
          s.signals.some((sig) =>
            String(sig || "")
              .toLowerCase()
              .includes("référence") ||
            String(sig || "")
              .toLowerCase()
              .includes("reference")
          ));

      // Hard constraints requested by business, but keep valid cases:
      // - If counterparty exists: enforce similar supplier name.
      // - Amount should be exact/quasi exact (<= 1€), except exact reference signal (<= 20€).
      // - For SEPA, individual suggestions stay strict; sums are handled by combinations.
      if (hasCounterparty && !sameSupplier) return false;
      if (amountDiff > 1 && !(hasRefSignal && amountDiff <= 20 && !isSepaTxn)) return false;
      if (isSepaTxn && amountDiff > 1) return false;
      return true;
    });

    // Dédupliquer : les factures déjà dans une combinaison 100% n'ont pas besoin d'apparaître seules.
    const exactComboIds = new Set(
      combinations
        .filter((c) => c.score === 100)
        .flatMap((c) => c.invoiceIds)
    );
    suggestions = suggestions.filter((s) => !exactComboIds.has(s.invoiceId));

    // For non-SEPA flows: keep response minimal and compatible with prior ai-only behavior.
    if (!isSepaTxn) {
      return res.json({
        success: true,
        suggestions,
        scoring: Array.isArray(aiSuggestions) && aiSuggestions.length > 0 ? "ai-only" : "local-only",
        engineVersion,
      });
    }

    return res.json({
      success: true,
      suggestions,
      combinations,
      scoring: Array.isArray(aiSuggestions) && aiSuggestions.length > 0
        ? "ai+local+combinations"
        : "local+combinations",
      engineVersion,
    });
  } catch (error) {
    console.error("scoreReconciliation error:", error);
    return res.status(500).json({
      error: "Erreur scoring rapprochement",
      details: String(error),
    });
  }
}

export async function scoreSepaReconciliation(req, res) {
  try {
    const { sepaBatch, invoices } = req.body || {};
    if (!sepaBatch || !Array.isArray(invoices)) {
      return res.status(400).json({ error: "sepaBatch et invoices requis" });
    }
    const ai = await scoreSepaReconciliationWithAgent({ sepaBatch, invoices });
    if (!ai) {
      return res.status(503).json({
        error: "Agent IA indisponible pour le rapprochement SEPA",
      });
    }
    return res.json({ success: true, ...ai, scoring: "ai-only" });
  } catch (error) {
    console.error("scoreSepaReconciliation error:", error);
    return res.status(500).json({
      error: "Erreur scoring rapprochement SEPA",
      details: String(error),
    });
  }
}

export async function runGlobalReconciliation(req, res) {
  try {
    const { operations, invoices, sepaBatches } = req.body || {};
    if (!Array.isArray(operations) || !Array.isArray(invoices)) {
      return res.status(400).json({ error: "operations et invoices requis" });
    }
    const ai = await runGlobalReconciliationAgent({
      operations,
      invoices,
      sepaBatches: Array.isArray(sepaBatches) ? sepaBatches : [],
    });
    if (!ai) {
      return res.status(503).json({ error: "Agent IA indisponible pour le rapprochement global" });
    }
    return res.json({ success: true, ...ai, scoring: "ai-only" });
  } catch (error) {
    console.error("runGlobalReconciliation error:", error);
    return res.status(500).json({
      error: "Erreur rapprochement global",
      details: String(error),
    });
  }
}

export async function syncReconciliationInvoiceStatus(req, res) {
  try {
    const { toReconciled = [], toUnreconciled = [] } = req.body || {};

    const recIds = Array.isArray(toReconciled)
      ? Array.from(new Set(toReconciled.map((x) => String(x)).filter(Boolean)))
      : [];
    const unrecIds = Array.isArray(toUnreconciled)
      ? Array.from(new Set(toUnreconciled.map((x) => String(x)).filter(Boolean)))
      : [];

    const purchaseRows = await listPurchaseInvoicesFromStore();
    const salesRows = await listSalesInvoicesFromStore();
    const purchaseIdSet = new Set(
      purchaseRows.flatMap((inv) => [String(inv?._id || ""), String(inv?.id || "")]).filter(Boolean)
    );
    const salesIdSet = new Set(
      salesRows.flatMap((inv) => [String(inv?._id || ""), String(inv?.id || "")]).filter(Boolean)
    );

    const recPurchaseIds = recIds.filter((id) => purchaseIdSet.has(id));
    const recSalesIds = recIds.filter((id) => salesIdSet.has(id));
    const unrecPurchaseIds = unrecIds.filter((id) => purchaseIdSet.has(id));
    const unrecSalesIds = unrecIds.filter((id) => salesIdSet.has(id));

    const recPurchase = await updatePurchaseInvoicesStatusByIds(recPurchaseIds, "rapprochée");
    const recSales = await updateSalesInvoicesStatusByIds(recSalesIds, "rapprochée");
    const unrecPurchase = await updatePurchaseInvoicesStatusByIds(unrecPurchaseIds, "non_rapprochée");
    const unrecSales = await updateSalesInvoicesStatusByIds(unrecSalesIds, "non_rapprochée");

    return res.json({
      success: true,
      message: "Statuts factures synchronisés",
      stats: {
        input: {
          toReconciled: recIds.length,
          toUnreconciled: unrecIds.length,
        },
        reconciled: { purchase: recPurchase, sales: recSales },
        unreconciled: { purchase: unrecPurchase, sales: unrecSales },
      },
    });
  } catch (error) {
    console.error("syncReconciliationInvoiceStatus error:", error);
    return res.status(500).json({
      error: "Erreur synchronisation statuts factures",
      details: String(error),
    });
  }
}
