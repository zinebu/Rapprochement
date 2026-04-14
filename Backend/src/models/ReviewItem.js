import mongoose from "mongoose";

const ReviewItemSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ImportedDocument",
      required: true,
    },
    reason: String,
    status: { type: String, default: "pending" },
  },
  { timestamps: true }
);

export const ReviewItem = mongoose.model("ReviewItem", ReviewItemSchema);