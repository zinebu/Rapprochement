import { requireAuth } from "../middleware/auth.middleware.js";
import { Router } from "express";
import {
  listReviewQueue,
  classifyReviewItem,
  deleteReviewItem,
} from "../controllers/review.controller.js";

const router = Router();

router.get("/review", requireAuth, listReviewQueue);
router.post("/review/:id/classify", requireAuth, classifyReviewItem);
router.delete("/review/:id", requireAuth, deleteReviewItem);

export default router;
