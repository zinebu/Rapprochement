import { listPurchaseInvoices as listPurchaseInvoicesFromStore } from "../modules/invoices/purchase.store.js";
import { listSalesInvoices as listSalesInvoicesFromStore } from "../modules/invoices/sales.store.js";
import { parseMoneyToNumber } from "../utils/amount.js";

function toFrontInvoice(invoice, type) {
  const amountNet = parseMoneyToNumber(invoice.amountNet);
  const vatAmount = parseMoneyToNumber(invoice.vatAmount);
  let amountGross = parseMoneyToNumber(invoice.amount);
  if (amountGross === 0 && amountNet > 0) {
    amountGross = vatAmount > 0 ? amountNet + vatAmount : amountNet;
  } else if (amountGross > 0 && amountNet > 0 && vatAmount > 0) {
    if (Math.abs(amountGross - amountNet) < 1) {
      amountGross = amountNet + vatAmount;
    }
  }
  const vendorCustomer =
    type === "purchase"
      ? invoice.supplierName || invoice.issuerName || invoice.recipientName || "Fournisseur inconnu"
      : invoice.clientName || invoice.recipientName || invoice.issuerName || "Client inconnu";

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
    currency: invoice.currency || "EUR",
  };
}

export async function listAllInvoicesForReconciliation() {
  const purchaseRows = await listPurchaseInvoicesFromStore();
  const salesRows = await listSalesInvoicesFromStore();
  return [
    ...purchaseRows.map((inv) => toFrontInvoice(inv, "purchase")),
    ...salesRows.map((inv) => toFrontInvoice(inv, "sales")),
  ];
}

export function listOpenInvoices(invoices = []) {
  return invoices.filter((inv) => {
    const status = String(inv?.status || "").toLowerCase();
    return !["rapprochée", "rapprochee", "rapproché", "reconciled"].includes(status);
  });
}
