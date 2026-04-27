import { Router } from "express";
import multer from "multer";
import path from "path";
import { requireApiKey } from "../middleware/apiKey.middleware.js";
import {
  ingestPartnerDocument,
  getPartnerDocumentStatus,
  partnerHealth,
} from "../controllers/partner.controller.js";

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path
      .basename(file.originalname, ext)
      .replace(/\s+/g, "_")
      .replace(/[^\w\-]/g, "");
    cb(null, `${Date.now()}-partner-${baseName}${ext}`);
  },
});

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "text/csv",
  "application/xml",
  "text/xml",
  "application/octet-stream",
]);

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const mimeOk = allowedMimeTypes.has(file.mimetype);
    const extOk = /\.(pdf|png|jpe?g|webp|csv|xml)$/i.test(file.originalname || "");
    if (mimeOk || extOk) return cb(null, true);
    cb(new Error(`Type de fichier non supporté: ${file.mimetype}`));
  },
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

router.get("/health", partnerHealth);
router.post(
  "/documents",
  requireApiKey,
  upload.single("file"),
  ingestPartnerDocument
);
router.get("/documents/:id", requireApiKey, getPartnerDocumentStatus);

export default router;
