import mongoose from "mongoose";

const reconciliationJobSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ["bank_transaction", "invoice", "sepa_batch"],
      required: true,
      index: true,
    },
    entityId: { type: String, required: true, index: true },
    scopeId: { type: String, required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    sourceHash: { type: String, default: null },
    status: {
      type: String,
      enum: ["not_processed", "processing", "processed", "failed"],
      default: "not_processed",
      index: true,
    },
    error: { type: String, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

reconciliationJobSchema.index({ status: 1, createdAt: 1 });

export const ReconciliationJob =
  mongoose.models.ReconciliationJob ||
  mongoose.model("ReconciliationJob", reconciliationJobSchema);
