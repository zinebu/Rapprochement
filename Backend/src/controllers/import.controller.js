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

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function isPlausibleBankStatementData(data) {
  if (!data || data.documentType !== "bank_statement") return false;
  if (!Array.isArray(data.operations) || data.operations.length === 0) return false;
  return data.operations.some(
    (op) =>
      typeof op?.amount === "number" &&
      Number.isFinite(op.amount) &&
      isIsoDate(op.txnDate) &&
      typeof op?.label === "string" &&
      op.label.trim().length >= 3
  );
}

function chooseBestBankStatementData(localData, agentData) {
  const localValid = isPlausibleBankStatementData(localData);
  const agentValid = isPlausibleBankStatementData(agentData);
  if (agentValid && !localValid) return agentData;
  if (localValid && !agentValid) return localData;
  if (!localValid && !agentValid) return localData || agentData || null;

  const localOps = Array.isArray(localData?.operations) ? localData.operations : [];
  const agentOps = Array.isArray(agentData?.operations) ? agentData.operations : [];
  const localWithRefs = localOps.filter((op) => String(op?.reference || "").trim().length >= 3).length;
  const agentWithRefs = agentOps.filter((op) => String(op?.reference || "").trim().length >= 3).length;

  // Prefer richer extraction, but avoid replacing local output with sparse AI output.
  if (agentOps.length >= localOps.length + 2 && agentWithRefs >= localWithRefs) return agentData;
  return localData;
}

function chooseBestSepaData(localData, agentData) {
  const localOps = localData?.sepaBatch?.operations;
  const agentOps = agentData?.sepaBatch?.operations;
  const localCount = Array.isArray(localOps) ? localOps.length : 0;
  const agentCount = Array.isArray(agentOps) ? agentOps.length : 0;
  if (localCount > 0 && agentCount === 0) return localData;
  if (agentCount > 0 && localCount === 0) return agentData;
  if (localCount >= agentCount) return localData || agentData || null;
  return agentData || localData || null;
}

function isStrongBankStatementStructuredData(data) {
  if (!data || data.documentType !== "bank_statement") return false;
  const ops = Array.isArray(data.operations) ? data.operations : [];
  if (ops.length < 2) return false;
  const account = data.account || {};
  const hasAccountSignals = Boolean(
    (typeof account.iban === "string" && account.iban.trim().length >= 10) ||
      account.statementFrom ||
      account.statementTo
  );
  return hasAccountSignals;
}

function isStrongSepaStructuredData(data) {
  if (!data || data.documentType !== "sepa_xml") return false;
  const ops = data?.sepaBatch?.operations;
  return Array.isArray(ops) && ops.length > 0;
}

function isStrongInvoiceStructuredData(data) {
  if (!data || data.documentType !== "invoice") return false;
  const hasNumber = Boolean(String(data.invoiceNumber || "").trim());
  const hasAmounts =
    typeof data.amountInclVat === "number" ||
    typeof data.amountNet === "number" ||
    typeof data.vatAmount === "number";
  const hasParty = Boolean(String(data.vendorCustomer || "").trim());
  return hasNumber || (hasAmounts && hasParty);
}

function mapInvoiceStructuredToFields(data) {
  if (!data || data.documentType !== "invoice") return {};
  return {
    issuerName: data?.issuer?.name || null,
    issuerSiret: data?.issuer?.siret || null,
    recipientName: data?.recipient?.name || null,
    recipientSiret: data?.recipient?.siret || null,
    counterpartyRole: data?.counterpartyRole || null,
    invoiceNumber: data?.invoiceNumber || null,
    invoiceDate: data?.invoiceDate || null,
    dueDate: data?.dueDate || null,
    vatNumber: data?.vatNumber || null,
    iban: data?.iban || null,
    swift: data?.swift || null,
    reasonOfPayment: data?.reasonOfPayment || null,
    amountNet: data?.amountNet ?? null,
    vatAmount: data?.vatAmount ?? null,
    amountInclVat: data?.amountInclVat ?? null,
    vendorCustomer: data?.vendorCustomer || null,
    currency: data?.currency || null,
  };
}

function nameLooksLikeInvoiceFile(fileName = "") {
  return /\bfacture\b|\binvoice\b|fac[-_0-9]/i.test(String(fileName || ""));
}

