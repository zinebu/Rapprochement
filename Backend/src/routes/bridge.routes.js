import { Router } from "express";
import {
  createConnectSession,
  getAccounts,
  getTransactions,
  getItems,
  getCategories,
} from "../controllers/bridge.controller.js";

const router = Router();

router.post("/connect-session", createConnectSession);
router.get("/accounts", getAccounts);
router.get("/transactions", getTransactions);
router.get("/items", getItems);
router.get("/categories", getCategories);

export default router;