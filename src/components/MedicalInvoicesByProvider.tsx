"use client";

import { Fragment, useCallback, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  confirmMedicalProviderReview,
  excludeMedicalExpenses,
  markMedicalExpensePaid,
  mergeMedicalProviders,
  deleteLearnedProviderAlias,
  markMedicalExpenseReviewed,
  reopenMedicalProviderReview,
  restoreMedicalExpense,
  setMedicalSuggestionDismissed,
  updateMedicalExpense,
} from "@/lib/supabase/repo";
import { isMedicalPaid, needsMedicalReview } from "@/lib/expense-review";
import { deriveLineAmounts } from "@/lib/medical-provider-summary";
import {
  DOCUMENT_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  formatCurrency,
  sourceFileName,
} from "@/lib/medical-expense-display";
import type { LedgerEntry, MedicalLedger, ProviderLedger } from "@/lib/medical-ledger";
import {
  PROVIDER_STATE_LABELS,
  type MedicalReviewProgress,
  type ProviderReviewState,
} from "@/lib/medical-review";
import type {
  MedicalExclusionReason,
  MedicalExpense,
  MedicalExpenseDocumentType,
  MedicalExpensePaymentStatus,
  MedicalExpenseReviewStatus,
  MedicalTrackerProvider,
} from "@/lib/types";
import { providerNamesMatch } from "@/lib/provider-name-match";
import type { LearnedProviderAlias } from "@/lib/provider-aliases";
import { mergeProviderRows } from "@/components/MedicalTracker";
import { StatusDot } from "@/components/CaseFinancialHero";
import { Badge, Button, EmptyState, Input, Select, Spinner } from "@/components/ui";

const REASON_LABELS: Record<MedicalExclusionReason, string> = {
  duplicate: "Duplicate",
  superseded: "Superseded",
  not_medical: "Not medical expense",
};

const STATE_BADGE: Record<ProviderReviewState, "warning" | "primary" | "success"> = {
  needs_review: "warning",
  reviewed: "primary",
  certified: "success",
};

function reviewStatusKind(status: MedicalExpenseReviewStatus): "action" | "success" | "neutral" {
  if (status === "needs_review" || status === "pending" || status === "in_review") return "action";
  if (status === "reviewed" || status === "approved") return "success";
  return "neutral";
}

function paymentStatusKind(status: MedicalExpensePaymentStatus): "action" | "success" | "neutral" {
  if (status === "paid" || status === "closed" || status === "waived") return "success";
  if (status === "unpaid" || status === "pending_review" || status === "partially_paid") return "action";
  return "neutral";
}

