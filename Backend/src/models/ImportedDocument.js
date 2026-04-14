import mongoose from "mongoose";

const ImportedDocumentSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    originalName: String,
    mimeType: String,
    filePath: String,
    fileUrl: String,
    extractedText: String,
    extractionMethod: String,
    documentType: String,
    invoiceNature: String,
    status: { type: String, default: "uploaded" },
    destination: String,
    classification: mongoose.Schema.Types.Mixed,
    structuredData: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

export const ImportedDocument = mongoose.model(
  "ImportedDocument",
  ImportedDocumentSchema
);