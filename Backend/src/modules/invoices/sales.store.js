import { SalesInvoice } from "../../models/SalesInvoice.js";

export async function createSalesInvoice(data) {
  return await SalesInvoice.create({
    sourceDocumentId: data.sourceDocumentId ?? null,
    clientName: data.clientName ?? "Client inconnu",
    clientSiret: data.clientSiret ?? null,
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

export async function listSalesInvoices() {
  return await SalesInvoice.find().sort({ createdAt: -1 });
}
export async function deleteSalesInvoiceById(id) {
  return await SalesInvoice.findByIdAndDelete(id);
}