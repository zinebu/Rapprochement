import type { LocalBankAccount, LocalInvoice, LocalTransaction, SepaBatchTemplate, UnreconciledCategory } from "./types";

const localAccounts: LocalBankAccount[] = [
  {
    id: "ba-eur",
    name: "Compte principal EUR",
    bankName: "BNP Paribas",
    iban: "FR76 3000 4028 3700 0100 0250 482",
    currentBalance: 14210.1,
    currency: "EUR",
    accountNumber: "01000250482",
    swift: "BNPAFRPP",
    agency: "Paris Opéra",
  },
  {
    id: "ba-mad",
    name: "Compte exploitation MAD",
    bankName: "Attijariwafa bank",
    iban: "MA64 0112 7800 0000 1234 5678 95",
    currentBalance: 98500,
    currency: "MAD",
    accountNumber: "1234567895",
    swift: "BCMAMAMC",
    agency: "Rabat Centre",
  },
  {
    id: "ba-usd",
    name: "Compte international USD",
    bankName: "Bank of America",
    iban: "US12 0210 0002 1234 5678 9012",
    currentBalance: 12430,
    currency: "USD",
    accountNumber: "2123456789012",
    swift: "BOFAUS3N",
    agency: "New York",
  },
];

const localInvoices: LocalInvoice[] = [];

const sepaBatchesByReference: Record<string, SepaBatchTemplate> = {};

const initialTransactions: LocalTransaction[] = [];


export const unreconciledCategoryLabels: Record<UnreconciledCategory, string> = {
  facture_perdue: "Facture perdue",
  facture_introuvable: "Facture introuvable",
  piece_manquante: "Pièce justificative manquante",
  ecart_montant: "Écart de montant",
  en_attente_validation: "À valider",
  autre: "Autre",
};

export { initialTransactions, localAccounts, localInvoices, sepaBatchesByReference };
