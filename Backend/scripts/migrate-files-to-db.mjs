/**
 * One-time migration: reads files from Backend/uploads/ and stores their
 * binary content in MongoDB so they are accessible from any server.
 *
 * Run from the Backend directory:
 *   node scripts/migrate-files-to-db.mjs
 */
import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, "../uploads");

await mongoose.connect(process.env.MONGODB_URI);
console.log("MongoDB connecté");

const col = mongoose.connection.collection("importeddocuments");

const docs = await col
  .find({ $or: [{ fileData: null }, { fileData: { $exists: false } }] })
  .project({ _id: 1, fileName: 1, filePath: 1, fileUrl: 1 })
  .toArray();

console.log(`Documents sans fileData : ${docs.length}`);

let migrated = 0;
let skipped = 0;

for (const doc of docs) {
  const diskPath =
    doc.filePath && path.isAbsolute(doc.filePath)
      ? doc.filePath
      : path.join(uploadsDir, doc.fileName);

  try {
    const data = await fs.readFile(diskPath);
    await col.updateOne(
      { _id: doc._id },
      {
        $set: {
          fileData: data,
          fileUrl: `/api/imports/${doc._id}/file`,
        },
      }
    );
    console.log(`  OK  ${doc.fileName}`);
    migrated++;
  } catch {
    // Update URL even if file isn't on this disk
    await col.updateOne(
      { _id: doc._id },
      { $set: { fileUrl: `/api/imports/${doc._id}/file` } }
    );
    console.log(`  SKIP (not on disk) ${doc.fileName}`);
    skipped++;
  }
}

// Also sync pdfUrl in invoice collections
const urlMap = new Map(
  (await col.find({ fileUrl: { $regex: "^/api/imports/" } }).project({ _id: 1, fileUrl: 1 }).toArray())
    .map((d) => [String(d._id), d.fileUrl])
);

for (const collName of ["purchaseinvoices", "salesinvoices"]) {
  const invoices = await mongoose.connection
    .collection(collName)
    .find({ pdfUrl: { $regex: "^/uploads/" } })
    .project({ _id: 1, sourceDocumentId: 1 })
    .toArray();
  let upd = 0;
  for (const inv of invoices) {
    const newUrl = urlMap.get(String(inv.sourceDocumentId));
    if (newUrl) {
      await mongoose.connection
        .collection(collName)
        .updateOne({ _id: inv._id }, { $set: { pdfUrl: newUrl } });
      upd++;
    }
  }
  if (upd > 0) console.log(`${collName}: ${upd} pdfUrl mis à jour`);
}

console.log(`\nTerminé — migré: ${migrated}, sauté: ${skipped}`);
await mongoose.disconnect();
