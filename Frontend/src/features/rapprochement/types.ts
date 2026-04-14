import type { Invoice } from "@/lib/mock-data";

export type CurrencyCode = "EUR" | "MAD" | "USD";

export type SepaBatchOperation = {
  id: string;
  creditorName: string;
  amount: number;
  currency: "EUR";
  endToEndId: string;
  remittanceInfo: string;
};

export type SepaBatch = {
  reference: string;
  label: string;
  executionDate: string;
  operations: SepaBatchOperation[];
};

export type BackendSingleMatch = {
  type: "SINGLE";
  invoiceId: string;
  invoiceNumber: string;
  vendorCustomer: string;
  amount: number;
  score: number;
  pdfUrl?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  category?: string | null;
  status?: string | null;
  invoiceType?: string | null;
  details?: {
    amountDiff: number;
    directionMatch: boolean;
    daysDiffInvoice?: number;
    daysDiffDue?: number;
  };
  reasons?: string[];
};

export type BackendSepaGroupMatch = {
  type: "SEPA_GROUP";
  invoiceIds: string[];
  invoiceNumbers: string[];
  vendors: string[];
  total: number;
  score: number;
  details?: {
    amountDiff: number;
    invoiceCount: number;
  };
  reasons?: string[];
};

export type BackendMatch = BackendSingleMatch | BackendSepaGroupMatch;

export type BackendSuggestion = {
  transactionId: string;
  label: string;
  amount: number;
  currency: CurrencyCode;
  matches: BackendMatch[];
};

export type SepaOperationCandidate = {
  invoice: Invoice;
  score: number;
  details: {
    amountDiff: number;
    daysDiffInvoice: number;
    daysDiffDue: number;
    directionMatch: boolean;
    isPartial: boolean;
    partialPercent: number;
    remaining: number;
  };
  reasons: string[];
};

export type SepaOperationDecisionStatus = "pending" | "approved" | "rejected" | "review";

export type SepaOperationDecision = {
  status: SepaOperationDecisionStatus;
  selectedInvoiceIds: string[];
  reviewNote?: string;
};

export type CurrencyFilter = "all" | CurrencyCode;
export type ScopeFilter = "all" | "bank" | "sepa" | "prelevement";
