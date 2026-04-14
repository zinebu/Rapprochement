const API_BASE_URL = "http://localhost:3001/api";

export async function getInvoices() {
  const response = await fetch(`${API_BASE_URL}/invoices`);

  if (!response.ok) {
    throw new Error("Failed to fetch invoices");
  }

  return response.json();
}

export async function getReconciliationSuggestions() {
  const response = await fetch(`${API_BASE_URL}/reconciliation/suggestions`);

  if (!response.ok) {
    throw new Error("Failed to fetch reconciliation suggestions");
  }

  return response.json();
}

export async function validateReconciliation(
  transactionId: string,
  invoiceIds: string[]
) {
  const response = await fetch(`${API_BASE_URL}/reconciliation/validate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ transactionId, invoiceIds }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to validate reconciliation");
  }

  return response.json();
}

export async function resetReconciliation(transactionId: string) {
  const response = await fetch(`${API_BASE_URL}/reconciliation/reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ transactionId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to reset reconciliation");
  }

  return response.json();
}