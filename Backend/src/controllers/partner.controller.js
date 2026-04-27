import {
  runImportPipelineForFile,
  dispatchImportedDocumentById,
} from "./import.controller.js";

/**
 * POST /api/partner/documents
 *
 * Pipeline complet : ingestion d'un fichier (PDF/XML/CSV/image), extraction,
 * classification (facture / relevé bancaire / SEPA XML), puis dispatch
 * automatique vers le module correspondant (Factures ou Banque).
 *
 * Le client partenaire envoie un fichier via multipart/form-data (champ `file`).
 * Champs optionnels en form-data (métadonnées) :
 *   - externalId : identifiant côté Jupiter, repris tel quel en retour
 *   - note       : note libre associée au dépôt
 */
export async function ingestPartnerDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Aucun fichier reçu (champ 'file' requis en multipart/form-data).",
      });
    }

    const externalId = req.body?.externalId ? String(req.body.externalId) : null;
    const note = req.body?.note ? String(req.body.note) : null;

    const pipelineResult = await runImportPipelineForFile(req.file);
    const createdDoc = pipelineResult.document;
    const createdId = createdDoc?._id?.toString?.() || createdDoc?.id || null;

    let dispatchResult = null;
    let dispatchError = null;
    if (createdId) {
      try {
        dispatchResult = await dispatchImportedDocumentById(createdId);
      } catch (e) {
        dispatchError = String(e?.message || e);
      }
    }

    const finalDoc = dispatchResult?.document || createdDoc;
    const finalTarget =
      dispatchResult?.business?.target ||
      finalDoc?.destination ||
      pipelineResult.destination ||
      null;

    const classification = pipelineResult.classification || {};

    return res.status(201).json({
      success: true,
      externalId,
      note,
      document: {
        id: createdId,
        fileName: finalDoc?.fileName || null,
        originalName: finalDoc?.originalName || null,
        mimeType: finalDoc?.mimeType || null,
        status: finalDoc?.status || null,
        destination: finalDoc?.destination || null,
        documentType: finalDoc?.documentType || null,
        invoiceNature: finalDoc?.invoiceNature || null,
        fileUrl: finalDoc?.fileUrl || null,
        createdAt: finalDoc?.createdAt || null,
      },
      routing: {
        target: finalTarget,
        label:
          finalTarget === "banque"
            ? "Module Banque / SEPA"
            : finalTarget === "factures" || finalTarget === "sales" || finalTarget === "purchase"
              ? "Module Factures"
              : finalTarget === "a_valider"
                ? "File d'attente de validation manuelle"
                : "Non dispatché",
        autoDispatched: Boolean(dispatchResult),
        dispatchError,
      },
      classification: {
        label: classification.label || null,
        confidence: classification.confidence ?? null,
        provider: classification.provider || null,
        invoiceNature: classification.invoiceNature || null,
        fields: classification.fields || null,
      },
      structuredData: pipelineResult.structuredData || null,
    });
  } catch (error) {
    console.error("ingestPartnerDocument error:", error);
    return res.status(500).json({
      success: false,
      error: "Erreur pendant l'ingestion du document partenaire.",
      details: String(error?.message || error),
    });
  }
}

/**
 * GET /api/partner/documents/:id
 * Permet au partenaire de connaître le statut d'un document qu'il a déposé.
 */
export async function getPartnerDocumentStatus(req, res) {
  try {
    const { id } = req.params;
    const { getImportedDocumentById } = await import(
      "../storage/import.store.js"
    );
    const doc = await getImportedDocumentById(id);
    if (!doc) {
      return res.status(404).json({ success: false, error: "Document introuvable" });
    }
    return res.json({
      success: true,
      document: {
        id: doc._id?.toString?.() || doc.id,
        fileName: doc.fileName || null,
        originalName: doc.originalName || null,
        status: doc.status || null,
        destination: doc.destination || null,
        documentType: doc.documentType || null,
        invoiceNature: doc.invoiceNature || null,
        createdAt: doc.createdAt || null,
        updatedAt: doc.updatedAt || null,
      },
    });
  } catch (error) {
    console.error("getPartnerDocumentStatus error:", error);
    return res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération du statut.",
      details: String(error?.message || error),
    });
  }
}

/**
 * GET /api/partner/health
 */
export function partnerHealth(req, res) {
  return res.json({
    success: true,
    service: "partner-ingest",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
