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

// Désactiver l'authentification en développement
const authMiddleware = process.env.NODE_ENV === "production" ? requireAuth : (req, res, next) => next();

router.post("/import/upload", authMiddleware, upload.single("file"), uploadDocument);
router.post("/imports/:id/send", authMiddleware, sendImportToFactures);
router.get("/imports", authMiddleware, listImports);
router.get("/imports/:id", authMiddleware, getImportById);
router.delete("/imports/:id", authMiddleware, deleteImportById);

// Route de développement pour contourner l'authentification
router.delete("/dev-imports/:id", deleteImportById);

// Route de test simple
router.get("/test-delete", (req, res) => {
  res.json({ message: "Route de test fonctionne", timestamp: new Date().toISOString() });
});

export default router;