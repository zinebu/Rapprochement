import { Router } from "express";
import multer from "multer";
import path from "path";
import { requireAuth } from "../middleware/auth.middleware.js";

import {
  uploadDocument,
  listImports,
  getImportById,
  sendImportToFactures,
  deleteImportById,
  saveImportReconciliation,
} from "../controllers/import.controller.js";

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

    cb(null, `${Date.now()}-${baseName}${ext}`);
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
]);

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error(`Type de fichier non supporté: ${file.mimetype}`));
  },
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

router.post("/import/upload", requireAuth, upload.single("file"), uploadDocument);
router.post("/imports/:id/send", requireAuth, sendImportToFactures);
router.get("/imports", requireAuth, listImports);
router.get("/imports/:id", requireAuth, getImportById);
router.delete("/imports/:id", requireAuth, deleteImportById);
router.post("/imports/:id/reconciliation", requireAuth, saveImportReconciliation);

export default router;