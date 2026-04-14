import { format, subDays, addDays } from "date-fns";

export interface Invoice {
  id: string;
  type: "purchase" | "sales";
  vendorCustomer: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  currency?: string;
  category: string;
  pdfUrl?: string | null;
}
export interface BankAccount {
  id: string;
  name: string;
  iban: string;
  bankName: string;
  currency: string;
  openingBalance: number;
  openingDate: string;
  currentBalance: number;
}

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  txnDate: string;
  label: string;
  amount: number;
  currency: string;
  balance?: number;
  reference: string;
  reconciledStatus: "non_rapproché" | "partiel" | "rapproché";
  matchedInvoiceIds?: string[];
}

export interface Reconciliation {
  id: string;
  bankTransactionId: string;
  invoiceId: string;
  allocatedAmount: number;
  createdAt: string;
}

const today = new Date();
const fmt = (d: Date) => format(d, "yyyy-MM-dd");

const thisYear = today.getFullYear();
const d = (month: number, day: number) => fmt(new Date(thisYear, month, day));

export const mockInvoices: Invoice[] = [
  // ─── Fournitures Express (purchase, 4 factures, TOUTES rapprochées) ───
  { id: "inv-1", type: "purchase", vendorCustomer: "Fournitures Express", invoiceNumber: "FE-2026-001", invoiceDate: d(0, 10), dueDate: d(1, 10), status: "rapprochée", amountNet: 1200, vatAmount: 240, amountGross: 1440, vatRate: 20, category: "Fournitures" },
  { id: "inv-18", type: "purchase", vendorCustomer: "Fournitures Express", invoiceNumber: "FE-2026-019", invoiceDate: d(4, 18), dueDate: d(5, 18), status: "rapprochée", amountNet: 980, vatAmount: 196, amountGross: 1176, vatRate: 20, category: "Fournitures" },
  { id: "inv-fe3", type: "purchase", vendorCustomer: "Fournitures Express", invoiceNumber: "FE-2026-027", invoiceDate: d(2, 5), dueDate: d(3, 5), status: "rapprochée", amountNet: 750, vatAmount: 150, amountGross: 900, vatRate: 20, category: "Fournitures" },
  { id: "inv-fe4", type: "purchase", vendorCustomer: "Fournitures Express", invoiceNumber: "FE-2026-033", invoiceDate: d(3, 12), dueDate: d(4, 12), status: "rapprochée", amountNet: 1100, vatAmount: 220, amountGross: 1320, vatRate: 20, category: "Fournitures" },

  // ─── Cloud Services SAS (purchase, 3 factures, rapprochées) ───
  { id: "inv-2", type: "purchase", vendorCustomer: "Cloud Services SAS", invoiceNumber: "CS-2026-042", invoiceDate: d(1, 5), dueDate: d(2, 5), status: "rapprochée", amountNet: 890, vatAmount: 178, amountGross: 1068, vatRate: 20, category: "Services IT" },
  { id: "inv-cs2", type: "purchase", vendorCustomer: "Cloud Services SAS", invoiceNumber: "CS-2026-058", invoiceDate: d(2, 5), dueDate: d(3, 5), status: "rapprochée", amountNet: 890, vatAmount: 178, amountGross: 1068, vatRate: 20, category: "Services IT" },
  { id: "inv-cs3", type: "purchase", vendorCustomer: "Cloud Services SAS", invoiceNumber: "CS-2026-074", invoiceDate: d(3, 5), dueDate: d(4, 5), status: "rapprochée", amountNet: 890, vatAmount: 178, amountGross: 1068, vatRate: 20, category: "Services IT" },

  // ─── Orange Business (purchase, 3 factures, non rapprochées) ───
  { id: "inv-10", type: "purchase", vendorCustomer: "Orange Business", invoiceNumber: "OB-2026-018", invoiceDate: d(0, 20), dueDate: d(1, 20), status: "non_rapprochée", amountNet: 650, vatAmount: 130, amountGross: 780, vatRate: 20, category: "Télécom" },
  { id: "inv-22", type: "purchase", vendorCustomer: "Orange Business", invoiceNumber: "OB-2026-042", invoiceDate: d(5, 15), dueDate: d(6, 15), status: "non_rapprochée", amountNet: 850, vatAmount: 170, amountGross: 1020, vatRate: 20, category: "Télécom" },
  { id: "inv-ob3", type: "purchase", vendorCustomer: "Orange Business", invoiceNumber: "OB-2026-066", invoiceDate: d(3, 20), dueDate: d(4, 20), status: "non_rapprochée", amountNet: 720, vatAmount: 144, amountGross: 864, vatRate: 20, category: "Télécom" },

  // ─── Cabinet Martin & Associés (purchase, 3 factures, non rapprochées) ───
  { id: "inv-3", type: "purchase", vendorCustomer: "Cabinet Martin & Associés", invoiceNumber: "CMA-2026-007", invoiceDate: fmt(subDays(today, 20)), dueDate: fmt(addDays(today, 10)), status: "non_rapprochée", amountNet: 3500, vatAmount: 700, amountGross: 4200, vatRate: 20, category: "Honoraires" },
  { id: "inv-20", type: "purchase", vendorCustomer: "Cabinet Martin & Associés", invoiceNumber: "CMA-2026-014", invoiceDate: d(5, 3), dueDate: d(6, 3), status: "non_rapprochée", amountNet: 3500, vatAmount: 700, amountGross: 4200, vatRate: 20, category: "Honoraires" },
  { id: "inv-cma3", type: "purchase", vendorCustomer: "Cabinet Martin & Associés", invoiceNumber: "CMA-2026-021", invoiceDate: d(3, 8), dueDate: d(4, 8), status: "non_rapprochée", amountNet: 2800, vatAmount: 560, amountGross: 3360, vatRate: 20, category: "Honoraires" },

  // ─── ENGIE Entreprises (purchase, 3 factures, non rapprochées) ───
  { id: "inv-4", type: "purchase", vendorCustomer: "ENGIE Entreprises", invoiceNumber: "ENG-2026-1234", invoiceDate: fmt(subDays(today, 10)), dueDate: fmt(addDays(today, 20)), status: "non_rapprochée", amountNet: 456.50, vatAmount: 91.30, amountGross: 547.80, vatRate: 20, category: "Énergie" },
  { id: "inv-eng2", type: "purchase", vendorCustomer: "ENGIE Entreprises", invoiceNumber: "ENG-2026-1289", invoiceDate: d(1, 15), dueDate: d(2, 15), status: "non_rapprochée", amountNet: 523.00, vatAmount: 104.60, amountGross: 627.60, vatRate: 20, category: "Énergie" },
  { id: "inv-eng3", type: "purchase", vendorCustomer: "ENGIE Entreprises", invoiceNumber: "ENG-2026-1345", invoiceDate: d(3, 15), dueDate: d(4, 15), status: "non_rapprochée", amountNet: 489.00, vatAmount: 97.80, amountGross: 586.80, vatRate: 20, category: "Énergie" },

  // ─── Groupe Dupont (sales, 10 factures, 5 rapprochées) ───
  { id: "inv-9", type: "sales", vendorCustomer: "Groupe Dupont", invoiceNumber: "FAC-2026-005", invoiceDate: d(0, 15), dueDate: d(1, 15), status: "rapprochée", amountNet: 4200, vatAmount: 840, amountGross: 5040, vatRate: 20, category: "Prestations" },
  { id: "inv-17", type: "sales", vendorCustomer: "Groupe Dupont", invoiceNumber: "FAC-2026-008", invoiceDate: d(4, 12), dueDate: d(5, 12), status: "non_rapprochée", amountNet: 9800, vatAmount: 1960, amountGross: 11760, vatRate: 20, category: "Prestations" },
  { id: "inv-gd3", type: "sales", vendorCustomer: "Groupe Dupont", invoiceNumber: "FAC-2026-015", invoiceDate: d(1, 20), dueDate: d(2, 20), status: "rapprochée", amountNet: 3600, vatAmount: 720, amountGross: 4320, vatRate: 20, category: "Formation" },
  { id: "inv-gd4", type: "sales", vendorCustomer: "Groupe Dupont", invoiceNumber: "FAC-2026-018", invoiceDate: d(2, 10), dueDate: d(3, 10), status: "rapprochée", amountNet: 5500, vatAmount: 1100, amountGross: 6600, vatRate: 20, category: "Consulting" },
  { id: "inv-gd5", type: "sales", vendorCustomer: "Groupe Dupont", invoiceNumber: "FAC-2026-022", invoiceDate: d(2, 25), dueDate: d(3, 25), status: "rapprochée", amountNet: 2800, vatAmount: 560, amountGross: 3360, vatRate: 20, category: "Prestations" },
  { id: "inv-gd6", type: "sales", vendorCustomer: "Groupe Dupont", invoiceNumber: "FAC-2026-027", invoiceDate: d(3, 5), dueDate: d(4, 5), status: "non_rapprochée", amountNet: 7200, vatAmount: 1440, amountGross: 8640, vatRate: 20, category: "Formation" },
  { id: "inv-gd7", type: "sales", vendorCustomer: "Groupe Dupont", invoiceNumber: "FAC-2026-031", invoiceDate: d(3, 18), dueDate: d(4, 18), status: "non_rapprochée", amountNet: 4100, vatAmount: 820, amountGross: 4920, vatRate: 20, category: "Prestations" },
  { id: "inv-gd8", type: "sales", vendorCustomer: "Groupe Dupont", invoiceNumber: "FAC-2026-035", invoiceDate: d(4, 2), dueDate: d(5, 2), status: "non_rapprochée", amountNet: 6300, vatAmount: 1260, amountGross: 7560, vatRate: 20, category: "Consulting" },
  { id: "inv-gd9", type: "sales", vendorCustomer: "Groupe Dupont", invoiceNumber: "FAC-2026-039", invoiceDate: d(4, 20), dueDate: d(5, 20), status: "non_rapprochée", amountNet: 1900, vatAmount: 380, amountGross: 2280, vatRate: 20, category: "Support" },
  { id: "inv-gd10", type: "sales", vendorCustomer: "Groupe Dupont", invoiceNumber: "FAC-2026-043", invoiceDate: d(5, 5), dueDate: d(6, 5), status: "non_rapprochée", amountNet: 8400, vatAmount: 1680, amountGross: 10080, vatRate: 20, category: "Prestations" },

  // ─── TechStart SAS (sales, 4 factures, TOUTES rapprochées) ───
  { id: "inv-5", type: "sales", vendorCustomer: "TechStart SAS", invoiceNumber: "FAC-2026-001", invoiceDate: d(1, 8), dueDate: d(2, 8), status: "rapprochée", amountNet: 5000, vatAmount: 1000, amountGross: 6000, vatRate: 20, category: "Prestations" },
  { id: "inv-19", type: "sales", vendorCustomer: "TechStart SAS", invoiceNumber: "FAC-2026-009", invoiceDate: d(4, 25), dueDate: d(5, 25), status: "non_rapprochée", amountNet: 4500, vatAmount: 900, amountGross: 5400, vatRate: 20, category: "Prestations" },
  { id: "inv-ts3", type: "sales", vendorCustomer: "TechStart SAS", invoiceNumber: "FAC-2026-014", invoiceDate: d(2, 15), dueDate: d(3, 15), status: "rapprochée", amountNet: 3200, vatAmount: 640, amountGross: 3840, vatRate: 20, category: "Formation" },
  { id: "inv-ts4", type: "sales", vendorCustomer: "TechStart SAS", invoiceNumber: "FAC-2026-020", invoiceDate: d(3, 22), dueDate: d(4, 22), status: "rapprochée", amountNet: 2700, vatAmount: 540, amountGross: 3240, vatRate: 20, category: "Consulting" },

  // ─── Agence Digitale Pro (sales, 4 factures, non rapprochées) ───
  { id: "inv-6", type: "sales", vendorCustomer: "Agence Digitale Pro", invoiceNumber: "FAC-2026-002", invoiceDate: fmt(subDays(today, 18)), dueDate: fmt(addDays(today, 12)), status: "non_rapprochée", amountNet: 3200, vatAmount: 640, amountGross: 3840, vatRate: 20, category: "Prestations" },
  { id: "inv-6b", type: "sales", vendorCustomer: "Agence Digitale Pro", invoiceNumber: "FAC-2026-002B", invoiceDate: fmt(subDays(today, 16)), dueDate: fmt(addDays(today, 14)), status: "non_rapprochée", amountNet: 3190, vatAmount: 638, amountGross: 3828, vatRate: 20, category: "Formation" },
  { id: "inv-6c", type: "sales", vendorCustomer: "Agence Digitale Pro", invoiceNumber: "FAC-2026-002C", invoiceDate: fmt(subDays(today, 20)), dueDate: fmt(addDays(today, 10)), status: "non_rapprochée", amountNet: 3200, vatAmount: 640, amountGross: 3840, vatRate: 20, category: "Consulting" },
  { id: "inv-23", type: "sales", vendorCustomer: "Agence Digitale Pro", invoiceNumber: "FAC-2026-011", invoiceDate: d(5, 22), dueDate: d(6, 22), status: "non_rapprochée", amountNet: 7200, vatAmount: 1440, amountGross: 8640, vatRate: 20, category: "Prestations" },

  // ─── Mairie de Lyon (sales, 3 factures, non rapprochées) ───
  { id: "inv-7", type: "sales", vendorCustomer: "Mairie de Lyon", invoiceNumber: "FAC-2026-003", invoiceDate: fmt(subDays(today, 15)), dueDate: fmt(addDays(today, 15)), status: "non_rapprochée", amountNet: 8500, vatAmount: 1700, amountGross: 10200, vatRate: 20, category: "Prestations" },
  { id: "inv-21", type: "sales", vendorCustomer: "Mairie de Lyon", invoiceNumber: "FAC-2026-010", invoiceDate: d(5, 8), dueDate: d(6, 8), status: "non_rapprochée", amountNet: 15000, vatAmount: 3000, amountGross: 18000, vatRate: 20, category: "Prestations" },
  { id: "inv-ml3", type: "sales", vendorCustomer: "Mairie de Lyon", invoiceNumber: "FAC-2026-016", invoiceDate: d(3, 3), dueDate: d(4, 3), status: "non_rapprochée", amountNet: 6200, vatAmount: 1240, amountGross: 7440, vatRate: 20, category: "Formation" },

  // ─── StartupFlow (sales, 3 factures, non rapprochées) ───
  { id: "inv-8", type: "sales", vendorCustomer: "StartupFlow", invoiceNumber: "FAC-2026-004", invoiceDate: fmt(subDays(today, 5)), dueDate: fmt(addDays(today, 25)), status: "non_rapprochée", amountNet: 1800, vatAmount: 360, amountGross: 2160, vatRate: 20, category: "Formation" },
  { id: "inv-sf2", type: "sales", vendorCustomer: "StartupFlow", invoiceNumber: "FAC-2026-012", invoiceDate: d(2, 18), dueDate: d(3, 18), status: "non_rapprochée", amountNet: 2400, vatAmount: 480, amountGross: 2880, vatRate: 20, category: "Prestations" },
  { id: "inv-sf3", type: "sales", vendorCustomer: "StartupFlow", invoiceNumber: "FAC-2026-019", invoiceDate: d(4, 8), dueDate: d(5, 8), status: "non_rapprochée", amountNet: 3100, vatAmount: 620, amountGross: 3720, vatRate: 20, category: "Consulting" },

  // ─── Autres (purchase, non rapprochées) ───
  { id: "inv-11", type: "purchase", vendorCustomer: "Assurance Pro+", invoiceNumber: "AP-2026-003", invoiceDate: d(1, 12), dueDate: d(2, 12), status: "non_rapprochée", amountNet: 1500, vatAmount: 300, amountGross: 1800, vatRate: 20, category: "Assurance" },
  { id: "inv-ap2", type: "purchase", vendorCustomer: "Assurance Pro+", invoiceNumber: "AP-2026-006", invoiceDate: d(4, 12), dueDate: d(5, 12), status: "non_rapprochée", amountNet: 1500, vatAmount: 300, amountGross: 1800, vatRate: 20, category: "Assurance" },
  { id: "inv-ap3", type: "purchase", vendorCustomer: "Assurance Pro+", invoiceNumber: "AP-2026-009", invoiceDate: d(7, 12), dueDate: d(8, 12), status: "non_rapprochée", amountNet: 1500, vatAmount: 300, amountGross: 1800, vatRate: 20, category: "Assurance" },

  { id: "inv-12", type: "purchase", vendorCustomer: "Imprimerie Moderne", invoiceNumber: "IM-2026-045", invoiceDate: d(3, 5), dueDate: d(4, 5), status: "non_rapprochée", amountNet: 2800, vatAmount: 560, amountGross: 3360, vatRate: 20, category: "Communication" },
  { id: "inv-im2", type: "purchase", vendorCustomer: "Imprimerie Moderne", invoiceNumber: "IM-2026-052", invoiceDate: d(4, 10), dueDate: d(5, 10), status: "non_rapprochée", amountNet: 1950, vatAmount: 390, amountGross: 2340, vatRate: 20, category: "Communication" },
  { id: "inv-im3", type: "purchase", vendorCustomer: "Imprimerie Moderne", invoiceNumber: "IM-2026-061", invoiceDate: d(5, 8), dueDate: d(6, 8), status: "non_rapprochée", amountNet: 3200, vatAmount: 640, amountGross: 3840, vatRate: 20, category: "Communication" },

  { id: "inv-13", type: "sales", vendorCustomer: "Conseil Régional AuRA", invoiceNumber: "FAC-2026-006", invoiceDate: d(3, 10), dueDate: d(4, 10), status: "non_rapprochée", amountNet: 12000, vatAmount: 2400, amountGross: 14400, vatRate: 20, category: "Prestations" },
  { id: "inv-cr2", type: "sales", vendorCustomer: "Conseil Régional AuRA", invoiceNumber: "FAC-2026-013", invoiceDate: d(5, 1), dueDate: d(6, 1), status: "non_rapprochée", amountNet: 9500, vatAmount: 1900, amountGross: 11400, vatRate: 20, category: "Prestations" },
  { id: "inv-cr3", type: "sales", vendorCustomer: "Conseil Régional AuRA", invoiceNumber: "FAC-2026-021", invoiceDate: d(6, 15), dueDate: d(7, 15), status: "non_rapprochée", amountNet: 11000, vatAmount: 2200, amountGross: 13200, vatRate: 20, category: "Formation" },

  { id: "inv-14", type: "purchase", vendorCustomer: "AWS France", invoiceNumber: "AWS-2026-118", invoiceDate: d(3, 15), dueDate: d(4, 15), status: "non_rapprochée", amountNet: 1750, vatAmount: 350, amountGross: 2100, vatRate: 20, category: "Services IT" },
  { id: "inv-aws2", type: "purchase", vendorCustomer: "AWS France", invoiceNumber: "AWS-2026-134", invoiceDate: d(4, 15), dueDate: d(5, 15), status: "non_rapprochée", amountNet: 1820, vatAmount: 364, amountGross: 2184, vatRate: 20, category: "Services IT" },
  { id: "inv-aws3", type: "purchase", vendorCustomer: "AWS France", invoiceNumber: "AWS-2026-150", invoiceDate: d(5, 15), dueDate: d(6, 15), status: "non_rapprochée", amountNet: 1680, vatAmount: 336, amountGross: 2016, vatRate: 20, category: "Services IT" },

  { id: "inv-15", type: "sales", vendorCustomer: "BioTech Labs", invoiceNumber: "FAC-2026-007", invoiceDate: d(3, 20), dueDate: d(4, 20), status: "non_rapprochée", amountNet: 6500, vatAmount: 1300, amountGross: 7800, vatRate: 20, category: "Formation" },
  { id: "inv-bt2", type: "sales", vendorCustomer: "BioTech Labs", invoiceNumber: "FAC-2026-017", invoiceDate: d(5, 10), dueDate: d(6, 10), status: "non_rapprochée", amountNet: 4800, vatAmount: 960, amountGross: 5760, vatRate: 20, category: "Consulting" },
  { id: "inv-bt3", type: "sales", vendorCustomer: "BioTech Labs", invoiceNumber: "FAC-2026-024", invoiceDate: d(6, 5), dueDate: d(7, 5), status: "non_rapprochée", amountNet: 5200, vatAmount: 1040, amountGross: 6240, vatRate: 20, category: "Prestations" },

  { id: "inv-16", type: "purchase", vendorCustomer: "Loyer Bureaux SCI", invoiceNumber: "SCI-2026-05", invoiceDate: d(4, 1), dueDate: d(4, 30), status: "non_rapprochée", amountNet: 3200, vatAmount: 640, amountGross: 3840, vatRate: 20, category: "Loyer" },
  { id: "inv-sci2", type: "purchase", vendorCustomer: "Loyer Bureaux SCI", invoiceNumber: "SCI-2026-06", invoiceDate: d(5, 1), dueDate: d(5, 30), status: "non_rapprochée", amountNet: 3200, vatAmount: 640, amountGross: 3840, vatRate: 20, category: "Loyer" },
  { id: "inv-sci3", type: "purchase", vendorCustomer: "Loyer Bureaux SCI", invoiceNumber: "SCI-2026-07", invoiceDate: d(6, 1), dueDate: d(6, 30), status: "non_rapprochée", amountNet: 3200, vatAmount: 640, amountGross: 3840, vatRate: 20, category: "Loyer" },
];

