import { Router } from "express";
import {
  listReviewQueue,
  classifyReviewItem,
  deleteReviewItem,
} from "../controllers/review.controller.js";

const router = Router();

router.get("/review", listReviewQueue);
router.post("/review/:id/classify", classifyReviewItem);
router.delete("/review/:id", deleteReviewItem);

export default router;