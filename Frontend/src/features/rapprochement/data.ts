import type { SepaBatch, SepaBatchOperation } from "./types";

export const SEPA_BATCHES_BY_REFERENCE: Record<string, SepaBatch> = {
  "SEPA-CT-2026-03-15-0001": {
    reference: "SEPA-CT-2026-03-15-0001",
    label: "SEPA — Virement de masse (décaissements fournisseurs)",
    executionDate: "2026-03-15",
    operations: [
      { id: "op-1", creditorName: "Orange Business", amount: 1020, currency: "EUR", endToEndId: "E2E-OB-2026-042", remittanceInfo: "OB-2026-042 — Télécom" },
      { id: "op-2", creditorName: "ENGIE Entreprises", amount: 627.6, currency: "EUR", endToEndId: "E2E-ENG-2026-1289", remittanceInfo: "ENG-2026-1289 — Énergie" },
      { id: "op-3", creditorName: "Cabinet Martin & Associés", amount: 4200, currency: "EUR", endToEndId: "E2E-CMA-2026-007", remittanceInfo: "CMA-2026-007 — Honoraires" },
      { id: "op-4", creditorName: "Imprimerie Moderne", amount: 2340, currency: "EUR", endToEndId: "E2E-IM-2026-052", remittanceInfo: "IM-2026-052 — Communication" },
      { id: "op-5", creditorName: "Assurance Pro+", amount: 1800, currency: "EUR", endToEndId: "E2E-AP-2026-006", remittanceInfo: "AP-2026-006 — Assurance" },
    ],
  },
};

export const DEFAULT_SEPA_OPERATIONS: SepaBatchOperation[] = [
  { id: "op-demo-1", creditorName: "Orange Business", amount: 1020, currency: "EUR", endToEndId: "E2E-OB-2026-042", remittanceInfo: "OB-2026-042 — Télécom" },
  { id: "op-demo-2", creditorName: "ENGIE Entreprises", amount: 627.6, currency: "EUR", endToEndId: "E2E-ENG-2026-1289", remittanceInfo: "E2E-ENG-2026-1289 — Énergie" },
  { id: "op-demo-3", creditorName: "Cabinet Martin & Associés", amount: 4200, currency: "EUR", endToEndId: "E2E-CMA-2026-007", remittanceInfo: "CMA-2026-007 — Honoraires" },
  { id: "op-demo-4", creditorName: "Imprimerie Moderne", amount: 2340, currency: "EUR", endToEndId: "E2E-IM-2026-052", remittanceInfo: "E2E-IM-2026-052 — Communication" },
  { id: "op-demo-5", creditorName: "Assurance Pro+", amount: 1800, currency: "EUR", endToEndId: "E2E-AP-2026-006", remittanceInfo: "E2E-AP-2026-006 — Assurance" },
];
