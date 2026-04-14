import {
  deletePurchaseInvoiceById,
  listPurchaseInvoices as listPurchaseInvoicesFromStore,
} from "../modules/invoices/purchase.store.js";
import {
  deleteSalesInvoiceById,
  listSalesInvoices as listSalesInvoicesFromStore,
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