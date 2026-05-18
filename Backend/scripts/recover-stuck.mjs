import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../src/lib/mongoose.js";
import { recoverStuckReconciliationJobs } from "../src/services/reconciliation-job.service.js";
import { ReconciliationProposal } from "../src/models/ReconciliationProposal.js";

await connectMongo();
const meta = await recoverStuckReconciliationJobs({ limit: 50 });
console.log("recover", meta);
await new Promise((r) => setTimeout(r, 30000));
const agg = await ReconciliationProposal.aggregate([
  { $group: { _id: "$processingStatus", n: { $sum: 1 } } },
]);
console.log("after", agg);
const sample = await ReconciliationProposal.find({
  scopeId: { $not: { $regex: "::" } },
})
  .limit(8)
  .lean();
for (const s of sample) {
  console.log(
    String(s.scopeId || "").slice(0, 40),
    s.processingStatus,
    s.proposalData?.scoring,
    (s.proposalData?.suggestions || []).length
  );
}
await mongoose.disconnect();
