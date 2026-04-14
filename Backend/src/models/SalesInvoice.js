import mongoose from "mongoose";

const SalesInvoiceSchema = new mongoose.Schema(
  {
    sourceDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ImportedDocument",
      default: null,
    },
    clientName: { type: String, required: true },
    clientSiret: String,
    invoiceNumber: { type: String, required: true },
    invoiceDate: String,
    dueDate: String,
    amountNet: { type: Number, default: 0 },
    vatAmount: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "EUR" },
    iban: String,
    swift: String,
    pdfUrl: String,
    issuerName: String,
    issuerSiret: String,
    recipientName: String,
    recipientSiret: String,
    counterpartyRole: String,
   status: { type: String, default: "non_rapprochee" },
  },
  { timestamps: true }
);

SalesInvoiceSchema.index(
  { clientName: 1, invoiceNumber: 1, invoiceDate: 1, amount: 1 },
  { unique: true }
);

export const SalesInvoice = mongoose.model(
  "SalesInvoice",
  SalesInvoiceSchema
);