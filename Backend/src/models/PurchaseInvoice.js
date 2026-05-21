import mongoose from "mongoose";

const PurchaseInvoiceSchema = new mongoose.Schema(
  {
    sourceDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ImportedDocument",
      default: null,
    },
    supplierName: { type: String, required: true },
    supplierSiret: String,
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
    /** URL CRM directe (entryPoint=download) pour le proxy fichier. */
    crmDownloadUrl: String,
    issuerName: String,
    issuerSiret: String,
    recipientName: String,
    recipientSiret: String,
    counterpartyRole: String,
    status: { type: String, default: "pending" },
  },
  { timestamps: true }
);

PurchaseInvoiceSchema.index(
  { supplierName: 1, invoiceNumber: 1, invoiceDate: 1, amount: 1 },
  { unique: true }
);

export const PurchaseInvoice = mongoose.model(
  "PurchaseInvoice",
  PurchaseInvoiceSchema
);