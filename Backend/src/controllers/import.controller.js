import {
  createImportedDocument,
  listImportedDocuments,
  getImportedDocumentById,
  updateImportedDocument,
  deleteImportedDocument,
} from "../storage/import.store.js";
import fs from "fs";
import { dispatchBusinessDocument } from "../services/business-dispatch.service.js";
import { extractDocumentContent } from "../services/file-extractor.service.js";
import { extractInvoiceFieldsFromText } from "../services/invoice-parser.service.js";
import { extractBankOrSepaData } from "../services/bank-parser.service.js";
import {
  classifyImportDocumentAgent,
  parseSepaWithAgent,
  parseBankStatementWithAgent,
} from "../services/openai-agents.service.js";
import { inferInvoiceNatureHints } from "../services/invoice-nature.service.js";
import { classifyWithOpenAI } from "../services/openai.service.js";
import { resolveDestination } from "../services/dispatch.service.js";

console.log("LOADED import.controller.js VERSION FINAL");

function normalizeBankOperationAmount(op = {}) {
  const rawAmount = Number(op.amount || 0);
  const absAmount = Math.abs(rawAmount);
  const opType = String(op.operationType || "").toLowerCase();
  const hay = `${op.label || ""} ${op.reference || ""} ${op.bankOperationType || ""}`.toLowerCase();

  if (rawAmount < 0) return rawAmount;
  if (opType === "decaissement") return -absAmount;
  if (opType === "encaissement") return absAmount;

  if (/\bvir\.?\s*re[çc]u\b|\bencaissement\b|\bversement\b|\bcr[eé]dit\b/.test(hay)) {
    return absAmount;
  }
  if (/\brem\s+vir\s+sepa\b|\bfourn\b|\bvir\.?\s*[eé]mis\b|\bpr[eé]l[eè]v|\bcb\b|\bcarte\b|\bd[eé]bit\b/.test(hay)) {
    return -absAmount;
  }
  return -absAmount;
}

