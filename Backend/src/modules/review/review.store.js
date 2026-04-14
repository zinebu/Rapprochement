import { ReviewItem } from "../../models/ReviewItem.js";

export async function addToReviewQueue(data) {
  return await ReviewItem.create({
    documentId: data.documentId,
    reason: data.reason ?? null,
    status: "pending",
  });
}

export async function getReviewQueue() {
  return await ReviewItem.find({ status: "pending" })
    .populate("documentId")
    .sort({ createdAt: -1 });
}

export async function getReviewItemById(id) {
  return await ReviewItem.findById(id).populate("documentId");
}

export async function updateReviewItem(id, patch) {
  return await ReviewItem.findByIdAndUpdate(id, patch, {
    returnDocument: "after",
  });
}

export async function deleteReviewItemById(id) {
  return await ReviewItem.findByIdAndDelete(id);
}