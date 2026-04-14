import { PurchaseInvoice } from "../../models/PurchaseInvoice.js";

export async function createPurchaseInvoice(data) {
  return await PurchaseInvoice.create({
    sourceDocumentId: data.sourceDocumentId ?? null,
    supplierName: data.supplierName ?? "Fournisseur inconnu",
    supplierSiret: data.supplierSiret ?? null,
    invoiceNumber: data.invoiceNumber ?? null,
    invoiceDate: data.invoiceDate ?? null,
    dueDate: data.dueDate ?? null,
    amountNet: data.amountNet ?? 0,
    vatAmount: data.vatAmount ?? 0,
    amount: data.amount ?? 0,
    currency: data.currency ?? "EUR",
    iban: data.iban ?? null,
    swift: data.swift ?? null,
    pdfUrl: data.pdfUrl ?? null,
    issuerName: data.issuerName ?? null,
    issuerSiret: data.issuerSiret ?? null,
    recipientName: data.recipientName ?? null,
    recipientSiret: data.recipientSiret ?? null,
    counterpartyRole: data.counterpartyRole ?? null,
    status: data.status ?? "non_rapprochée",
  });
}

export async function listPurchaseInvoices() {
  return await PurchaseInvoice.find().sort({ createdAt: -1 });
}
export async function deletePurchaseInvoiceById(id) {
  return await PurchaseInvoice.findByIdAndDelete(id);
}