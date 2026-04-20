import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  createConnectSession,
  getAccounts,
  getTransactions,
  getItems,
  getCategories,
} from "../controllers/bridge.controller.js";

const router = Router();

router.post("/connect-session", requireAuth, createConnectSession);
router.get("/accounts", requireAuth, getAccounts);
router.get("/transactions", requireAuth, getTransactions);
router.get("/items", requireAuth, getItems);
router.get("/categories", requireAuth, getCategories);

export default router;