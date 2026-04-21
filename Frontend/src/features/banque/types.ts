export type CurrencyCode = "EUR" | "MAD" | "USD";
export type BankViewMode = "merged" | CurrencyCode;
export type OperationType = "encaissement" | "decaissement";
export type PaymentMethod = "SEPA" | "VIREMENT" | "CARTE" | "CHEQUE" | "PRELEVEMENT" | "AUTRE";
export type SepaBatchType = "invoice" | "payroll";

export type ReconciliationFilter = "all" | "unreconciled" | "reconciled";
export type InvoiceFilter = "all" | "with_invoice" | "without_invoice" | "multi_invoice";
export type UnreconciledCategory =
  | "facture_perdue"
  | "facture_introuvable"
  | "piece_manquante"
  | "ecart_montant"
  | "en_attente_validation"
  | "autre";

export type LocalBankAccount = {
  id: string;
  name: string;
  bankName: string;
  iban: string;
  currentBalance: number;
  currency: CurrencyCode;
  accountNumber?: string;
  swift?: string;
  agency?: string;
};

export type LocalInvoiceType = "purchase" | "sales";

export type LocalInvoice = {
  id: string;
  invoiceNumber: string;
  vendorCustomer: string;
  invoiceDate: string;
  dueDate: string;
  amountGross: number;
  status: string;
  currency?: CurrencyCode;
  type?: LocalInvoiceType;
  category?: string;
  pdfUrl?: string;
};

export type LocalTransaction = {
  id: string;
  sourceDocumentId?: string;
  bankAccountId: string;
  txnDate: string;
  label: string;
  rawLabel?: string;
  reference: string;
  amount: number;
  balance: number;
  reconciledStatus: "rapproché" | "non_rapproché";
  currency: CurrencyCode;
  operationType: OperationType;
  paymentMethod?: PaymentMethod;
  matchedInvoiceIds?: string[];
  pendingInvoiceIds?: string[];
  counterpartyName?: string;
  unreconciledCategory?: UnreconciledCategory;
  unreconciledComment?: string;
  reviewFlag?: boolean;
};

export type PayrollSlip = {
  id: string;
  employeeId: string;
  employeeName: string;
  slipRef: string;
  period: string;
  grossSalary: number;
  netSalary: number;
  employerCharges: number;
  employeeCharges: number;
};

export type PayrollChargeLine = {
  id: string;
  label: string;
  organism: string;
  amount: number;
  type: "urssaf" | "retraite" | "mutuelle" | "prevoyance" | "autre";
};

export type PayrollExportLine = {
  id: string;
  employeeId: string;
  employeeName: string;
  grossSalary: number;
  netSalary: number;
  employerCharges: number;
  employeeCharges: number;
};

export type SepaBatchOperation = {
  id: string;
  creditorName: string;
  creditorIban: string;
  creditorBic?: string;
  amount: number;
  currency: CurrencyCode;
  endToEndId: string;
  remittanceInfo: string;
  payrollSlipRef?: string;
  employeeId?: string;
  linkedInvoiceIds?: string[];
};

export type SepaBatchTemplate = {
  id: string;
  type: SepaBatchType;
  label: string;
  executionDate: string;
  debtorName: string;
  debtorIban: string;
  debtorCurrency: CurrencyCode;
  periodLabel?: string;
  operations: SepaBatchOperation[];
  payrollSlips?: PayrollSlip[];
  payrollExport?: PayrollExportLine[];
  payrollCharges?: PayrollChargeLine[];
};

export type SepaOperationDecisionStatus = "pending" | "approved" | "rejected" | "review";

export type SepaOperationDecision = {
  status: SepaOperationDecisionStatus;
  selectedInvoiceIds: string[];
  reviewNote?: string;
  rejectAllSuggestions?: boolean;
};

export type SepaOperationCandidate = {
  invoice: LocalInvoice;
  score: number;
  reasons: string[];
  details: {
    amountDiff: number;
    daysDiffInvoice: number;
    daysDiffDue: number;
    directionMatch: boolean;
    isPartial: boolean;
    partialPercent: number;
    remaining: number;
  };
};
