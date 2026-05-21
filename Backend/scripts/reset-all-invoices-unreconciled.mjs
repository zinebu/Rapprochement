/**
 * Remet toutes les factures en « non rapprochée » et efface les rapprochements persistés sur les imports.
 * Usage: node scripts/reset-all-invoices-unreconciled.mjs
 */
import "dotenv/config";
import { connectMongo } from "../src/lib/mongoose.js";
import { resetAllPurchaseInvoicesToUnreconciled } from "../src/modules/invoices/purchase.store.js";
import { resetAllSalesInvoicesToUnreconciled } from "../src/modules/invoices/sales.store.js";
import { ImportedDocument } from "../src/models/ImportedDocument.js";

async function main() {
  await connectMongo();

  const purchase = await resetAllPurchaseInvoicesToUnreconciled();
  const sales = await resetAllSalesInvoicesToUnreconciled();

  const importDocs = await ImportedDocument.find({
    $or: [
      { "structuredData.reconciliation": { $exists: true } },
      { "structuredData.sepaBatch": { $exists: true } },
    ],
  });

  let importsCleared = 0;
  for (const doc of importDocs) {
    const structured = doc.structuredData || {};
    let changed = false;
    const next = { ...structured };

    if (structured.reconciliation?.operations) {
      next.reconciliation = { ...structured.reconciliation, operations: {} };
      changed = true;
    }

    if (structured.sepaBatch?.operations?.length) {
      next.sepaBatch = {
        ...structured.sepaBatch,
        operations: structured.sepaBatch.operations.map((op) => ({
          ...op,
          linkedInvoiceIds: [],
        })),
      };
      changed = true;
    }

    if (changed) {
      doc.structuredData = next;
      await doc.save();
      importsCleared += 1;
    }
  }

  console.log("Réinitialisation terminée:", {
    purchase,
    sales,
    importsCleared,
  });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
