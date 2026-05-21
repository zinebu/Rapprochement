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
    crmDownloadUrl: data.crmDownloadUrl ?? null,
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

export async function updateSalesInvoicesStatusByIds(ids, status) {
  if (!Array.isArray(ids) || ids.length === 0) return { matchedCount: 0, modifiedCount: 0 };
  const result = await SalesInvoice.updateMany(
    { _id: { $in: ids } },
    { $set: { status } }
  );
  return {
    matchedCount: Number(result?.matchedCount || 0),
    modifiedCount: Number(result?.modifiedCount || 0),
  };
}

export async function resetAllSalesInvoicesToUnreconciled() {
  const result = await SalesInvoice.updateMany({}, { $set: { status: "non_rapprochée" } });
  return {
    matchedCount: Number(result?.matchedCount || 0),
    modifiedCount: Number(result?.modifiedCount || 0),
  };
}

export async function deleteSalesInvoiceById(id) {
  return await SalesInvoice.findByIdAndDelete(id);
}

export async function updateSalesInvoiceById(id, fields) {
  if (!id || !fields || typeof fields !== "object") return null;
  return await SalesInvoice.findByIdAndUpdate(
    id,
    { $set: fields },
    { new: true }
  );
}