function sanitizeFieldName(value) {
  if (value === null || value === undefined) return value;
  const str = String(value).trim();
  if (!str) return null;
  const cut = str
    .split(
      /\b(?:total|montant|tva|ht\b|ttc\b|siret|siren|iban|bic|swift|r[èe]glement|date|facture|n[°º]|t[ée]l|email|@|adresse|page|esplanade|rue|avenue|boulevard)\b/i
    )[0]
    .trim();
  const cleaned = cut
    .replace(/[^A-Za-zì-ÿ0-9&'().,\-\/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > 90) return cleaned.slice(0, 90).trim();
  return cleaned;
}

/**
 * Override invoiceNature using company SIRET / DEFAULT_INVOICE_NATURE env vars.
 * This fixes the common OCR confusion where our own company letterhead is
 * picked up as the invoice issuer on received (purchase) invoices.
 *
 * Priority:
 *  1. If recipient SIRET === COMPANY_SIRET → purchase (high confidence)
 *  2. If issuer SIRET === COMPANY_SIRET   → trust DEFAULT_INVOICE_NATURE
 *     (OCR likely read our header first on a received invoice)
 *  3. No SIRET match + DEFAULT_INVOICE_NATURE configured → use default
 *  4. Otherwise keep the provided nature unchanged
 */
function overrideInvoiceNatureIfNeeded(currentNature, structuredData = {}) {
  const defaultNature = String(process.env.DEFAULT_INVOICE_NATURE || "").trim().toLowerCase();
  const companySiret  = String(process.env.COMPANY_SIRET || "").trim().replace(/\s/g, "");

  const issuerSiret    = String(structuredData?.issuer?.siret    || "").trim().replace(/\s/g, "");
  const recipientSiret = String(structuredData?.recipient?.siret || "").trim().replace(/\s/g, "");

  if (companySiret) {
    const issuerIsCompany    = Boolean(issuerSiret    && issuerSiret    === companySiret);
    const recipientIsCompany = Boolean(recipientSiret && recipientSiret === companySiret);

    // Unambiguous: we are the recipient → this is a purchase
    if (recipientIsCompany && !issuerIsCompany) return "purchase";

    // Our SIRET on the issuer side: OCR confusion → trust configured default
    if (issuerIsCompany && !recipientIsCompany && defaultNature) return defaultNature;
  }

  // No SIRET signal: if a default is configured, use it as fallback
  if (defaultNature && (!currentNature || currentNature === "unknown")) return defaultNature;

  return currentNature;
}

function sanitizeClassificationFields(fields = {}) {
  if (!fields || typeof fields !== "object") return fields;
  const nameKeys = ["issuerName", "recipientName", "vendorCustomer"];
  const clean = { ...fields };
  for (const key of nameKeys) {
    if (clean[key] !== undefined) clean[key] = sanitizeFieldName(clean[key]);
  }
  return clean;
}

/**
 * Shared pipeline: given a just-uploaded file (from multer), runs extraction,
 * classification, structured parsing and creates the ImportedDocument record.
 * Returns the saved document plus intermediate metadata, WITHOUT dispatching
 * to Factures/Banque (that step is explicit).
 */
export async function runImportPipelineForFile(file) {
  if (!file) {
    throw new Error("Aucun fichier reçu");
  }

  const extracted = await extractDocumentContent(
    file.path,
    file.mimetype,
    file.originalname
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
      file.originalname || ""
    );
    const nameLooksLikeInvoice = nameLooksLikeInvoiceFile(file.originalname || "");
    const looksLikeSepaXml =
      file.mimetype === "application/xml" ||
      file.mimetype === "text/xml" ||
      /\.xml$/i.test(file.originalname || "");

    const importAgentClassification =
      (await classifyImportDocumentAgent({
        fileName: file.originalname,
        mimeType: file.mimetype,
        extractedText: extracted.text || "",
      })) || null;

    if (importAgentClassification) {
      classification.label = importAgentClassification.label;
      classification.confidence = importAgentClassification.confidence;
      classification.provider = importAgentClassification.provider;
    }

    structuredData = extractInvoiceFieldsFromText(extracted.text);
    let bankStructuredData = null;
    const shouldTryLocalBankParser =
      looksLikeSepaXml ||
      nameLooksLikeBankStatement ||
      classification.label === "sepa_xml" ||
      classification.label === "bank_statement";
    if (shouldTryLocalBankParser) {
      bankStructuredData = extractBankOrSepaData({
        extractedText: extracted.text,
        mimeType: file.mimetype,
        originalName: file.originalname,
        extractedStructuredData: extracted.structuredData,
      });
    }

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
        const aiSepa = {
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
        bankStructuredData = chooseBestSepaData(bankStructuredData, aiSepa);
      }
    } else if (classification.label === "bank_statement") {
      const statementAgentData = await parseBankStatementWithAgent({
        extractedText: extracted.text || "",
        fileName: file.originalname,
      });
      if (statementAgentData?.documentType === "bank_statement") {
        const aiBank = normalizeBankStatementPayload(statementAgentData);
        bankStructuredData = chooseBestBankStatementData(bankStructuredData, aiBank);
      }
    }

    if (bankStructuredData) {
      structuredData = bankStructuredData;
    } else if (nameLooksLikeBankStatement) {
      structuredData = {
        documentType: "bank_statement",
        account: {
          sourceName: file.originalname || null,
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
      const shouldRunDeepExtraction =
        !classification.label ||
        classification.label === "invoice" ||
        classification.label === "receipt" ||
        classification.label === "unknown";

      if (shouldRunDeepExtraction) {
        const deepClassification = await classifyWithOpenAI({
          fileName: file.originalname,
          mimeType: file.mimetype,
          extractedText: extracted.text,
          structuredData,
          natureHints,
          filePath: file.path,
          pageImages: extracted.pageImages || [],
        });
        if (deepClassification) {
          classification = deepClassification;
        }
      }

      destination = resolveDestination(
        classification.label,
        classification.confidence
      );

      status = destination === "a_valider" ? "manual_review" : "analyzed";
    } catch (classificationError) {
      console.error("OpenAI classification error:", classificationError);
      status = "classification_failed";
    }

    const strongBankData = isStrongBankStatementStructuredData(structuredData);
    const strongSepaData = isStrongSepaStructuredData(structuredData);
    const strongInvoiceData = isStrongInvoiceStructuredData(structuredData);

    console.log("[import] diagnostic", {
      file: file.originalname,
      mimeType: file.mimetype,
      classificationLabel: classification.label,
      classificationConfidence: classification.confidence,
      structuredDocType: structuredData?.documentType,
      strongInvoiceData,
      strongBankData,
      strongSepaData,
      nameLooksLikeBankStatement,
      nameLooksLikeInvoice,
      looksLikeSepaXml,
      invoiceNumber: structuredData?.invoiceNumber || null,
      vendorCustomer: structuredData?.vendorCustomer || null,
    });

    if (strongInvoiceData) {
      classification.label = "invoice";
      classification.confidence = Math.max(Number(classification.confidence || 0), 0.9);
      const aiFields = sanitizeClassificationFields(classification.fields || {});
      const localFields = mapInvoiceStructuredToFields(structuredData);
      const localFieldsClean = Object.fromEntries(
        Object.entries(localFields).filter(
          ([, v]) => v !== null && v !== undefined && v !== ""
        )
      );
      classification.fields = {
        ...aiFields,
        ...localFieldsClean,
      };
      const rawNature =
        structuredData?.invoiceNature && structuredData.invoiceNature !== "unknown"
          ? structuredData.invoiceNature
          : classification.invoiceNature || "unknown";
      classification.invoiceNature = overrideInvoiceNatureIfNeeded(rawNature, structuredData);
    }

    if (classification?.fields && typeof classification.fields === "object") {
      classification.fields = sanitizeClassificationFields(classification.fields);
    }

    if (!strongInvoiceData && strongBankData) {
      classification.label = "bank_statement";
      classification.confidence = Math.max(
        Number(classification.confidence || 0),
        0.9
      );
    }

    if (!strongInvoiceData && strongSepaData) {
      classification.label = "sepa_xml";
      classification.confidence = Math.max(
        Number(classification.confidence || 0),
        0.95
      );
    }

    if (!strongInvoiceData && (strongBankData || strongSepaData)) {
      destination = "banque";
      status = "sent";
    } else if (strongInvoiceData || nameLooksLikeInvoice) {
      destination = "factures";
      status = "analyzed";
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
    classification.invoiceNature = overrideInvoiceNatureIfNeeded(localNature, structuredData);
  } else if (classification.invoiceNature) {
    // Always run the override check before saving, regardless of confidence
    classification.invoiceNature = overrideInvoiceNatureIfNeeded(
      classification.invoiceNature,
      structuredData
    );
  }

  // Ensure structuredData.invoiceNature is consistent with the corrected classification
  if (structuredData && classification.invoiceNature && structuredData.documentType === "invoice") {
    structuredData.invoiceNature = classification.invoiceNature;
  }

  const finalDocumentType =
    structuredData?.documentType || classification.label || null;

  const fileUrl = `/uploads/${file.filename}`;

  const document = await createImportedDocument({
    fileName: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    filePath: file.path,
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

  return {
    document,
    extraction: extracted,
    structuredData,
    natureHints,
    classification,
    destination,
  };
}

/**
 * Shared dispatcher: given an ImportedDocument id, routes it to the correct
 * downstream module (Factures or Banque/SEPA) and returns the updated document.
 */
export async function dispatchImportedDocumentById(id) {
  const document = await getImportedDocumentById(id);
  if (!document) {
    const err = new Error("Document introuvable");
    err.statusCode = 404;
    throw err;
  }

  if (document.status === "sent") {
    return {
      document,
      business: {
        target: document.destination || null,
        duplicated: true,
        alreadySent: true,
      },
    };
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
  const structured = document?.structuredData || {};
  const strongBankData = isStrongBankStatementStructuredData(structured);
  const strongSepaData = isStrongSepaStructuredData(structured);
  const strongInvoiceData = isStrongInvoiceStructuredData(structured);
  const invoiceLikeName = nameLooksLikeInvoiceFile(originalName);
  const fileLooksLikeBankStatement = /relev|releve|extrait.*compte|statement/.test(
    originalName
  );
  const fileLooksLikeSepa =
    mimeType.includes("xml") || originalName.endsWith(".xml");

  if (
    !strongInvoiceData &&
    !invoiceLikeName &&
    (
      strongBankData ||
      strongSepaData ||
      ((businessInput.detectedType === "bank_statement" || businessInput.detectedType === "sepa_xml") &&
        (fileLooksLikeBankStatement || fileLooksLikeSepa))
    )
  ) {
    await updateImportedDocument(id, {
      destination: "banque",
      status: "sent",
    });
    const refreshed = await getImportedDocumentById(id);
    return {
      document: refreshed,
      business: { target: "banque", duplicated: false },
    };
  }

  const businessResult = await dispatchBusinessDocument(businessInput);

  const mappedDestination =
    businessResult?.target === "review"
      ? "a_valider"
      : businessResult?.target === "sales" || businessResult?.target === "purchase"
        ? "factures"
        : businessResult?.target || "factures";

  await updateImportedDocument(id, {
    destination: mappedDestination,
    status: "sent",
  });

  const refreshed = await getImportedDocumentById(id);

  return {
    document: refreshed,
    business: businessResult,
  };
}

export async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "Aucun fichier reçu",
      });
    }

    const result = await runImportPipelineForFile(req.file);
    const { document, extraction, structuredData, natureHints, classification, destination } = result;

    return res.status(201).json({
      success: true,
      message: "Fichier importé et analysé",
      document,
      extraction: {
        kind: extraction.kind,
        preview: extraction.text ? extraction.text.substring(0, 300) : null,
        error: extraction.error || null,
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
    const existing = await getImportedDocumentById(id);
    if (!existing) {
      return res.status(404).json({ error: "Document introuvable" });
    }
    if (existing.status === "sent") {
      const destinationLabel =
        existing.destination === "banque" ? "Banque" : "Factures";
      return res.status(400).json({
        error: `Ce document a déjà été envoyé vers ${destinationLabel}`,
      });
    }

    const { document, business } = await dispatchImportedDocumentById(id);
    const target = business?.target;
    const message =
      target === "banque"
        ? "Document envoyé vers Banque"
        : "Document envoyé vers Factures";

    return res.status(200).json({
      success: true,
      message,
      document,
      business,
    });
  } catch (error) {
    if (error?.statusCode === 404) {
      return res.status(404).json({ error: error.message });
    }
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