import mongoose from "mongoose";

const reconciliationProposalSchema = new mongoose.Schema(
  {
    bankTransactionId: { type: String, default: null, index: true },
    invoiceId: { type: String, default: null, index: true },
    scopeType: {
      type: String,
      enum: ["bank_transaction", "sepa_line", "sepa_batch"],
      default: "bank_transaction",
      index: true,
    },
    scopeId: { type: String, required: true, index: true },
    proposalData: { type: mongoose.Schema.Types.Mixed, default: null },
    score: { type: Number, default: 0 },
    explanation: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "validated", "rejected"],
      default: "pending",
    },
    sourceHash: { type: String, required: true, index: true },
    processingStatus: {
      type: String,
      enum: ["not_processed", "processing", "processed", "failed"],
      default: "not_processed",
      index: true,
    },
    processingError: { type: String, default: null },
    scoring: { type: String, default: null },
    engineVersion: { type: String, default: null },
  },
  { timestamps: true }
);

reconciliationProposalSchema.index({ scopeType: 1, scopeId: 1 }, { unique: true });
reconciliationProposalSchema.index({ bankTransactionId: 1, sourceHash: 1 });

export const ReconciliationProposal =
  mongoose.models.ReconciliationProposal ||
  mongoose.model("ReconciliationProposal", reconciliationProposalSchema);
