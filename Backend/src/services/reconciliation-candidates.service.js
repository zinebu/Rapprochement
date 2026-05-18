import { filterEligibleInvoices } from "./reconciliation-scoring.service.js";
import { listOpenInvoices } from "./reconciliation-invoices.service.js";

/**
 * Factures candidates pour une opération (ouverte, devise/sens/date cohérents).
 * Utilisé pour le source_hash et le moteur de rapprochement.
 */
export function buildCandidateInvoicesForTransaction(transaction, allInvoices = []) {
  const open = listOpenInvoices(allInvoices);
  return filterEligibleInvoices(transaction, open);
}
