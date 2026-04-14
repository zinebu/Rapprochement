import { ImportedDocument } from "../models/ImportedDocument.js";

export async function createImportedDocument(data) {
  return await ImportedDocument.create({
    fileName: data.fileName,
    originalName: data.originalName ?? null,
    mimeType: data.mimeType ?? null,
    filePath: data.filePath ?? null,
    fileUrl: data.fileUrl ?? null,
    extractedText: data.extractedText ?? null,
    extractionMethod: data.extractionMethod ?? null,
    documentType: data.documentType ?? null,
    invoiceNature: data.invoiceNature ?? null,
    status: data.status ?? "uploaded",
    destination: data.destination ?? null,
    classification: data.classification ?? null,
    structuredData: data.structuredData ?? null,
  });
}

export async function listImportedDocuments() {
  return await ImportedDocument.find().sort({ createdAt: -1 });
}

export async function getImportedDocumentById(id) {
  return await ImportedDocument.findById(id);
}

export async function updateImportedDocument(id, patch) {
  return await ImportedDocument.findByIdAndUpdate(id, patch, { new: true });
}