function formatPercent(value: number | null): string {
  return value == null ? "" : `${Math.round(value * 100)}%`;
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function documentLabel(e: MedicalExpense | undefined): string {
  if (!e) return "another record";
  const type = DOCUMENT_TYPE_LABELS[e.documentType] ?? e.documentType;
  return e.dateOfService ? `${type} (${formatShortDate(e.dateOfService)})` : type;
}

export function MedicalInvoicesByProvider({
  caseId,
  ledger,
  progress,
  trackedProviders,
  learnedRenames,
  learnedAliases,
}: {
  caseId: string;
  ledger: MedicalLedger;
  progress: MedicalReviewProgress;
  trackedProviders: MedicalTrackerProvider[];
  learnedRenames: Map<string, string>;
  learnedAliases: LearnedProviderAlias[];
}) {
  const [mergingKey, setMergingKey] = useState<string | null>(null);
  const [mergeTargetKey, setMergeTargetKey] = useState("");
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterReview, setFilterReview] = useState<"all" | "needs_review" | "reviewed">("all");
  const [filterPayment, setFilterPayment] = useState<"all" | MedicalExpensePaymentStatus>("all");
  const [showExcluded, setShowExcluded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<MedicalExpense>>({});
  const [excludingId, setExcludingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const filtersActive = Boolean(search.trim()) || filterReview !== "all" || filterPayment !== "all";

  const stateOf = (key: string): ProviderReviewState => progress.byKey.get(key)?.state ?? "needs_review";
  const stateRank = (key: string) => ({ needs_review: 0, reviewed: 1, certified: 2 })[stateOf(key)];

  const entryVisible = useCallback(
    (entry: LedgerEntry) => {
      const e = entry.expense;
      if (entry.status === "excluded" && !showExcluded) return false;
      if (filterReview === "needs_review" && !needsMedicalReview(e)) return false;
      if (filterReview === "reviewed" && e.reviewStatus !== "reviewed" && e.reviewStatus !== "approved") return false;
      if (filterPayment !== "all" && e.paymentStatus !== filterPayment) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [e.providerName, e.accountNumber, e.documentType, e.payeeName, e.dropboxFilePath]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    },
    [search, filterReview, filterPayment, showExcluded]
  );

  const providers = ledger.providers
    .map((p) => ({ provider: p, visible: p.entries.filter(entryVisible) }))
    .filter(({ visible }) => visible.length > 0)
    .sort(
      (a, b) =>
        stateRank(a.provider.key) - stateRank(b.provider.key) ||
        b.provider.suggestedCount - a.provider.suggestedCount ||
        b.provider.rollup.outstanding - a.provider.rollup.outstanding ||
        a.provider.providerName.localeCompare(b.provider.providerName)
    );

  const run = useCallback(async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    setErr(null);
    try {
      await action();
    } catch (e) {
      setErr(e instanceof Error ? e.message : failure);
    } finally {
      setBusy(false);
    }
  }, []);

  const supabase = () => getBrowserSupabase();
  const excludedBy = user?.email ?? null;

  const confirmSuggestions = (entries: LedgerEntry[]) =>
    run(
      () =>
        excludeMedicalExpenses(
          supabase(),
          entries.map((x) => ({ id: x.expense.id, reason: x.reason ?? "superseded", supersededById: x.supersededById })),
          excludedBy
        ),
      "Could not exclude records"
    );

  const excludeManually = (entry: LedgerEntry, provider: ProviderLedger, reason: MedicalExclusionReason) => {
    const current =
      reason === "not_medical"
        ? undefined
        : provider.entries.find((x) => x.isCurrentBalance && x.expense.id !== entry.expense.id);
    setExcludingId(null);
    void run(
      () =>
        excludeMedicalExpenses(
          supabase(),
          [{ id: entry.expense.id, reason, supersededById: current?.expense.id ?? null }],
          excludedBy
        ),
      "Could not exclude record"
    );
  };

  const confirmProvider = (provider: ProviderLedger) =>
    run(
      () =>
        confirmMedicalProviderReview(supabase(), {
          caseId,
          providerKey: provider.key,
          providerName: provider.providerName,
          fingerprint: provider.fingerprint,
          reviewedBy: excludedBy,
          recordIdsToMarkReviewed: provider.entries
            .filter((x) => x.status === "counted" && needsMedicalReview(x.expense))
            .map((x) => x.expense.id),
        }),
      "Could not confirm provider totals"
    );

  const mergeInto = (source: ProviderLedger, target: ProviderLedger) => {
    const namesOf = (p: ProviderLedger) => [
      ...new Set([p.providerName, ...p.entries.map((x) => x.expense.providerName.trim())].filter(Boolean)),
    ];
    const targetNames = namesOf(target);
    const sourceNames = namesOf(source);
    const matches = (row: MedicalTrackerProvider, names: string[]) =>
      names.some((n) => providerNamesMatch(row.providerName, n));
    const targetRows = trackedProviders.filter((r) => matches(r, targetNames));
    const sourceRows = trackedProviders.filter((r) => !targetRows.includes(r) && matches(r, sourceNames));
    const rows = [...targetRows, ...sourceRows];
    const merged = rows.length ? rows.reduce((a, b) => mergeProviderRows(a, b)) : null;

    const ok = window.confirm(
      `Merge "${source.providerName}" (${source.entries.length} document${source.entries.length === 1 ? "" : "s"}) into "${target.providerName}"?\n\n` +
        `Its documents will be renamed to "${target.providerName}", and this spelling will be grouped with "${target.providerName}" automatically on every case from now on.`
    );
    if (!ok) return;
    setMergingKey(null);
    setMergeTargetKey("");
    void run(
      () =>
        mergeMedicalProviders(supabase(), {
          caseId,
          targetName: target.providerName,
          sourceNames,
          sourceRecordIds: source.entries.map((x) => x.expense.id),
          trackerRows: rows,
          mergedTrackerRow: merged ? { ...merged, id: targetRows[0]?.id ?? sourceRows[0]?.id ?? null } : null,
          createdBy: excludedBy,
        }),
      "Could not merge providers"
    );
  };

  const renderMergeControls = (provider: ProviderLedger) => {
    const others = ledger.providers
      .filter((p) => p.key !== provider.key)
      .sort((a, b) => a.providerName.localeCompare(b.providerName));
    if (!others.length) return null;
    if (mergingKey !== provider.key) {
      return (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setMergingKey(provider.key);
            setMergeTargetKey("");
          }}
        >
          Merge into…
        </Button>
      );
    }
    const target = others.find((p) => p.key === mergeTargetKey);
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Select
          className="min-w-56 border-0 bg-surface-alt px-2 py-1.5 text-sm"
          value={mergeTargetKey}
          onChange={(e) => setMergeTargetKey(e.target.value)}
        >
          <option value="">Same provider as…</option>
          {others.map((p) => (
            <option key={p.key} value={p.key}>
              {p.providerName} ({p.entries.length})
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={busy || !target} onClick={() => target && mergeInto(provider, target)}>
          Merge
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMergingKey(null)}>
          Cancel
        </Button>
      </span>
    );
  };

  const renderProviderBar = (provider: ProviderLedger) => {
    const status = progress.byKey.get(provider.key);
    const state = status?.state ?? "needs_review";
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-1 text-sm lg:px-8">
        <span className="text-text-muted">
          {state === "certified"
            ? "These totals are in the current certified tracker."
            : state === "reviewed" && status?.review
              ? `Totals confirmed by ${status.review.reviewedBy ?? "a reviewer"} · ${formatShortDate(status.review.reviewedAt)}`
              : provider.suggestedCount > 0
                ? `Resolve the ${provider.suggestedCount} suggested item${provider.suggestedCount === 1 ? "" : "s"} below, then confirm this provider's totals.`
                : "Check each item below, then confirm this provider's totals."}
        </span>
        <span className="flex flex-wrap items-center gap-2">
        {renderMergeControls(provider)}
        {state === "needs_review" && mergingKey !== provider.key && (
          <Button size="sm" disabled={busy || provider.suggestedCount > 0} onClick={() => void confirmProvider(provider)}>
            Confirm totals · {formatCurrency(provider.rollup.outstanding)}
          </Button>
        )}
        {state === "reviewed" && mergingKey !== provider.key && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() => reopenMedicalProviderReview(supabase(), caseId, provider.key), "Could not reopen provider")
            }
          >
            Reopen
          </Button>
        )}
        </span>
      </div>
    );
  };

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const startEdit = (e: MedicalExpense) => {
    setEditingId(e.id);
    setEditDraft({ ...e });
    setErr(null);
  };

  const saveEdit = () => {
    if (!editingId) return;
    void run(async () => {
      await updateMedicalExpense(supabase(), editingId, editDraft);
      setEditingId(null);
      setEditDraft({});
    }, "Could not save changes");
  };

  const renderStatus = (entry: LedgerEntry) => {
    const replacement = entry.supersededById ? ledger.byId.get(entry.supersededById)?.expense : undefined;
    if (entry.status === "suggested") {
      return (
        <div className="space-y-1">
          <Badge variant="warning">{REASON_LABELS[entry.reason ?? "superseded"]}?</Badge>
          <p className="text-[12px] text-text-dim">
            Suggested · {entry.reason === "duplicate" ? "same as " : "replaced by "}
            {documentLabel(replacement)}
          </p>
        </div>
      );
    }
    if (entry.status === "excluded") {
      const e = entry.expense;
      return (
        <div className="space-y-1">
          <Badge>{REASON_LABELS[entry.reason ?? "superseded"]}</Badge>
          <p className="text-[12px] text-text-dim">
            {replacement && entry.reason !== "not_medical"
              ? `${entry.reason === "duplicate" ? "Same as" : "Replaced by"} ${documentLabel(replacement)}. `
              : ""}
            Excluded{e.excludedBy ? ` by ${e.excludedBy}` : ""}
            {e.excludedAt ? ` · ${formatShortDate(e.excludedAt)}` : ""}
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <Badge variant="success">Current</Badge>
        {(entry.isCurrentBalance || entry.expense.suggestionDismissed) && (
          <p className="text-[12px] text-text-dim">
            {entry.isCurrentBalance ? "Latest balance for this account" : "Kept by reviewer"}
          </p>
        )}
      </div>
    );
  };

  const renderActions = (entry: LedgerEntry, provider: ProviderLedger) => {
    const e = entry.expense;
    if (entry.status === "suggested") {
      const duplicate = entry.reason === "duplicate";
      return (
        <>
          <Button
            size="sm"
            disabled={busy}
            title="Exclude this record from totals"
            onClick={() => void confirmSuggestions([entry])}
          >
            {duplicate ? "Yes, exclude duplicate" : "Yes, exclude old balance"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title="Count this record in totals and stop flagging it"
            onClick={() => void run(() => setMedicalSuggestionDismissed(supabase(), e.id, true), "Could not update record")}
          >
            {duplicate ? "No, it's a separate charge" : "No, still current"}
          </Button>
        </>
      );
    }
    if (entry.status === "excluded") {
      return (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void run(() => restoreMedicalExpense(supabase(), e.id), "Could not restore record")}
        >
          Restore
        </Button>
      );
    }
    if (excludingId === e.id) {
      return (
        <>
          <span className="text-[12px] text-text-dim">Exclude as…</span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => excludeManually(entry, provider, "duplicate")}>
            Duplicate
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => excludeManually(entry, provider, "superseded")}>
            Superseded
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => excludeManually(entry, provider, "not_medical")}>
            Not medical
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setExcludingId(null)}>
            Cancel
          </Button>
        </>
      );
    }
    return (
      <>
        <Button size="sm" variant="ghost" onClick={() => startEdit(e)}>
          Edit
        </Button>
        {needsMedicalReview(e) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => markMedicalExpenseReviewed(supabase(), e.id), "Could not mark reviewed")}
          >
            Reviewed
          </Button>
        )}
        {!isMedicalPaid(e) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => markMedicalExpensePaid(supabase(), e.id), "Could not mark paid")}
          >
            Paid
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setExcludingId(e.id)}>
          Exclude
        </Button>
      </>
    );
  };

  const renderEditRow = (e: MedicalExpense) => {
    const row = { ...e, ...editDraft };
    const num = (v: string) => (v ? Number(v) : null);
    return (
      <tr key={e.id} className="bg-surface-alt/40">
        <td colSpan={5} className="px-6 py-4 lg:px-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-[12px] text-text-dim">
              Provider
              <Input
                className="mt-1 border-0 bg-surface px-2 py-1.5 text-sm"
                value={row.providerName}
                onChange={(ev) => setEditDraft((d) => ({ ...d, providerName: ev.target.value }))}
              />
            </label>
            <label className="text-[12px] text-text-dim">
              Document
              <Select
                className="mt-1 border-0 bg-surface px-2 py-1.5 text-sm"
                value={row.documentType}
                onChange={(ev) =>
                  setEditDraft((d) => ({ ...d, documentType: ev.target.value as MedicalExpenseDocumentType }))
                }
              >
                {(Object.keys(DOCUMENT_TYPE_LABELS) as MedicalExpenseDocumentType[]).map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-[12px] text-text-dim">
              Account #
              <Input
                className="mt-1 border-0 bg-surface px-2 py-1.5 text-sm"
                value={row.accountNumber ?? ""}
                onChange={(ev) => setEditDraft((d) => ({ ...d, accountNumber: ev.target.value || null }))}
              />
            </label>
            <label className="text-[12px] text-text-dim">
              Date of service
              <Input
                type="date"
                className="mt-1 border-0 bg-surface px-2 py-1.5 text-sm"
                value={row.dateOfService ?? ""}
                onChange={(ev) => setEditDraft((d) => ({ ...d, dateOfService: ev.target.value || null }))}
              />
            </label>
            <label className="text-[12px] text-text-dim">
              Original charges
              <Input
                type="number"
                step="0.01"
                className="mt-1 border-0 bg-surface px-2 py-1.5 text-sm"
                value={row.originalCharges ?? ""}
                onChange={(ev) => setEditDraft((d) => ({ ...d, originalCharges: num(ev.target.value) }))}
              />
            </label>
            <label className="text-[12px] text-text-dim">
              Current balance
              <Input
                type="number"
                step="0.01"
                className="mt-1 border-0 bg-surface px-2 py-1.5 text-sm"
                value={row.currentBalance ?? ""}
                onChange={(ev) => setEditDraft((d) => ({ ...d, currentBalance: num(ev.target.value) }))}
              />
            </label>
            <label className="text-[12px] text-text-dim">
              Final pay
              <Input
                type="number"
                step="0.01"
                className="mt-1 border-0 bg-surface px-2 py-1.5 text-sm"
                value={row.finalPayAmount ?? ""}
                onChange={(ev) => setEditDraft((d) => ({ ...d, finalPayAmount: num(ev.target.value) }))}
              />
            </label>
            <label className="text-[12px] text-text-dim">
              Payment
              <Select
                className="mt-1 border-0 bg-surface px-2 py-1.5 text-sm"
                value={row.paymentStatus}
                onChange={(ev) =>
                  setEditDraft((d) => ({ ...d, paymentStatus: ev.target.value as MedicalExpensePaymentStatus }))
                }
              >
                {(Object.keys(PAYMENT_STATUS_LABELS) as MedicalExpensePaymentStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {PAYMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" disabled={busy} onClick={saveEdit}>
              {busy ? <Spinner className="h-4 w-4" /> : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditingId(null);
                setEditDraft({});
              }}
            >
              Cancel
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  const renderDocumentRow = (entry: LedgerEntry, provider: ProviderLedger) => {
    const e = entry.expense;
    if (editingId === e.id) return renderEditRow(e);
    const amounts = deriveLineAmounts(e);
    const fileLabel = sourceFileName(e.dropboxFilePath);
    const dimmed = entry.status !== "counted";
    return (
      <tr
        key={e.id}
        className={
          entry.status === "suggested"
            ? "bg-warning-light/20"
            : entry.status === "excluded"
              ? "bg-surface-alt/30"
              : "hover:bg-surface-alt/30"
        }
      >
        <td className="min-w-0 px-6 py-3.5 align-top lg:px-8">
          <div className={`text-sm ${dimmed ? "text-text-muted" : "text-text"}`}>
            {DOCUMENT_TYPE_LABELS[e.documentType] ?? e.documentType}
            <span className="text-text-dim">
              {" · "}
              {e.dateOfService ? formatShortDate(e.dateOfService) : "No DOS"}
              {e.accountNumber ? ` · #${e.accountNumber}` : ""}
              {e.extractionConfidence != null ? ` · ${formatPercent(e.extractionConfidence)}` : ""}
            </span>
          </div>
          {e.dropboxPermalink ? (
            <a
              href={e.dropboxPermalink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block truncate text-[12px] text-accent hover:underline"
              title={e.dropboxFilePath ?? fileLabel}
            >
              {fileLabel}
            </a>
          ) : fileLabel !== "—" ? (
            <span className="mt-0.5 block truncate text-[12px] text-text-dim">{fileLabel}</span>
          ) : null}
        </td>
        <td className="px-3 py-3.5 text-right align-top">
          <span className={`tabular-nums ${dimmed ? "text-text-muted line-through decoration-text-dim/50" : "font-semibold text-text"}`}>
            {formatCurrency(amounts.outstanding)}
          </span>
          <div className="mt-0.5 text-[12px] tabular-nums text-text-dim">Charge {formatCurrency(e.originalCharges)}</div>
        </td>
        <td className="px-3 py-3.5 align-top">{renderStatus(entry)}</td>
        <td className="px-3 py-3.5 align-top">
          <div className="flex flex-col items-start gap-1">
            <StatusDot kind={reviewStatusKind(e.reviewStatus)}>{REVIEW_STATUS_LABELS[e.reviewStatus]}</StatusDot>
            <StatusDot kind={paymentStatusKind(e.paymentStatus)}>{PAYMENT_STATUS_LABELS[e.paymentStatus]}</StatusDot>
          </div>
        </td>
        <td className="px-4 py-3.5 align-top lg:px-8">
          <div className="flex flex-wrap items-center justify-end gap-1">{renderActions(entry, provider)}</div>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-dim">Search</label>
          <Input
            className="border-0 bg-surface-alt/70 shadow-none focus:ring-1"
            placeholder="Provider, account #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-dim">Review</label>
          <Select
            className="min-w-36 border-0 bg-surface-alt/70 shadow-none focus:ring-1"
            value={filterReview}
            onChange={(e) => setFilterReview(e.target.value as typeof filterReview)}
          >
            <option value="all">All</option>
            <option value="needs_review">Needs Review</option>
            <option value="reviewed">Reviewed</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-dim">Payment</label>
          <Select
            className="min-w-36 border-0 bg-surface-alt/70 shadow-none focus:ring-1"
            value={filterPayment}
            onChange={(e) => setFilterPayment(e.target.value as typeof filterPayment)}
          >
            <option value="all">All</option>
            {(Object.keys(PAYMENT_STATUS_LABELS) as MedicalExpensePaymentStatus[]).map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        {ledger.excludedCount > 0 && (
          <label className="flex items-center gap-2 pb-2 text-sm text-text-muted">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-primary)]"
              checked={showExcluded}
              onChange={(e) => setShowExcluded(e.target.checked)}
            />
            Show excluded ({ledger.excludedCount})
          </label>
        )}
      </div>

      {err && <p className="mt-4 rounded-lg bg-danger-light px-4 py-3 text-sm text-danger">{err}</p>}

      {ledger.suggestions.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warning-light px-5 py-4">
          <p className="text-sm text-text-secondary">
            <span className="font-semibold text-warning">
              {ledger.suggestions.length} document{ledger.suggestions.length === 1 ? " looks" : "s look"} like a
              duplicate or an older balance.
            </span>{" "}
            {ledger.suggestions.length === 1 ? "It's" : "They're"} left out of totals for now. Exclude{" "}
            {ledger.suggestions.length === 1 ? "it" : "them"}, or mark any that are real charges as “No, it’s a
            separate charge” / “No, still current” to count them.
          </p>
          <Button size="sm" disabled={busy} onClick={() => void confirmSuggestions(ledger.suggestions)}>
            {busy ? <Spinner className="h-4 w-4" /> : `Exclude all ${ledger.suggestions.length} suggested`}
          </Button>
        </div>
      )}

      <div className="mt-6 -mx-6 lg:-mx-8">
        {providers.length === 0 ? (
          <div className="px-6 py-12 lg:px-8">
            <EmptyState
              title={filtersActive ? "No matching documents" : "No invoices yet"}
              description={
                filtersActive
                  ? "Try clearing the search or filters."
                  : "Import Dropbox files or upload an invoice to get started."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {providers.map(({ provider, visible }) => {
              const open = filtersActive || expanded.has(provider.key);
              const counted = provider.entries.filter((x) => x.status === "counted").length;
              return (
                <li key={provider.key}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(provider.key)}
                    aria-expanded={open}
                    className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 text-left transition hover:bg-surface-alt/40 lg:px-8"
                  >
                    <span className="w-4 text-text-dim" aria-hidden>
                      {open ? "▾" : "▸"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-text">{provider.providerName}</span>
                      <span className="mt-0.5 block text-[12px] text-text-dim">
                        {provider.entries.length} document{provider.entries.length === 1 ? "" : "s"}
                        {counted !== provider.entries.length ? ` · ${counted} counted` : ""}
                        {provider.excludedCount > 0 ? ` · ${provider.excludedCount} excluded` : ""}
                      </span>
                      {(() => {
                        const learnedNames = [
                          ...new Set(
                            provider.entries
                              .map((x) => learnedRenames.get(x.expense.id))
                              .filter((n): n is string => Boolean(n))
                          ),
                        ];
                        if (!learnedNames.length) return null;
                        return (
                          <span
                            className="mt-1 block text-[12px] text-accent"
                            title="Grouped automatically because these spellings were merged on another case. Remove the merge under Learned provider merges if it's wrong."
                          >
                            Learned merge: includes {learnedNames.map((n) => `“${n}”`).join(", ")}
                          </span>
                        );
                      })()}
                    </span>
                    {provider.suggestedCount > 0 && (
                      <span className="text-[12px] text-warning">{provider.suggestedCount} suggested</span>
                    )}
                    <Badge variant={STATE_BADGE[stateOf(provider.key)]}>
                      {PROVIDER_STATE_LABELS[stateOf(provider.key)]}
                    </Badge>
                    <span className="text-right">
                      <span className="block text-[11px] font-medium uppercase tracking-[0.1em] text-text-dim">
                        Current balance
                      </span>
                      <span className="block text-base font-semibold tabular-nums text-text">
                        {formatCurrency(provider.rollup.outstanding)}
                      </span>
                    </span>
                    <span className="hidden w-48 text-right text-[12px] tabular-nums text-text-muted sm:block">
                      Charges {formatCurrency(provider.rollup.charge)}
                      <br />
                      Paid {formatCurrency(provider.rollup.paid)}
                    </span>
                  </button>
                  {open && (
                    <div className="pb-2">
                      {renderProviderBar(provider)}
                      <table className="w-full table-fixed text-left text-sm">
                        <colgroup>
                          <col className="w-[30%]" />
                          <col className="w-[13%]" />
                          <col className="w-[20%]" />
                          <col className="w-[13%]" />
                          <col className="w-[24%]" />
                        </colgroup>
                        <thead>
                          <tr className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-dim">
                            <th className="px-6 py-2 lg:px-8">Document</th>
                            <th className="px-3 py-2 text-right">Balance</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Review / Payment</th>
                            <th className="px-4 py-2 lg:px-8"> </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {visible.map((entry) => (
                            <Fragment key={entry.expense.id}>{renderDocumentRow(entry, provider)}</Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {learnedAliases.length > 0 && (
        <details className="mt-4 rounded-lg border border-border/60 px-6 py-3 lg:px-8">
          <summary className="cursor-pointer text-[13px] font-medium text-text-muted">
            Learned provider merges ({learnedAliases.length})
          </summary>
          <p className="mt-2 text-[12px] text-text-dim">
            Spellings merged on any case are grouped automatically on every case. Removing one splits it back out on
            cases where it was grouped automatically; documents you merged by hand keep their new name.
          </p>
          <ul className="mt-2 divide-y divide-border/40">
            {learnedAliases.map((alias) => (
              <li key={alias.aliasKey} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="text-text">{alias.aliasName}</span>
                  <span className="text-text-dim"> → </span>
                  <span className="font-medium text-text">{alias.canonicalName}</span>
                  {alias.createdBy && (
                    <span className="ml-2 text-[12px] text-text-dim">
                      by {alias.createdBy}
                      {alias.sourceCaseId === caseId ? " on this case" : ""}
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Stop grouping "${alias.aliasName}" with "${alias.canonicalName}" on other cases?`)) return;
                    void run(() => deleteLearnedProviderAlias(supabase(), alias.aliasKey), "Could not remove learned merge");
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