export const mockBankAccounts: BankAccount[] = [
  { id: "ba-1", name: "Compte courant pro", iban: "FR76 3000 4028 3700 0100 0250 482", bankName: "BNP Paribas", currency: "EUR", openingBalance: 15000, openingDate: "2025-01-01", currentBalance: 23456.78 },
  { id: "ba-2", name: "Compte épargne", iban: "FR76 1820 6000 5432 1098 7654 321", bankName: "Crédit Agricole", currency: "EUR", openingBalance: 50000, openingDate: "2025-01-01", currentBalance: 50000 },
];

export const mockTransactions: BankTransaction[] = [
  // ─── Rapprochées ───
  { id: "txn-1", bankAccountId: "ba-1", txnDate: fmt(subDays(today, 42)), label: "VIR FOURNITURES EXPRESS", amount: -1440, currency: "EUR", balance: 13560, reference: "VIR-001", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-1"] },
  { id: "txn-2", bankAccountId: "ba-1", txnDate: fmt(subDays(today, 38)), label: "VIR RECU TECHSTART SAS", amount: 6000, currency: "EUR", balance: 19560, reference: "VIR-002", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-5"] },
  { id: "txn-fe2", bankAccountId: "ba-1", txnDate: d(4, 20), label: "VIR FOURNITURES EXPRESS", amount: -1176, currency: "EUR", balance: 18384, reference: "VIR-FE2", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-18"] },
  { id: "txn-fe3", bankAccountId: "ba-1", txnDate: d(2, 8), label: "VIR FOURNITURES EXPRESS", amount: -900, currency: "EUR", balance: 17484, reference: "VIR-FE3", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-fe3"] },
  { id: "txn-fe4", bankAccountId: "ba-1", txnDate: d(3, 15), label: "VIR FOURNITURES EXPRESS", amount: -1320, currency: "EUR", balance: 16164, reference: "VIR-FE4", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-fe4"] },
  { id: "txn-cs1", bankAccountId: "ba-1", txnDate: d(1, 8), label: "PRLV CLOUD SERVICES SAS", amount: -1068, currency: "EUR", balance: 15096, reference: "PRLV-CS1", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-2"] },
  { id: "txn-cs2", bankAccountId: "ba-1", txnDate: d(2, 8), label: "PRLV CLOUD SERVICES SAS", amount: -1068, currency: "EUR", balance: 14028, reference: "PRLV-CS2", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-cs2"] },
  { id: "txn-cs3", bankAccountId: "ba-1", txnDate: d(3, 8), label: "PRLV CLOUD SERVICES SAS", amount: -1068, currency: "EUR", balance: 12960, reference: "PRLV-CS3", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-cs3"] },
  { id: "txn-ts2", bankAccountId: "ba-1", txnDate: d(4, 28), label: "VIR RECU TECHSTART SAS", amount: 5400, currency: "EUR", balance: 18360, reference: "VIR-TS2", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-19"] },
  { id: "txn-ts3", bankAccountId: "ba-1", txnDate: d(2, 18), label: "VIR RECU TECHSTART SAS", amount: 3840, currency: "EUR", balance: 22200, reference: "VIR-TS3", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-ts3"] },
  { id: "txn-ts4", bankAccountId: "ba-1", txnDate: d(3, 25), label: "VIR RECU TECHSTART SAS", amount: 3240, currency: "EUR", balance: 25440, reference: "VIR-TS4", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-ts4"] },
  // Groupe Dupont: 5 sur 10 rapprochées
  { id: "txn-gd1", bankAccountId: "ba-1", txnDate: d(0, 18), label: "VIR RECU GROUPE DUPONT", amount: 5040, currency: "EUR", balance: 20040, reference: "VIR-GD1", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-9"] },
  { id: "txn-gd2", bankAccountId: "ba-1", txnDate: d(4, 15), label: "VIR RECU GROUPE DUPONT", amount: 11760, currency: "EUR", balance: 31800, reference: "VIR-GD2", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-17"] },
  { id: "txn-gd3", bankAccountId: "ba-1", txnDate: d(1, 23), label: "VIR RECU GROUPE DUPONT", amount: 4320, currency: "EUR", balance: 36120, reference: "VIR-GD3", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-gd3"] },
  { id: "txn-gd4", bankAccountId: "ba-1", txnDate: d(2, 13), label: "VIR RECU GROUPE DUPONT", amount: 6600, currency: "EUR", balance: 42720, reference: "VIR-GD4", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-gd4"] },
  { id: "txn-gd5", bankAccountId: "ba-1", txnDate: d(2, 28), label: "VIR RECU GROUPE DUPONT", amount: 3360, currency: "EUR", balance: 46080, reference: "VIR-GD5", reconciledStatus: "rapproché", matchedInvoiceIds: ["inv-gd5"] },
  // ─── Non rapprochées ───
  { id: "txn-3", bankAccountId: "ba-1", txnDate: fmt(subDays(today, 20)), label: "PRLV CLOUD SERVICES SAS", amount: -1068, currency: "EUR", balance: 18492, reference: "PRLV-003", reconciledStatus: "non_rapproché" },
  { id: "txn-4", bankAccountId: "ba-1", txnDate: fmt(subDays(today, 15)), label: "VIR RECU AGENCE DIGIT PRO", amount: 3840, currency: "EUR", balance: 22332, reference: "VIR-004", reconciledStatus: "non_rapproché" },
  { id: "txn-5", bankAccountId: "ba-1", txnDate: fmt(subDays(today, 10)), label: "PRLV ENGIE ENT", amount: -548.30, currency: "EUR", balance: 21783.70, reference: "PRLV-005", reconciledStatus: "non_rapproché" },
  // SEPA — Virement de masse (lot) — EXEMPLE DÉJÀ RAPPROCHÉ
  {
    id: "txn-sepa-1",
    bankAccountId: "ba-1",
    txnDate: "2026-03-15",
    label: "SEPA VIREMENT DE MASSE — FOURNISSEURS",
    amount: -9987.60,
    currency: "EUR",
    balance: 21783.70 - 9987.60,
    reference: "SEPA-CT-2026-03-15-0001",
    reconciledStatus: "rapproché",
    matchedInvoiceIds: ["inv-22", "inv-eng2", "inv-3", "inv-im2", "inv-ap2"],
  },
  // SEPA — Virement de masse (salaires) — à rapprocher
  // SEPA — Encaissements clients (lot) — à rapprocher
  {
    id: "txn-sepa-3",
    bankAccountId: "ba-1",
    txnDate: "2026-04-02",
    label: "SEPA LOT — ENCAISSEMENTS CLIENTS",
    amount: 19560.00,
    currency: "EUR",
    balance: -683.90 + 19560.00,
    reference: "SEPA-CT-2026-04-02-0003",
    reconciledStatus: "non_rapproché",
  },
  { id: "txn-6", bankAccountId: "ba-1", txnDate: fmt(subDays(today, 5)), label: "CARTE AMAZON BUSINESS", amount: -326.92, currency: "EUR", balance: 21456.78, reference: "CB-006", reconciledStatus: "non_rapproché" },
  { id: "txn-7", bankAccountId: "ba-1", txnDate: fmt(subDays(today, 2)), label: "VIR RECU STARTUPFLOW", amount: 2000, currency: "EUR", balance: 23456.78, reference: "VIR-007", reconciledStatus: "non_rapproché" },
  { id: "txn-8", bankAccountId: "ba-1", txnDate: fmt(subDays(today, 3)), label: "VIR RECU MAIRIE LYON ACOMPTE", amount: 5100, currency: "EUR", balance: 28556.78, reference: "VIR-008", reconciledStatus: "non_rapproché" },
];

export const csvHelpText = `Formats CSV acceptés :

Relevé bancaire :
date;libellé;montant;devise;solde;référence
01/02/2025;VIR FOURNISSEUR X;-1500.00;EUR;13500.00;VIR-001

Factures :
type;fournisseur_client;numéro;date_facture;date_échéance;montant_ht;taux_tva;montant_tva;montant_ttc;catégorie;statut
achat;Fournisseur X;FX-001;01/02/2025;01/03/2025;1000.00;20;200.00;1200.00;Fournitures;payée

Séparateur : point-virgule (;)
Encodage : UTF-8
Format date : JJ/MM/AAAA
Format montant : 1234.56 (point décimal)`;

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return format(d, "dd/MM/yyyy");
}
