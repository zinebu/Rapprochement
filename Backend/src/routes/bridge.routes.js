import { Router } from "express";
import {
  createConnectSession,
  getAccounts,
  getTransactions,
  getItems,
  getCategories,
  disconnectBridge,
} from "../controllers/bridge.controller.js";

const router = Router();

router.post("/connect-session", createConnectSession);
router.get("/accounts", getAccounts);
router.get("/transactions", getTransactions);
router.get("/items", getItems);
router.get("/categories", getCategories);
router.post("/disconnect", disconnectBridge);

export default router;