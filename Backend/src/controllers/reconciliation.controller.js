import {
  runGlobalReconciliationAgent,
  scoreReconciliationWithAgent,
  scoreSepaReconciliationWithAgent,
} from "../services/openai-agents.service.js";
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
    const { transaction, invoices } = req.body || {};
    if (!transaction || !Array.isArray(invoices)) {
      return res.status(400).json({ error: "transaction et invoices requis" });
    }

    const ai = await scoreReconciliationWithAgent({ transaction, invoices });
    if (!ai || !Array.isArray(ai)) {
      return res.status(503).json({
        error: "Agent IA indisponible pour le rapprochement",
      });
    }

    const allowedIds = new Set(invoices.map((inv) => String(inv.id || inv._id || "")).filter(Boolean));
    const sanitized = ai
      .map((row) => ({
        invoiceId: String(row?.invoiceId || ""),
        invoiceIds: Array.isArray(row?.invoiceIds) ? row.invoiceIds.map((x) => String(x)) : [],
        matchType: row?.matchType || "1:1",
        score: Number(row?.score || 0),
        reason: String(row?.reason || ""),
        signals: Array.isArray(row?.signals) ? row.signals.map((x) => String(x)) : [],
      }))
      .filter((row) => allowedIds.has(row.invoiceId))
      .filter((row) => row.score >= 0 && row.score <= 100)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return res.json({ success: true, suggestions: sanitized, scoring: "ai-only" });
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
