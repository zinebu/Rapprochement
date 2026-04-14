import { Router } from "express";
import {
  listAllInvoices,
  listPurchaseInvoices,
  listSalesInvoices,
  deleteInvoice,
} from "../controllers/invoice.controller.js";

const router = Router();

router.get("/invoices", listAllInvoices);
router.get("/invoices/purchases", listPurchaseInvoices);
router.get("/invoices/sales", listSalesInvoices);
router.delete("/invoices/:id", deleteInvoice);

export default router;