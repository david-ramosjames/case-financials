import type { MedicalExpense, MedicalExclusionReason } from "@/lib/types";
import {
  alignProviderName,
  deriveLineAmounts,
  providerGroupKey,
  type ProviderRollup,
} from "@/lib/medical-provider-summary";
import { preferredProviderName } from "@/lib/provider-name-match";

/**
 * counted     — included in totals
 * suggested   — looks like a duplicate / older statement; left out of totals until a
 *               reviewer confirms (→ excluded) or keeps it (→ counted)
 * excluded    — a reviewer excluded it as duplicate / superseded
 */
export type LedgerStatus = "counted" | "suggested" | "excluded";

export interface LedgerEntry {
  expense: MedicalExpense;
  status: LedgerStatus;
  /** Why it is suggested or excluded. */
  reason: MedicalExclusionReason | null;
  /** The record that replaces this one, when known. */
  supersededById: string | null;
  /** The newest balance document that sets this provider account's current balance. */
  isCurrentBalance: boolean;
}

export interface ProviderLedger {
  key: string;
  providerName: string;
  entries: LedgerEntry[];
  rollup: ProviderRollup;
  suggestedCount: number;
  excludedCount: number;
  /** Changes whenever the provider's records, amounts, or classifications change. */
  fingerprint: string;
}

export interface MedicalLedger {
  byId: Map<string, LedgerEntry>;
  providers: ProviderLedger[];
  /** Records that count toward totals — the attorney-facing set. */
  counted: MedicalExpense[];
  suggestions: LedgerEntry[];
  excludedCount: number;
}

/** Document types that state an account's balance as of a date (vs. an itemized charge). */
export function isBalanceDocument(e: MedicalExpense): boolean {
  return e.documentType !== "medical_bill";
}

function hasAmounts(e: MedicalExpense): boolean {
  return (
    (e.originalCharges ?? 0) > 0 ||
    (e.reducedFromAmount ?? 0) > 0 ||
    e.currentBalance != null ||
    e.finalPayAmount != null
  );
}

function normalizeAccount(account: string | null): string | null {
  const v = (account ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return v || null;
}

/** Newest first: date of service, then import time. Undated documents sort oldest. */
function compareNewest(a: MedicalExpense, b: MedicalExpense): number {
  const ad = a.dateOfService ?? "";
  const bd = b.dateOfService ?? "";
  if (ad !== bd) return bd.localeCompare(ad);
  return b.createdAt - a.createdAt;
}

function duplicateKey(e: MedicalExpense): string {
  return [
    e.documentType,
    e.dateOfService ?? "",
    e.originalCharges ?? "",
    e.currentBalance ?? "",
    e.finalPayAmount ?? "",
    e.reducedFromAmount ?? "",
  ].join("|");
}

/** Split a provider's active records into account buckets. One known account = one bucket. */
function accountBuckets(rows: MedicalExpense[]): MedicalExpense[][] {
  const accounts = new Set(rows.map((r) => normalizeAccount(r.accountNumber)).filter(Boolean));
  if (accounts.size <= 1) return [rows];
  const buckets = new Map<string, MedicalExpense[]>();
  for (const r of rows) {
    const k = normalizeAccount(r.accountNumber) ?? "";
    buckets.set(k, [...(buckets.get(k) ?? []), r]);
  }
  return [...buckets.values()];
}

function classifyBucket(rows: MedicalExpense[], out: Map<string, LedgerEntry>) {
  const suggest = (e: MedicalExpense, reason: MedicalExclusionReason, by: string) => {
    if (e.suggestionDismissed || out.has(e.id)) return;
    out.set(e.id, { expense: e, status: "suggested", reason, supersededById: by, isCurrentBalance: false });
  };

  // Exact duplicates: keep the first-imported copy.
  const byKey = new Map<string, MedicalExpense[]>();
  for (const r of rows) byKey.set(duplicateKey(r), [...(byKey.get(duplicateKey(r)) ?? []), r]);
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const [keeper, ...rest] = [...group].sort(
      (a, b) => Number(b.suggestionDismissed) - Number(a.suggestionDismissed) || a.createdAt - b.createdAt
    );
    for (const r of rest) suggest(r, "duplicate", keeper.id);
  }

  // The newest balance document is the account's current balance; it replaces older
  // statements and any itemized bills dated on or before it.
  const remaining = rows.filter((r) => !out.has(r.id));
  const current = remaining.filter((r) => isBalanceDocument(r) && hasAmounts(r)).sort(compareNewest)[0];
  if (current) {
    for (const r of remaining) {
      if (r.id === current.id) continue;
      const olderOrUndated =
        !r.dateOfService || !current.dateOfService || r.dateOfService <= current.dateOfService;
      if (isBalanceDocument(r) || olderOrUndated) suggest(r, "superseded", current.id);
    }
  }

  for (const r of rows) {
    if (out.has(r.id)) continue;
    out.set(r.id, {
      expense: r,
      status: "counted",
      reason: null,
      supersededById: null,
      isCurrentBalance: r.id === current?.id,
    });
  }
}

