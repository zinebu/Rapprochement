import {
  createImportedDocument,
  listImportedDocuments,
  getImportedDocumentById,
  updateImportedDocument,
} from "../storage/import.store.js";
import { dispatchBusinessDocument } from "../services/business-dispatch.service.js";
import { extractDocumentContent } from "../services/file-extractor.service.js";
import { extractInvoiceFieldsFromText } from "../services/invoice-parser.service.js";
import { inferInvoiceNatureHints } from "../services/invoice-nature.service.js";
import { classifyWithOpenAI } from "../services/openai.service.js";
import { resolveDestination } from "../services/dispatch.service.js";

console.log("LOADED import.controller.js VERSION FINAL");

export async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "Aucun fichier reçu",
      });
    }

    const extracted = await extractDocumentContent(
      req.file.path,
      req.file.mimetype,
      req.file.originalname
    );

    let structuredData = null;
    let natureHints = null;
    let classification = {
      label: null,
      confidence: null,
      invoiceNature: null,
      fields: {},
      provider: null,
      raw: null,
    };

    let destination = null;
    let status = "uploaded";

    if (extracted.kind === "error") {
      status = "extraction_failed";
    } else {
      structuredData = extractInvoiceFieldsFromText(extracted.text);

      natureHints = inferInvoiceNatureHints({
        extractedText: extracted.text,
        structuredData,
      });

      try {
        classification = await classifyWithOpenAI({
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          extractedText: extracted.text,
          structuredData,
          natureHints,
          filePath: req.file.path,
          pageImages: extracted.pageImages || [],
        });

        destination = resolveDestination(
          classification.label,
          classification.confidence
        );

        // On garde une info de destination potentielle, mais on n'envoie PAS encore
        status = destination === "a_valider" ? "manual_review" : "analyzed";
      } catch (classificationError) {
        console.error("OpenAI classification error:", classificationError);
        status = "classification_failed";
      }
    }

    const localNature = structuredData?.invoiceNature;
    const localNatureConfidence = natureHints?.confidence;

    if (
      localNature &&
      localNature !== "unknown" &&
      localNatureConfidence === "high"
    ) {
      classification.invoiceNature = localNature;
    }

    const finalDocumentType =
      structuredData?.documentType || classification.label || null;

    const fileUrl = `/uploads/${req.file.filename}`;

    const document = await createImportedDocument({
      fileName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      filePath: req.file.path,
      fileUrl,
      extractedText: extracted.text || null,
      extractionMethod: extracted.method || extracted.kind || null,
      documentType: finalDocumentType,
      invoiceNature: classification.invoiceNature || null,
      status,
      destination,
      classification: {
        label: classification.label,
        confidence: classification.confidence,
        invoiceNature: classification.invoiceNature,
        fields: classification.fields,
        provider: classification.provider,
      },
      structuredData,
    });

    return res.status(201).json({
      success: true,
      message: "Fichier importé et analysé",
      document,
      extraction: {
        kind: extracted.kind,
        preview: extracted.text ? extracted.text.substring(0, 300) : null,
        error: extracted.error || null,
      },
      structuredData,
      natureHints,
      classification: {
        label: classification.label,
        confidence: classification.confidence,
        invoiceNature: classification.invoiceNature,
        fields: classification.fields,
        provider: classification.provider,
      },
      destination,
    });
  } catch (error) {
    console.error("uploadDocument error:", error);
    return res.status(500).json({
      error: "Erreur pendant l'upload",
      details: String(error),
    });
  }
}

export async function sendImportToFactures(req, res) {
  try {
    const { id } = req.params;

    const document = await getImportedDocumentById(id);

    if (!document) {
      return res.status(404).json({
        error: "Document introuvable",
      });
    }

    if (document.status === "sent") {
      return res.status(400).json({
        error: "Ce document a déjà été envoyé dans Factures",
      });
    }

    const businessInput = {
      ...(document.toObject?.() ?? document),
      detectedType:
        document?.classification?.label || document?.documentType || null,
      invoiceNature:
        document?.classification?.invoiceNature ||
        document?.invoiceNature ||
        null,
      structuredData: document?.structuredData || {},
      extractedFields: document?.classification?.fields || {},
      fileUrl: document?.fileUrl || null,
    };

    const businessResult = await dispatchBusinessDocument(businessInput);

    const mappedDestination =
      businessResult?.target === "review"
        ? "a_valider"
        : businessResult?.target || "factures";

    await updateImportedDocument(id, {
      destination: mappedDestination,
      status: "sent",
    });

    const refreshedDocument = await getImportedDocumentById(id);

    return res.status(200).json({
      success: true,
      message: "Document envoyé vers Factures",
      document: refreshedDocument,
      business: businessResult,
    });
  } catch (error) {
    console.error("sendImportToFactures error:", error);
    return res.status(500).json({
      error: "Erreur pendant l'envoi vers Factures",
      details: String(error),
    });
  }
}

export async function listImports(req, res) {
  try {
    const documents = await listImportedDocuments();

    return res.json({
      success: true,
      count: documents.length,
      documents,
    });
  } catch (error) {
    console.error("listImports error:", error);
    return res.status(500).json({
      error: "Erreur pendant la récupération des imports",
      details: String(error),
    });
  }
}

export async function getImportById(req, res) {
  try {
    const { id } = req.params;
    const document = await getImportedDocumentById(id);

    if (!document) {
      return res.status(404).json({
        error: "Document introuvable",
      });
    }

    return res.json({
      success: true,
      document,
    });
  } catch (error) {
    console.error("getImportById error:", error);
    return res.status(500).json({
      error: "Erreur pendant la récupération du document",
      details: String(error),
    });
  }
}