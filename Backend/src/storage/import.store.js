import { ImportedDocument } from "../models/ImportedDocument.js";

export async function createImportedDocument(data) {
  return await ImportedDocument.create({
    fileName: data.fileName,
    originalName: data.originalName ?? null,
    mimeType: data.mimeType ?? null,
    filePath: data.filePath ?? null,
    fileUrl: data.fileUrl ?? null,
    fileData: data.fileData ?? null,
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
  // Exclude heavy binary field from list queries
  return await ImportedDocument.find().select("-fileData").sort({ createdAt: -1 });
}

export async function getImportedDocumentById(id) {
  // Exclude binary data by default; serveImportFile fetches it separately
  return await ImportedDocument.findById(id).select("-fileData");
}

export async function getImportedDocumentWithFileById(id) {
  return await ImportedDocument.findById(id);
}

export async function updateImportedDocument(id, patch) {
  return await ImportedDocument.findByIdAndUpdate(id, patch, { new: true });
}

export async function deleteImportedDocument(id) {
  return await ImportedDocument.findByIdAndDelete(id);
}