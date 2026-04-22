import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  listAllInvoices,
  listPurchaseInvoices,
  listSalesInvoices,
  deleteInvoice,
  syncInvoiceReconciliationStatus,
} from "../controllers/invoice.controller.js";

const router = Router();

router.get("/invoices",requireAuth, listAllInvoices);
router.get("/invoices/purchases", requireAuth, listPurchaseInvoices);
router.get("/invoices/sales", requireAuth, listSalesInvoices);
router.delete("/invoices/:id", requireAuth, deleteInvoice);
router.post("/invoices/reconciliation-status", requireAuth, syncInvoiceReconciliationStatus);

export default router;