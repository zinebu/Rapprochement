import {
  getReviewQueue,
  getReviewItemById,
  updateReviewItem,
  deleteReviewItemById,
} from "../modules/review/review.store.js";
import { updateImportedDocument } from "../storage/import.store.js";
import { dispatchBusinessDocument } from "../services/business-dispatch.service.js";

function buildAutoInvoiceNumber(doc) {
  const documentId = doc?._id?.toString() || "UNKNOWN";
  return `AUTO-${documentId.slice(-8).toUpperCase()}`;
}

export async function listReviewQueue(req, res) {
  try {
    const items = await getReviewQueue();

    return res.json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    console.error("listReviewQueue error:", error);
    return res.status(500).json({
      error: "Erreur pendant la récupération de la file de validation",
      details: String(error),
    });
  }
}

export async function classifyReviewItem(req, res) {
  try {
    const { id } = req.params;
    const { decision, currency } = req.body || {};

    if (!["purchase", "sales"].includes(decision)) {
      return res.status(400).json({
        error: "La décision doit être 'purchase' ou 'sales'",
      });
    }

    if (!currency) {
      return res.status(400).json({
        error: "La devise est obligatoire pour la validation manuelle",
      });
    }

    const reviewItem = await getReviewItemById(id);

    if (!reviewItem) {
      return res.status(404).json({
        error: "Élément de validation introuvable",
      });
    }

    if (!reviewItem.documentId) {
      return res.status(400).json({
        error: "Aucun document lié à cet élément",
      });
    }

    const doc = reviewItem.documentId;

    const existingInvoiceNumber =
      doc?.classification?.fields?.invoiceNumber ||
      doc?.structuredData?.invoiceNumber ||
      null;

    const resolvedInvoiceNumber =
      existingInvoiceNumber || buildAutoInvoiceNumber(doc);

    const businessResult = await dispatchBusinessDocument({
      ...doc.toObject(),
      detectedType: "invoice",
      invoiceNature: decision,
      structuredData: {
        ...(doc.structuredData || {}),
        currency,
        invoiceNumber: resolvedInvoiceNumber,
      },
      extractedFields: {
        ...(doc.classification?.fields || {}),
        currency,
        invoiceNumber: resolvedInvoiceNumber,
      },
      fileUrl: doc.fileUrl || null,
      id: doc._id.toString(),
    });

    await updateImportedDocument(doc._id.toString(), {
      destination: "factures",
      invoiceNature: decision,
      status: "classified",
      structuredData: {
        ...(doc.structuredData || {}),
        currency,
        invoiceNumber: resolvedInvoiceNumber,
      },
      classification: {
        ...(doc.classification || {}),
        fields: {
          ...(doc.classification?.fields || {}),
          currency,
          invoiceNumber: resolvedInvoiceNumber,
        },
      },
    });

    await updateReviewItem(id, {
      status: "validated",
      decision,
      currency,
      generatedInvoiceNumber: !existingInvoiceNumber,
    });

    return res.json({
      success: true,
      message:
        decision === "purchase"
          ? "Document classé en facture d'achat"
          : "Document classé en facture de vente",
      business: businessResult,
      generatedInvoiceNumber: !existingInvoiceNumber,
      invoiceNumber: resolvedInvoiceNumber,
    });
  } catch (error) {
    console.error("classifyReviewItem error:", error);
    return res.status(500).json({
      error: "Erreur pendant la validation manuelle",
      details: String(error),
    });
  }
}

export async function deleteReviewItem(req, res) {
  try {
    const { id } = req.params;

    const deleted = await deleteReviewItemById(id);

    if (!deleted) {
      return res.status(404).json({
        error: "Élément à valider introuvable",
      });
    }

    return res.json({
      success: true,
      message: "Élément à valider supprimé",
    });
  } catch (error) {
    console.error("deleteReviewItem error:", error);
    return res.status(500).json({
      error: "Erreur pendant la suppression",
      details: String(error),
    });
  }
}