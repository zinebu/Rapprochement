import {
  deletePurchaseInvoiceById,
  listPurchaseInvoices as listPurchaseInvoicesFromStore,
  updatePurchaseInvoicesStatusByIds,
  updatePurchaseInvoiceById,
} from "../modules/invoices/purchase.store.js";
import {
  deleteSalesInvoiceById,
  listSalesInvoices as listSalesInvoicesFromStore,
  updateSalesInvoicesStatusByIds,
  updateSalesInvoiceById,
} from "../modules/invoices/sales.store.js";
import { parseMoneyToNumber } from "../utils/amount.js";

function toFrontInvoice(invoice, type) {
  const amountNet = parseMoneyToNumber(invoice.amountNet);
  const vatAmount = parseMoneyToNumber(invoice.vatAmount);

  let amountGross = parseMoneyToNumber(invoice.amount);

  if (amountGross === 0 && amountNet > 0) {
    amountGross = vatAmount > 0 ? amountNet + vatAmount : amountNet;
  }

  const vatRate =
    amountNet > 0 && vatAmount > 0 ? (vatAmount / amountNet) * 100 : 0;

  const vendorCustomer =
    type === "purchase"
      ? invoice.supplierName ||
        invoice.issuerName ||
        invoice.recipientName ||
        "Fournisseur inconnu"
      : invoice.clientName ||
        invoice.recipientName ||
        invoice.issuerName ||
        "Client inconnu";

  return {
    id: invoice.id || invoice._id?.toString(),
    type,
    vendorCustomer,
    invoiceNumber: invoice.invoiceNumber || "",
    invoiceDate: invoice.invoiceDate || "",
    dueDate: invoice.dueDate || "",
    status: invoice.status || "non_rapprochée",
    amountNet,
    vatAmount,
    amountGross,
    vatRate,
    currency: invoice.currency || null,
    category: type === "purchase" ? "Facture d'achat" : "Facture de vente",
    pdfUrl: invoice.pdfUrl || null,
  };
}

export async function listAllInvoices(req, res) {
  try {
    const purchaseRows = await listPurchaseInvoicesFromStore();
    const salesRows = await listSalesInvoicesFromStore();

    const purchases = purchaseRows.map((inv) => toFrontInvoice(inv, "purchase"));
    const sales = salesRows.map((inv) => toFrontInvoice(inv, "sales"));

    const invoices = [...purchases, ...sales].sort((a, b) => {
      const da = new Date(a.invoiceDate || 0).getTime();
      const db = new Date(b.invoiceDate || 0).getTime();
      return db - da;
    });

    return res.json({
      success: true,
      invoices,
    });
  } catch (error) {
    console.error("listAllInvoices error:", error);
    return res.status(500).json({
      error: "Erreur pendant la récupération des factures",
      details: String(error),
    });
  }
}

export async function listPurchaseInvoices(req, res) {
  try {
    const purchaseRows = await listPurchaseInvoicesFromStore();
    const purchases = purchaseRows.map((inv) =>
      toFrontInvoice(inv, "purchase")
    );

    return res.json({
      success: true,
      invoices: purchases,
    });
  } catch (error) {
    console.error("listPurchaseInvoices error:", error);
    return res.status(500).json({
      error: "Erreur pendant la récupération des factures d'achat",
      details: String(error),
    });
  }
}

export async function listSalesInvoices(req, res) {
  try {
    const salesRows = await listSalesInvoicesFromStore();
    const sales = salesRows.map((inv) => toFrontInvoice(inv, "sales"));

    return res.json({
      success: true,
      invoices: sales,
    });
  } catch (error) {
    console.error("listSalesInvoices error:", error);
    return res.status(500).json({
      error: "Erreur pendant la récupération des factures de vente",
      details: String(error),
    });
  }
}

export async function deleteInvoice(req, res) {
  try {
    const { id } = req.params;

    const deletedPurchase = await deletePurchaseInvoiceById(id);
    if (deletedPurchase) {
      return res.json({
        success: true,
        message: "Facture d'achat supprimée",
      });
    }

    const deletedSales = await deleteSalesInvoiceById(id);
    if (deletedSales) {
      return res.json({
        success: true,
        message: "Facture de vente supprimée",
      });
    }

    return res.status(404).json({
      error: "Facture introuvable",
    });
  } catch (error) {
    console.error("deleteInvoice error:", error);
    return res.status(500).json({
      error: "Erreur pendant la suppression de la facture",
      details: String(error),
    });
  }
}

function normalizeInvoiceDateInput(value) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const str = String(value).trim();
  if (!str) return null;
  // Accept ISO (YYYY-MM-DD), DD/MM/YYYY, DD-MM-YYYY
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const fr = /^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/;
  if (iso.test(str)) return str;
  const m = str.match(fr);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return undefined;
}

export async function updateInvoice(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};

    const fields = {};
    if (body.invoiceDate !== undefined) {
      const normalized = normalizeInvoiceDateInput(body.invoiceDate);
      if (normalized === undefined) {
        return res.status(400).json({
          error: "Format de date invalide (attendu: YYYY-MM-DD ou DD/MM/YYYY)",
        });
      }
      fields.invoiceDate = normalized;
    }
    if (body.dueDate !== undefined) {
      const normalized = normalizeInvoiceDateInput(body.dueDate);
      if (normalized === undefined) {
        return res.status(400).json({
          error: "Format de date d'échéance invalide",
        });
      }
      fields.dueDate = normalized;
    }

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({
        error: "Aucun champ à mettre à jour",
      });
    }

    let updated = await updatePurchaseInvoiceById(id, fields);
    let type = "purchase";
    if (!updated) {
      updated = await updateSalesInvoiceById(id, fields);
      type = "sales";
    }

    if (!updated) {
      return res.status(404).json({ error: "Facture introuvable" });
    }

    return res.json({
      success: true,
      message: "Facture mise à jour",
      invoice: toFrontInvoice(updated, type),
    });
  } catch (error) {
    console.error("updateInvoice error:", error);
    return res.status(500).json({
      error: "Erreur pendant la mise à jour de la facture",
      details: String(error),
    });
  }
}

export async function syncInvoiceReconciliationStatus(req, res) {
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
        reconciled: {
          purchase: recPurchase,
          sales: recSales,
        },
        unreconciled: {
          purchase: unrecPurchase,
          sales: unrecSales,
        },
      },
    });
  } catch (error) {
    console.error("syncInvoiceReconciliationStatus error:", error);
    return res.status(500).json({
      error: "Erreur synchronisation statuts factures",
      details: String(error),
    });
  }
}