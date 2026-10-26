import type { MedicalExpense } from "@/lib/types";
import { isMedicalPaid } from "@/lib/expense-review";
import {
  canonicalizeProviderTokens,
  preferredProviderName,
  providerNamesMatch,
} from "@/lib/provider-name-match";

export interface ProviderRollup {
  providerName: string;
  /** Blank when the document has no patient name yet. */
  patientName: string;
  charge: number;
  paid: number;
  adjusted: number;
  healthInsurancePaid: number;
  /** Other insurance paid toward the provider's bills. */
  insurancePaid: number;
  outstanding: number;
}

export interface MedicalSummaryTotals {
  charge: number;
  paid: number;
  adjusted: number;
  healthInsurancePaid: number;
  insurancePaid: number;
  outstanding: number;
  paidAndIncurred: number;
}

/** Derive charge / paid / adjusted / outstanding for one invoice row. */
export function deriveLineAmounts(e: MedicalExpense): {
  charge: number;
  paid: number;
  adjusted: number;
  healthInsurancePaid: number;
  insurancePaid: number;
  outstanding: number;
} {
  const healthInsurancePaid = e.healthInsurancePaid ?? 0;
  const insurancePaid = e.insurancePaid ?? 0;
  const charge = e.originalCharges ?? e.reducedFromAmount ?? 0;
  if (charge <= 0 && e.currentBalance == null && e.finalPayAmount == null && !e.adjustmentAmount && !healthInsurancePaid && !insurancePaid) {
    return { charge: 0, paid: 0, adjusted: 0, healthInsurancePaid, insurancePaid, outstanding: 0 };
  }

  let outstanding = e.currentBalance;
  if (outstanding == null) {
    if (e.finalPayAmount != null && !isMedicalPaid(e)) {
      outstanding = e.finalPayAmount;
    } else if (isMedicalPaid(e) || e.paymentStatus === "waived" || e.paymentStatus === "closed") {
      outstanding = 0;
    } else if (charge > 0) {
      outstanding = charge;
    } else {
      outstanding = 0;
    }
  }

  let adjusted = 0;
  if (e.adjustmentAmount != null) {
    adjusted = Math.max(0, e.adjustmentAmount);
  } else if (e.reducedFromAmount != null && e.finalPayAmount != null && e.reducedFromAmount > e.finalPayAmount) {
    adjusted = e.reducedFromAmount - e.finalPayAmount;
  } else if (e.originalCharges != null && e.finalPayAmount != null && e.originalCharges > e.finalPayAmount) {
    adjusted = e.originalCharges - e.finalPayAmount;
  } else if (
    e.paymentStatus === "reduced" ||
    e.paymentStatus === "waived" ||
    (outstanding < charge && !isMedicalPaid(e) && e.paymentStatus !== "partially_paid")
  ) {
    adjusted = Math.max(0, charge - outstanding);
  }

  const hasExplicitPayments = e.healthInsurancePaid != null || e.insurancePaid != null;
  let paid = hasExplicitPayments ? healthInsurancePaid + insurancePaid : Math.max(0, charge - adjusted - outstanding);

  if (!hasExplicitPayments && isMedicalPaid(e) && paid === 0 && charge > 0) {
    paid = Math.max(0, charge - outstanding - adjusted);
  }

  return { charge, paid, adjusted, healthInsurancePaid, insurancePaid, outstanding };
}

/** Case-insensitive patient key. Drops punctuation and single-letter initials. "_" means unset. */
export function patientGroupKey(name: string | null | undefined): string {
  const tokens = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
  return tokens.join("") || "_";
}

export function ledgerGroupKey(patientName: string | null | undefined, providerName: string): string {
  return `${patientGroupKey(patientName)}|${providerGroupKey(providerName)}`;
}

export function preferredPatientName(current: string | null | undefined, next: string | null | undefined): string {
  const a = current?.trim() ?? "";
  const b = next?.trim() ?? "";
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

/** True when the case's documents name more than one patient, or some are still unset. */
export function hasMultiplePatients(names: (string | null | undefined)[]): boolean {
  return new Set(names.map((name) => patientGroupKey(name))).size > 1;
}

export function providerGroupKey(name: string): string {
  const tokens = canonicalizeProviderTokens(name);
  return tokens.length ? tokens.join("") : name.trim().toLowerCase();
}

/** Prefer one display name for near-duplicate provider labels on a case. */
export function alignProviderName(name: string, candidates: string[]): string {
  const trimmed = name.trim() || "Unknown provider";
  const matches = candidates
    .map((c) => c.trim())
    .filter((c) => c && providerNamesMatch(trimmed, c));
  if (!matches.length) return trimmed;
  return matches.reduce((best, next) => preferredProviderName(best, next), trimmed);
}

export function buildMedicalProviderSummary(expenses: MedicalExpense[]): {
  providers: ProviderRollup[];
  totals: MedicalSummaryTotals;
} {
  const byProvider = new Map<string, ProviderRollup>();
  const allNames = expenses.map((e) => e.providerName.trim() || "Unknown provider");

  for (const expense of expenses) {
    const rawName = expense.providerName.trim() || "Unknown provider";
    const name = alignProviderName(rawName, allNames);
    const key = ledgerGroupKey(expense.patientName, name);
    const line = deriveLineAmounts(expense);
    const existing = byProvider.get(key);

    if (existing) {
      existing.providerName = preferredProviderName(existing.providerName, name);
      existing.patientName = preferredPatientName(existing.patientName, expense.patientName);
      existing.charge += line.charge;
      existing.paid += line.paid;
      existing.adjusted += line.adjusted;
      existing.healthInsurancePaid += line.healthInsurancePaid;
      existing.insurancePaid += line.insurancePaid;
      existing.outstanding += line.outstanding;
    } else {
      byProvider.set(key, {
        providerName: name,
        patientName: expense.patientName?.trim() ?? "",
        charge: line.charge,
        paid: line.paid,
        adjusted: line.adjusted,
        healthInsurancePaid: line.healthInsurancePaid,
        insurancePaid: line.insurancePaid,
        outstanding: line.outstanding,
      });
    }
  }

  const providers = [...byProvider.values()].sort(
    (a, b) =>
      a.patientName.localeCompare(b.patientName, undefined, { sensitivity: "base" }) ||
      a.providerName.localeCompare(b.providerName, undefined, { sensitivity: "base" })
  );

  const totals = providers.reduce<MedicalSummaryTotals>(
    (acc, row) => ({
      charge: acc.charge + row.charge,
      paid: acc.paid + row.paid,
      adjusted: acc.adjusted + row.adjusted,
      healthInsurancePaid: acc.healthInsurancePaid + row.healthInsurancePaid,
      insurancePaid: acc.insurancePaid + row.insurancePaid,
      outstanding: acc.outstanding + row.outstanding,
      paidAndIncurred: 0,
    }),
    {
      charge: 0,
      paid: 0,
      adjusted: 0,
      healthInsurancePaid: 0,
      insurancePaid: 0,
      outstanding: 0,
      paidAndIncurred: 0,
    }
  );
  totals.paidAndIncurred = totals.paid + totals.outstanding;

  return { providers, totals };
}

export function formatMedicalMoney(value: number, blankZero = true): string {
  if (!Number.isFinite(value) || (blankZero && value === 0)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
