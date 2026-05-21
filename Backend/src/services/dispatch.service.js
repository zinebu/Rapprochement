export function resolveDestination(label, confidence) {
  if (!label || confidence == null || confidence < 0.85) {
    return "a_valider";
  }

  if (label === "invoice") {
    return "factures";
  }

  if (label === "bank_statement") {
    return "banque";
  }

  if (label === "sepa_xml") {
    return "banque";
  }

  if (label === "receipt") {
    return "factures";
  }

  if (label === "payroll_bulk") {
    return "bulletins_paie";
  }

  return "a_valider";
}