function normalizeBankStatementPayload(statementAgentData) {
  if (!statementAgentData || !Array.isArray(statementAgentData.operations)) {
    return statementAgentData;
  }
  const normalizedOps = statementAgentData.operations.map((op) => {
    const amount = normalizeBankOperationAmount(op);
    return {
      ...op,
      amount,
      operationType: amount >= 0 ? "encaissement" : "decaissement",
    };
  });
  return {
    ...statementAgentData,
    operations: normalizedOps,
  };
}

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
      const nameLooksLikeBankStatement = /relev|releve|extrait.*compte|statement/i.test(
        req.file.originalname || ""
      );
      const looksLikeSepaXml =
        req.file.mimetype === "application/xml" ||
        req.file.mimetype === "text/xml" ||
        /\.xml$/i.test(req.file.originalname || "");

      const importAgentClassification =
        (await classifyImportDocumentAgent({
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          extractedText: extracted.text || "",
        })) || null;

      if (importAgentClassification) {
        classification.label = importAgentClassification.label;
        classification.confidence = importAgentClassification.confidence;
        classification.provider = importAgentClassification.provider;
      }

      structuredData = extractInvoiceFieldsFromText(extracted.text);
      let bankStructuredData = extractBankOrSepaData({
        extractedText: extracted.text,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        extractedStructuredData: extracted.structuredData,
      });

      if (classification.label === "sepa_xml") {
        const sepaAgentData = await parseSepaWithAgent({
          extractedText: extracted.text || "",
          structuredXml: extracted.structuredData || {},
        });
        if (sepaAgentData?.documentType === "sepa_xml") {
          const computedTotal = sepaAgentData.sepaBatch.operations.reduce(
            (sum, op) => sum + Number(op.amount || 0),
            0
          );
          const effectiveTotal =
            typeof sepaAgentData.sepaBatch.totalAmount === "number"
              ? sepaAgentData.sepaBatch.totalAmount
              : computedTotal;
          bankStructuredData = {
            ...sepaAgentData,
            summarizedOperation: {
              id: `scanned-sepa-${sepaAgentData.sepaBatch.id}`,
              txnDate: sepaAgentData.sepaBatch.executionDate || null,
              label: `SEPA XML ${sepaAgentData.sepaBatch.id}`,
              reference: sepaAgentData.sepaBatch.id,
              amount: -Math.abs(effectiveTotal),
              currency: sepaAgentData.sepaBatch.debtorCurrency || "EUR",
              operationType: "decaissement",
              paymentMethod: "SEPA",
              counterpartyName: sepaAgentData.sepaBatch.debtorName || "SEPA",
              source: "scanned",
            },
          };
        }
      } else if (classification.label === "bank_statement") {
        const statementAgentData = await parseBankStatementWithAgent({
          extractedText: extracted.text || "",
          fileName: req.file.originalname,
        });
        if (statementAgentData?.documentType === "bank_statement") {
          bankStructuredData = normalizeBankStatementPayload(statementAgentData);
        }
      }

      if (bankStructuredData) {
        structuredData = bankStructuredData;
      } else if (nameLooksLikeBankStatement) {
        structuredData = {
          documentType: "bank_statement",
          account: {
            sourceName: req.file.originalname || null,
            currency: "EUR",
          },
          operations: [],
        };
      }

      natureHints = inferInvoiceNatureHints({
        extractedText: extracted.text,
        structuredData,
      });

      try {
        if (!classification.label) {
          classification = await classifyWithOpenAI({
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            extractedText: extracted.text,
            structuredData,
            natureHints,
            filePath: req.file.path,
            pageImages: extracted.pageImages || [],
          });
        }

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

      if (structuredData?.documentType === "bank_statement") {
        classification.label = "bank_statement";
        classification.confidence = Math.max(
          Number(classification.confidence || 0),
          0.9
        );
      }

      if (structuredData?.documentType === "sepa_xml") {
        classification.label = "sepa_xml";
        classification.confidence = Math.max(
          Number(classification.confidence || 0),
          0.95
        );
      }

      if (
        structuredData?.documentType === "bank_statement" ||
        structuredData?.documentType === "sepa_xml"
      ) {
        destination = "banque";
        status = "sent";
      } else if (nameLooksLikeBankStatement || looksLikeSepaXml) {
        classification.label = looksLikeSepaXml ? "sepa_xml" : "bank_statement";
        classification.confidence = Math.max(
          Number(classification.confidence || 0),
          0.9
        );
        destination = "banque";
        status = "sent";
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
      const destinationLabel =
        document.destination === "banque" ? "Banque" : "Factures";
      return res.status(400).json({
        error: `Ce document a déjà été envoyé vers ${destinationLabel}`,
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

    const originalName = String(document?.originalName || "").toLowerCase();
    const mimeType = String(document?.mimeType || "").toLowerCase();
    const fileLooksLikeBankStatement = /relev|releve|extrait.*compte|statement/.test(
      originalName
    );
    const fileLooksLikeSepa =
      mimeType.includes("xml") || originalName.endsWith(".xml");

    if (
      businessInput.detectedType === "bank_statement" ||
      businessInput.detectedType === "sepa_xml" ||
      fileLooksLikeBankStatement ||
      fileLooksLikeSepa
    ) {
      await updateImportedDocument(id, {
        destination: "banque",
        status: "sent",
      });

      const refreshedBankDocument = await getImportedDocumentById(id);

      return res.status(200).json({
        success: true,
        message: "Document envoyé vers Banque",
        document: refreshedBankDocument,
        business: {
          target: "banque",
          duplicated: false,
        },
      });
    }

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

export async function deleteImportById(req, res) {
  try {
    const { id } = req.params;
    const document = await getImportedDocumentById(id);

    if (!document) {
      return res.status(404).json({
        error: "Document introuvable",
      });
    }

    if (document.filePath && fs.existsSync(document.filePath)) {
      try {
        fs.unlinkSync(document.filePath);
      } catch (fileError) {
        console.warn("Suppression fichier import échouée:", fileError);
      }
    }

    await deleteImportedDocument(id);

    return res.json({
      success: true,
      message: "Import supprimé",
    });
  } catch (error) {
    console.error("deleteImportById error:", error);
    return res.status(500).json({
      error: "Erreur pendant la suppression de l'import",
      details: String(error),
    });
  }
}

export async function saveImportReconciliation(req, res) {
  try {
    const { id } = req.params;
    const { operationId, patch } = req.body || {};

    if (!operationId || !patch || typeof patch !== "object") {
      return res.status(400).json({
        error: "operationId et patch sont requis",
      });
    }

    const document = await getImportedDocumentById(id);
    if (!document) {
      return res.status(404).json({
        error: "Document introuvable",
      });
    }

    const structuredData = document.structuredData || {};
    const reconciliation = structuredData.reconciliation || {};
    const operations = reconciliation.operations || {};
    const current = operations[operationId] || {};

    const nextOperations = {
      ...operations,
      [operationId]: {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    };

    const updated = await updateImportedDocument(id, {
      structuredData: {
        ...structuredData,
        reconciliation: {
          ...reconciliation,
          operations: nextOperations,
        },
      },
    });

    return res.json({
      success: true,
      message: "Rapprochement sauvegardé",
      document: updated,
    });
  } catch (error) {
    console.error("saveImportReconciliation error:", error);
    return res.status(500).json({
      error: "Erreur pendant la sauvegarde du rapprochement",
      details: String(error),
    });
  }
}