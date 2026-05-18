import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  engineMatchReconciliation,
  getReconciliationProposals,
  recalculateReconciliation,
  runGlobalReconciliation,
  scoreReconciliation,
  scoreSepaReconciliation,
  streamReconciliationEvents,
  syncReconciliationInvoiceStatus,
} from "../controllers/reconciliation.controller.js";

const router = Router();

router.get("/reconciliation/proposals", requireAuth, getReconciliationProposals);
router.get("/reconciliation/events", requireAuth, streamReconciliationEvents);
router.post("/reconciliation/engine-match", requireAuth, engineMatchReconciliation);
router.post("/reconciliation/recalculate", requireAuth, recalculateReconciliation);
router.post("/reconciliation/score", requireAuth, scoreReconciliation);
router.post("/reconciliation/sepa-score", requireAuth, scoreSepaReconciliation);
router.post("/reconciliation/agent-run", requireAuth, runGlobalReconciliation);
router.post("/reconciliation/invoices-status", requireAuth, syncReconciliationInvoiceStatus);

export default router;