/** FNV-1a over each record's classification and amounts (review status deliberately excluded). */
function fingerprintOf(entries: LedgerEntry[]): string {
  const text = [...entries]
    .sort((a, b) => a.expense.id.localeCompare(b.expense.id))
    .map(({ expense: e, status, reason }) =>
      [
        e.id, status, reason ?? "", e.providerName.trim(), e.documentType, e.dateOfService ?? "",
        e.accountNumber ?? "", e.originalCharges ?? "", e.currentBalance ?? "", e.finalPayAmount ?? "",
        e.reducedFromAmount ?? "", e.paymentStatus,
      ].join(":")
    )
    .join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${entries.length}-${(hash >>> 0).toString(16)}`;
}

function rollupOf(providerName: string, rows: MedicalExpense[]): ProviderRollup {
  return rows.reduce<ProviderRollup>(
    (acc, e) => {
      const line = deriveLineAmounts(e);
      return {
        providerName,
        charge: acc.charge + line.charge,
        paid: acc.paid + line.paid,
        adjusted: acc.adjusted + line.adjusted,
        outstanding: acc.outstanding + line.outstanding,
      };
    },
    { providerName, charge: 0, paid: 0, adjusted: 0, outstanding: 0 }
  );
}

export function buildMedicalLedger(expenses: MedicalExpense[]): MedicalLedger {
  const allNames = expenses.map((e) => e.providerName.trim() || "Unknown provider");
  const groups = new Map<string, { name: string; rows: MedicalExpense[] }>();
  for (const e of expenses) {
    const name = alignProviderName(e.providerName.trim() || "Unknown provider", allNames);
    const key = providerGroupKey(name);
    const g = groups.get(key);
    if (g) {
      g.name = preferredProviderName(g.name, name);
      g.rows.push(e);
    } else {
      groups.set(key, { name, rows: [e] });
    }
  }

  const byId = new Map<string, LedgerEntry>();
  const providers: ProviderLedger[] = [];

  for (const [key, { name, rows }] of groups) {
    for (const e of rows) {
      if (e.excludedReason) {
        byId.set(e.id, {
          expense: e,
          status: "excluded",
          reason: e.excludedReason,
          supersededById: e.supersededById,
          isCurrentBalance: false,
        });
      }
    }
    const active = rows.filter((e) => !e.excludedReason);
    for (const bucket of accountBuckets(active)) classifyBucket(bucket, byId);

    const entries = rows
      .map((e) => byId.get(e.id)!)
      .sort((a, b) => compareNewest(a.expense, b.expense));
    providers.push({
      key,
      providerName: name,
      entries,
      rollup: rollupOf(
        name,
        entries.filter((x) => x.status === "counted").map((x) => x.expense)
      ),
      suggestedCount: entries.filter((x) => x.status === "suggested").length,
      excludedCount: entries.filter((x) => x.status === "excluded").length,
      fingerprint: fingerprintOf(entries),
    });
  }

  const all = [...byId.values()];
  return {
    byId,
    providers,
    counted: all.filter((x) => x.status === "counted").map((x) => x.expense),
    suggestions: all.filter((x) => x.status === "suggested"),
    excludedCount: all.filter((x) => x.status === "excluded").length,
  };
}
