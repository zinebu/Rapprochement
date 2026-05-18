import {
  runImportPipelineForFile,
  dispatchImportedDocumentById,
} from "./import.controller.js";
import { createPurchaseInvoice } from "../modules/invoices/purchase.store.js";
import { createSalesInvoice } from "../modules/invoices/sales.store.js";

function parseFrNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const frMatch = raw.match(/^(\d{1,2})\s+([a-zA-Zéèêëàâîïôöùûüç]+)\s+(\d{4})$/i);
  if (frMatch) {
    const dd = String(frMatch[1]).padStart(2, "0");
    const mmMap = {
      janvier: "01",
      fevrier: "02",
      février: "02",
      mars: "03",
      avril: "04",
      mai: "05",
      juin: "06",
      juillet: "07",
      aout: "08",
      août: "08",
      septembre: "09",
      octobre: "10",
      novembre: "11",
      decembre: "12",
      décembre: "12",
    };
    const month = mmMap[String(frMatch[2]).toLowerCase()] || null;
    if (month) return `${frMatch[3]}-${month}-${dd}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashMatch) {
    const dd = String(slashMatch[1]).padStart(2, "0");
    const mm = String(slashMatch[2]).padStart(2, "0");
    return `${slashMatch[3]}-${mm}-${dd}`;
  }

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function pickInvoiceNature(payload) {
  const explicit =
    payload?.invoiceNature ||
    payload?.nature ||
    payload?.type ||
    payload?.typeprepa ||
    payload?.verificationLiaison ||
    payload?.Header?.nature ||
    payload?.Header?.invoiceNature ||
    process.env.DEFAULT_INVOICE_NATURE ||
    "purchase";
  const n = String(explicit).toLowerCase();
  if (
    n === "sales" ||
    n === "sale" ||
    n === "vente" ||
    n.includes("vente")
  ) {
    return "sales";
  }
  return "purchase";
}

/** ID pièce jointe EspoCRM : souvent identique au paramètre `id=` en fin de lien view/download. */
function attachmentIdFromCrmPdfUrl(url) {
  if (!url || typeof url !== "string") return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(raw, "https://local.invalid/");
    const id = u.searchParams.get("id");
    if (id && id.trim()) return id.trim();
  } catch {
    /* fallback regex ci-dessous */
  }
  const m = raw.match(/[?&#]id=([^&"#\s]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).trim();
  } catch {
    return m[1].trim();
  }
}

function extractCrmInvoicePayload(body = {}) {
  const parsedResultats =
    typeof body?.resultats === "string"
      ? (() => {
          try {
            return JSON.parse(body.resultats);
          } catch {
            return null;
          }
        })()
      : body?.resultats && typeof body.resultats === "object"
        ? body.resultats
        : null;

  const normalized = body?.invoice || body?.fields || parsedResultats || body;
  const amount = normalized?.Amount || {};
  const header = normalized?.Header || {};

  const vatFromList = Array.isArray(amount?.tva)
    ? amount.tva.reduce((sum, t) => sum + parseFrNumber(t?.montant), 0)
    : 0;
  const amountNet = parseFrNumber(amount?.montant_ht || body?.total || body?.montant);
  const amountGross = parseFrNumber(amount?.montant_ttc || body?.ttc || body?.montant);
  const vatRatePercent = parseFrNumber(body?.tva);
  const vatFromRate =
    vatRatePercent > 0 && amountNet > 0 ? amountNet * (vatRatePercent / 100) : 0;
  const vatAmount =
    vatFromList > 0
      ? vatFromList
      : vatFromRate > 0
        ? vatFromRate
        : Math.max(0, amountGross - amountNet);

  const invoiceNumberRaw =
    String(header?.numero || body?.facture || body?.numro || body?.name || "").trim() || null;
  const invoiceNumber = invoiceNumberRaw
    ? invoiceNumberRaw.split(" - ")[0].trim()
    : null;

  const pdfViewUrl =
    String(
      body?.pdfViewUrl ||
        body?.previewUrl ||
        body?.crmFileUrl ||
        normalized?.pdfViewUrl ||
        normalized?.previewUrl ||
        ""
    ).trim() || null;

  const explicitFileId =
    String(
      body?.nomfichierId ||
        normalized?.nomfichierId ||
        body?.attachmentId ||
        body?.fileId ||
        ""
    ).trim() || null;

  const crmFileId = explicitFileId || attachmentIdFromCrmPdfUrl(pdfViewUrl);

  return {
    externalId: body?.id ? String(body.id) : body?.externalId ? String(body.externalId) : null,
    invoiceNature: pickInvoiceNature({ ...body, ...normalized }),
    invoiceNumber,
    invoiceDate: normalizeDate(header?.date || body?.dateF || body?.dateFacture || body?.createdAt),
    dueDate: normalizeDate(header?.date_echeance || body?.dateEcheance),
    amountNet,
    vatAmount,
    amountGross,
    currency:
      String(amount?.devise || body?.ttcCurrency || body?.totalCurrency || "EUR").trim() || "EUR",
    vendorCustomer:
      String(
        header?.fournisseur ||
          body?.fournisseur ||
          body?.accountName ||
          body?.account1Name ||
          ""
      ).trim() || null,
    siret: String(header?.siret || body?.numrcs || "").trim() || null,
    taxNumber: String(header?.taxNumber || "").trim() || null,
    crmFileId,
    crmFileName:
      String(
        body?.nomfichierName ||
          normalized?.nomfichierName ||
          body?.fileName ||
          `${invoiceNumber || "facture"}.pdf`
      ).trim() || null,
    pdfViewUrl,
    raw: normalized,
  };
}

function buildPartnerPdfUrlFromCrmFields(fileId, fileName) {
  if (!fileId) return null;
  const safeName = String(fileName || "facture.pdf");
  return `/api/partner/crm-files/${encodeURIComponent(fileId)}/${encodeURIComponent(safeName)}`;
}

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

/**
 * POST /api/partner/invoices
 * Ingestion directe d'une facture CRM (sans PDF), puis création immédiate en base.
 */
export async function ingestPartnerInvoice(req, res) {
  try {
    const mapped = extractCrmInvoicePayload(req.body || {});
    if (!mapped.invoiceNumber) {
      return res.status(400).json({
        success: false,
        error: "Champ facture manquant: Header.numero (ou name) requis.",
      });
    }

    const commonData = {
      invoiceNumber: mapped.invoiceNumber,
      invoiceDate: mapped.invoiceDate,
      dueDate: mapped.dueDate,
      amountNet: mapped.amountNet,
      vatAmount: mapped.vatAmount,
      amount: mapped.amountGross,
      currency: mapped.currency,
      status: "non_rapprochée",
      sourceDocumentId: null,
      issuerSiret: mapped.siret,
      recipientSiret: null,
      counterpartyRole: mapped.invoiceNature === "purchase" ? "supplier" : "customer",
      // CRM flow: only keep explicit preview/view URLs, never force download links.
      pdfUrl: mapped.pdfViewUrl || null,
    };

    const created =
      mapped.invoiceNature === "sales"
        ? await createSalesInvoice({
            ...commonData,
            clientName: mapped.vendorCustomer || "Client CRM",
            clientSiret: mapped.siret,
            issuerName: mapped.vendorCustomer || "Client CRM",
          })
        : await createPurchaseInvoice({
            ...commonData,
            supplierName: mapped.vendorCustomer || "Fournisseur CRM",
            supplierSiret: mapped.siret,
            issuerName: mapped.vendorCustomer || "Fournisseur CRM",
          });

    const invoiceId = created?._id?.toString?.() || created?.id || null;
    if (invoiceId) {
      try {
        const { onInvoiceCreatedOrUpdated } = await import(
          "../services/reconciliation-import-hook.service.js"
        );
        void onInvoiceCreatedOrUpdated(invoiceId);
      } catch (hookError) {
        console.warn("Reconciliation hook CRM invoice:", hookError?.message || hookError);
      }
    }

    return res.status(201).json({
      success: true,
      invoice: {
        id: invoiceId,
        type: mapped.invoiceNature,
        invoiceNumber: created?.invoiceNumber || mapped.invoiceNumber,
        invoiceDate: created?.invoiceDate || mapped.invoiceDate,
        dueDate: created?.dueDate || mapped.dueDate,
        status: created?.status || "non_rapprochée",
        amountNet: Number(created?.amountNet || mapped.amountNet || 0),
        vatAmount: Number(created?.vatAmount || mapped.vatAmount || 0),
        amountGross: Number(created?.amount || mapped.amountGross || 0),
        currency: created?.currency || mapped.currency,
        vendorCustomer:
          mapped.invoiceNature === "sales"
            ? created?.clientName || mapped.vendorCustomer
            : created?.supplierName || mapped.vendorCustomer,
        externalId: mapped.externalId,
        crmFileId: mapped.crmFileId,
        crmFileName: mapped.crmFileName,
        pdfViewUrl: mapped.pdfViewUrl,
        pdfUrl: created?.pdfUrl || null,
      },
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/E11000/i.test(message)) {
      return res.status(409).json({
        success: false,
        error: "Facture déjà existante (doublon détecté).",
        details: message,
      });
    }
    console.error("ingestPartnerInvoice error:", error);
    return res.status(500).json({
      success: false,
      error: "Erreur pendant la création de la facture CRM.",
      details: message,
    });
  }
}

export async function streamPartnerCrmFile(req, res) {
  try {
    const attachmentId = String(req.params?.attachmentId || "").trim();
    const requestedName = String(req.params?.fileName || "facture.pdf").trim() || "facture.pdf";
    if (!attachmentId) {
      return res.status(400).json({
        success: false,
        error: "attachmentId requis.",
      });
    }

    const base = String(process.env.ESPO_CRM_URL || "").trim().replace(/\/+$/, "");
    if (!base) {
      return res.status(503).json({
        success: false,
        error: "ESPO_CRM_URL non configuré.",
      });
    }

    const headers = {
      Accept: "application/pdf,application/octet-stream,*/*",
    };
    const apiKey = String(process.env.ESPO_CRM_API_KEY || "").trim();
    if (apiKey) headers["X-Api-Key"] = apiKey;
    const basicUser = String(process.env.ESPO_CRM_BASIC_USER || "").trim();
    const basicPass = String(process.env.ESPO_CRM_BASIC_PASSWORD || "").trim();
    if (basicUser && basicPass) {
      headers.Authorization = `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString("base64")}`;
    }

    const possibleTypes = [
      "Attachment",
      "attachment",
      "Nomfichier",
      "nomfichier",
      "Document",
      "document",
      "File",
      "file",
    ];
    const attempts = [];
    const collectIdsFromJson = (input, set) => {
      if (!input || typeof input !== "object") return;
      if (Array.isArray(input)) {
        input.forEach((item) => collectIdsFromJson(item, set));
        return;
      }
      for (const [key, value] of Object.entries(input)) {
        if (typeof value === "string") {
          const v = value.trim();
          const keyLc = key.toLowerCase();
          const likelyKey =
            keyLc.includes("attachment") ||
            keyLc.includes("file") ||
            keyLc.includes("fichier") ||
            keyLc.endsWith("id");
          const idLike = /^[a-z0-9]{12,32}$/i.test(v);
          if (likelyKey && idLike) set.add(v);
        } else if (value && typeof value === "object") {
          collectIdsFromJson(value, set);
        }
      }
    };

    const resolveEntityIds = async (rootId) => {
      const resolved = new Set();
      const jsonHeaders = { ...headers, Accept: "application/json" };
      const entityUrls = [
        `${base}/api/v1/Nomfichier/${encodeURIComponent(rootId)}`,
        `${base}/api/v1/nomfichier/${encodeURIComponent(rootId)}`,
        `${base}/api/v1/SupplierInvoice/${encodeURIComponent(rootId)}`,
        `${base}/api/v1/SuppliersInvoice/${encodeURIComponent(rootId)}`,
      ];
      for (const url of entityUrls) {
        const r = await fetch(url, { method: "GET", headers: jsonHeaders });
        let snippet = "";
        let json = null;
        if (r.ok) {
          try {
            json = await r.json();
            collectIdsFromJson(json, resolved);
          } catch {
            json = null;
          }
        } else {
          try {
            snippet = (await r.text()).slice(0, 220);
          } catch {
            snippet = "";
          }
        }
        attempts.push({
          phase: "resolve-entity",
          url,
          status: r.status,
          ok: r.ok,
          contentType: r.headers.get("content-type") || null,
          snippet,
        });
      }
      return Array.from(resolved);
    };

    const resolvedIds = await resolveEntityIds(attachmentId);
    const candidateIds = Array.from(new Set([attachmentId, ...resolvedIds]));
    const candidates = candidateIds.flatMap((id) => [
      ...possibleTypes.map(
        (type) =>
          `${base}/?entryPoint=download&id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`
      ),
      `${base}/api/v1/Attachment/${encodeURIComponent(id)}/file`,
      `${base}/api/v1/Attachment/file/${encodeURIComponent(id)}`,
      `${base}/api/v1/Nomfichier/${encodeURIComponent(id)}/file`,
      `${base}/api/v1/nomfichier/${encodeURIComponent(id)}/file`,
      `${base}/api/v1/Document/${encodeURIComponent(id)}/file`,
      `${base}/api/v1/File/${encodeURIComponent(id)}/file`,
    ]);

    let upstreamRes = null;
    for (const url of candidates) {
      const attempt = await fetch(url, { method: "GET", headers });
      let snippet = "";
      if (!attempt.ok) {
        try {
          snippet = (await attempt.text()).slice(0, 240);
        } catch {
          snippet = "";
        }
      }
      attempts.push({
        phase: "download",
        url,
        status: attempt.status,
        ok: attempt.ok,
        contentType: attempt.headers.get("content-type") || null,
        snippet,
      });
      if (attempt.ok) {
        upstreamRes = attempt;
        break;
      }
    }

    if (!upstreamRes) {
      return res.status(404).json({
        success: false,
        error: "Fichier CRM introuvable ou inaccessible.",
        attachmentId,
        resolvedIds,
        attempts,
      });
    }

    const contentType = upstreamRes.headers.get("content-type") || "application/pdf";
    const buff = Buffer.from(await upstreamRes.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${requestedName.replace(/"/g, "")}"`
    );
    return res.status(200).send(buff);
  } catch (error) {
    console.error("streamPartnerCrmFile error:", error);
    return res.status(500).json({
      success: false,
      error: "Erreur pendant la récupération du PDF CRM.",
      details: String(error?.message || error),
    });
  }
}
