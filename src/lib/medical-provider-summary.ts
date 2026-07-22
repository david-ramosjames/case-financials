import type { MedicalExpense } from "@/lib/types";
import { isMedicalPaid } from "@/lib/expense-review";
import {
  canonicalizeProviderTokens,
  preferredProviderName,
  providerNamesMatch,
} from "@/lib/provider-name-match";

export interface ProviderRollup {
  providerName: string;
  charge: number;
  paid: number;
  adjusted: number;
  outstanding: number;
}

export interface MedicalSummaryTotals {
  charge: number;
  paid: number;
  adjusted: number;
  outstanding: number;
  paidAndIncurred: number;
}

/** Derive charge / paid / adjusted / outstanding for one invoice row. */
export function deriveLineAmounts(e: MedicalExpense): {
  charge: number;
  paid: number;
  adjusted: number;
  outstanding: number;
} {
  const charge = e.originalCharges ?? e.reducedFromAmount ?? 0;
  if (charge <= 0 && e.currentBalance == null && e.finalPayAmount == null) {
    return { charge: 0, paid: 0, adjusted: 0, outstanding: 0 };
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
  if (e.reducedFromAmount != null && e.finalPayAmount != null && e.reducedFromAmount > e.finalPayAmount) {
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

  let paid = Math.max(0, charge - adjusted - outstanding);

  if (isMedicalPaid(e) && paid === 0 && charge > 0) {
    paid = Math.max(0, charge - outstanding - adjusted);
  }

  return { charge, paid, adjusted, outstanding };
}

function providerGroupKey(name: string): string {
  const tokens = canonicalizeProviderTokens(name);
  return tokens.length ? tokens.join(" ") : name.trim().toLowerCase();
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
    const key = providerGroupKey(name);
    const line = deriveLineAmounts(expense);
    const existing = byProvider.get(key);

    if (existing) {
      existing.providerName = preferredProviderName(existing.providerName, name);
      existing.charge += line.charge;
      existing.paid += line.paid;
      existing.adjusted += line.adjusted;
      existing.outstanding += line.outstanding;
    } else {
      byProvider.set(key, {
        providerName: name,
        charge: line.charge,
        paid: line.paid,
        adjusted: line.adjusted,
        outstanding: line.outstanding,
      });
    }
  }

  const providers = [...byProvider.values()].sort((a, b) =>
    a.providerName.localeCompare(b.providerName, undefined, { sensitivity: "base" })
  );

  const totals = providers.reduce<MedicalSummaryTotals>(
    (acc, row) => ({
      charge: acc.charge + row.charge,
      paid: acc.paid + row.paid,
      adjusted: acc.adjusted + row.adjusted,
      outstanding: acc.outstanding + row.outstanding,
      paidAndIncurred: 0,
    }),
    { charge: 0, paid: 0, adjusted: 0, outstanding: 0, paidAndIncurred: 0 }
  );
  totals.paidAndIncurred = totals.paid + totals.outstanding;

  return { providers, totals };
}

export function formatMedicalMoney(value: number, blankZero = true): string {
  if (!Number.isFinite(value) || (blankZero && value === 0)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
