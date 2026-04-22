import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  runGlobalReconciliation,
  scoreReconciliation,
  scoreSepaReconciliation,
  syncReconciliationInvoiceStatus,
} from "../controllers/reconciliation.controller.js";

const router = Router();

router.post("/reconciliation/score", requireAuth, scoreReconciliation);
router.post("/reconciliation/sepa-score", requireAuth, scoreSepaReconciliation);
router.post("/reconciliation/agent-run", requireAuth, runGlobalReconciliation);
router.post("/reconciliation/invoices-status", requireAuth, syncReconciliationInvoiceStatus);

export default router;
