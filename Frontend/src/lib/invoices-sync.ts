/** Émis quand la liste des factures change (Factures, Import, etc.) pour resynchroniser Banque. */
export const INVOICES_CHANGED_EVENT = "settle-it:invoices-changed";

export function notifyInvoicesChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(INVOICES_CHANGED_EVENT));
  }
}
