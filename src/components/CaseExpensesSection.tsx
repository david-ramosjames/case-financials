"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  markCaseExpensePaid,
  markCaseExpenseReviewed,
  subscribeCaseExpensesForCase,
  updateCaseExpense,
} from "@/lib/supabase/repo";
import {
  CASE_EXPENSE_DOC_LABELS,
  CASE_EXPENSE_PAYMENT_LABELS,
  CASE_EXPENSE_REVIEW_LABELS,
  formatCurrency,
  paymentBadgeVariant,
  reviewBadgeVariant,
  sourceFileName,
} from "@/lib/case-expense-display";
import { confidenceVariant, formatConfidence, isCasePaid, needsCaseReview } from "@/lib/expense-review";
import { compareValues, SortHeader, useSortState } from "@/lib/table-sort";
import type { CaseExpense, CaseExpenseDocumentType, CaseExpensePaymentStatus } from "@/lib/types";
import { ManualCaseExpenseForm } from "@/components/ManualExpenseForm";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Spinner,
} from "@/components/ui";

type SortKey =
  | "vendorName"
  | "expenseType"
  | "description"
  | "invoiceNumber"
  | "invoiceDate"
  | "amount"
  | "paymentStatus"
  | "reviewStatus"
  | "extractionConfidence"
  | "documentType";

export function CaseExpensesSection({
  caseId,
  caseNumber,
}: {
  caseId: string;
  caseNumber: string | null;
}) {
  const [expenses, setExpenses] = useState<CaseExpense[]>([]);
  const [search, setSearch] = useState("");
  const [filterReview, setFilterReview] = useState<"all" | "needs_review" | "reviewed">("all");
  const { sortKey, sortDir, toggleSort } = useSortState<SortKey>("vendorName", "asc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<CaseExpense>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    return subscribeCaseExpensesForCase(supabase, caseId, setExpenses);
  }, [caseId]);

  const filtered = useMemo(() => {
    let list = expenses;
    if (filterReview === "needs_review") list = list.filter(needsCaseReview);
    else if (filterReview === "reviewed") {
      list = list.filter((e) => e.reviewStatus === "reviewed" || e.reviewStatus === "approved");
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((e) =>
        [e.vendorName, e.expenseType, e.description, e.invoiceNumber, e.referenceNumber, e.relatedParty]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    return [...list].sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDir));
  }, [expenses, search, filterReview, sortKey, sortDir]);

  const summary = useMemo(
    () => ({
      total: expenses.reduce((a, e) => a + (e.amount ?? 0), 0),
      paid: expenses.reduce((a, e) => a + (e.paidAmount ?? 0), 0),
      count: expenses.length,
      needsReview: expenses.filter(needsCaseReview).length,
    }),
    [expenses]
  );

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    setSaving(true);
    setErr(null);
    try {
      await updateCaseExpense(getBrowserSupabase(), editingId, editDraft);
      setEditingId(null);
      setEditDraft({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }, [editingId, editDraft]);

  const markReviewed = useCallback(async (expenseId: string) => {
    setSaving(true);
    setErr(null);
    try {
      await markCaseExpenseReviewed(getBrowserSupabase(), expenseId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not mark reviewed");
    } finally {
      setSaving(false);
    }
  }, []);

  const markPaid = useCallback(async (expense: CaseExpense) => {
    setSaving(true);
    setErr(null);
    try {
      await markCaseExpensePaid(getBrowserSupabase(), expense.id, expense.amount);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not mark paid");
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <div id="case-expenses">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-base tracking-tight text-text-secondary">Case Expenses</h2>
          <p className="mt-1.5 text-[15px] text-text-muted">
            Vendor invoices and case costs from the Expenses folder.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "Upload Expense"}
        </Button>
      </div>

      {err && (
        <div className="mb-4 rounded-xl bg-danger-light px-4 py-3 text-sm text-danger">{err}</div>
      )}

      <div className="mb-6 flex flex-wrap gap-x-8 gap-y-3 text-[13px] text-text-muted">
        <span>
          Total{" "}
          <span className="text-base font-semibold tabular-nums text-text">
            {formatCurrency(summary.total)}
          </span>
        </span>
        <span>
          Paid{" "}
          <span className="tabular-nums text-text-secondary">{formatCurrency(summary.paid)}</span>
        </span>
        <span>
          Count <span className="tabular-nums text-text-secondary">{summary.count}</span>
        </span>
        {summary.needsReview > 0 && (
          <span className="text-warning">
            Needs review <span className="font-semibold tabular-nums">{summary.needsReview}</span>
          </span>
        )}
      </div>

      <div className="rounded-xl bg-surface">
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
            <div className="min-w-48 flex-1">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-dim">
                Search
              </label>
              <Input
                className="border-0 bg-surface-alt/70 shadow-none focus:ring-1"
                placeholder="Vendor, invoice #, description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-dim">
                Review
              </label>
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
        </div>
        {showAddForm && caseNumber && (
          <div className="px-5 pb-4">
            <ManualCaseExpenseForm
              caseId={caseId}
              caseNumber={caseNumber}
              onClose={() => setShowAddForm(false)}
            />
          </div>
        )}
        {showAddForm && !caseNumber && (
          <div className="px-5 pb-4 text-sm text-danger">
            This case has no case number — cannot upload yet.
          </div>
        )}
        <div className="overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-5 py-12">
              <EmptyState
                title="No case expenses yet"
                description="Use Import Dropbox above, or upload an expense with a shared link."
              />
            </div>
          ) : (
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-surface-alt/60 text-[11px] uppercase text-text-muted">
                  <th className="px-2 py-2">
                    <SortHeader label="Vendor" field="vendorName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="px-2 py-2">
                    <SortHeader label="Type" field="expenseType" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="px-2 py-2">
                    <SortHeader label="Doc" field="documentType" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="px-2 py-2">
                    <SortHeader label="Description" field="description" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="px-2 py-2">
                    <SortHeader label="Invoice #" field="invoiceNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="px-2 py-2 text-right">
                    <SortHeader label="Amount" field="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  </th>
                  <th className="px-2 py-2">
                    <SortHeader label="Payment" field="paymentStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="px-2 py-2">
                    <SortHeader label="Review" field="reviewStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="px-2 py-2">
                    <SortHeader label="Conf" field="extractionConfidence" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="px-2 py-2"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((expense) => {
                  const editing = editingId === expense.id;
                  const row = editing ? { ...expense, ...editDraft } : expense;
                  const sourceLabel = sourceFileName(row.dropboxFilePath);
                  return (
                    <tr
                      key={expense.id}
                      className={
                        needsCaseReview(expense)
                          ? "bg-warning-light/20 hover:bg-warning-light/40"
                          : "hover:bg-surface-alt/40"
                      }
                    >
                      <td className="min-w-0 px-2 py-2 align-top">
                        {editing ? (
                          <Input
                            className="px-1.5 py-1 text-xs"
                            value={row.vendorName}
                            onChange={(e) => setEditDraft((d) => ({ ...d, vendorName: e.target.value }))}
                          />
                        ) : (
                          <>
                            <span className="block truncate font-medium" title={row.vendorName}>
                              {row.vendorName}
                            </span>
                            {row.dropboxPermalink ? (
                              <a
                                href={row.dropboxPermalink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-0.5 block truncate text-[11px] leading-tight text-accent hover:underline"
                                title={row.dropboxFilePath ?? sourceLabel}
                              >
                                {sourceLabel}
                              </a>
                            ) : sourceLabel !== "—" ? (
                              <span
                                className="mt-0.5 block truncate text-[11px] leading-tight text-text-dim"
                                title={row.dropboxFilePath ?? undefined}
                              >
                                {sourceLabel}
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="min-w-0 truncate px-2 py-2">
                        {editing ? (
                          <Input
                            className="px-1.5 py-1 text-xs"
                            value={row.expenseType ?? ""}
                            onChange={(e) => setEditDraft((d) => ({ ...d, expenseType: e.target.value || null }))}
                          />
                        ) : (
                          row.expenseType ?? "—"
                        )}
                      </td>
                      <td className="min-w-0 px-2 py-2">
                        {editing ? (
                          <Select
                            className="px-1.5 py-1 text-xs"
                            value={row.documentType ?? ""}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                documentType: (e.target.value || null) as CaseExpenseDocumentType | null,
                              }))
                            }
                          >
                            <option value="">—</option>
                            {(Object.keys(CASE_EXPENSE_DOC_LABELS) as CaseExpenseDocumentType[]).map((t) => (
                              <option key={t} value={t}>
                                {CASE_EXPENSE_DOC_LABELS[t]}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className="block truncate">
                            {row.documentType ? CASE_EXPENSE_DOC_LABELS[row.documentType] : "—"}
                          </span>
                        )}
                      </td>
                      <td className="min-w-0 truncate px-2 py-2" title={row.description ?? undefined}>
                        {editing ? (
                          <Input
                            className="px-1.5 py-1 text-xs"
                            value={row.description ?? ""}
                            onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value || null }))}
                          />
                        ) : (
                          row.description ?? "—"
                        )}
                      </td>
                      <td className="min-w-0 truncate px-2 py-2">
                        {editing ? (
                          <Input
                            className="px-1.5 py-1 text-xs"
                            value={row.invoiceNumber ?? ""}
                            onChange={(e) => setEditDraft((d) => ({ ...d, invoiceNumber: e.target.value || null }))}
                          />
                        ) : (
                          row.invoiceNumber ?? "—"
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {editing ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="px-1.5 py-1 text-right text-xs"
                            value={row.amount ?? ""}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                amount: e.target.value ? Number(e.target.value) : null,
                              }))
                            }
                          />
                        ) : (
                          formatCurrency(row.amount)
                        )}
                      </td>
                      <td className="min-w-0 px-2 py-2">
                        {editing ? (
                          <Select
                            className="px-1.5 py-1 text-xs"
                            value={row.paymentStatus}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                paymentStatus: e.target.value as CaseExpensePaymentStatus,
                              }))
                            }
                          >
                            {(Object.keys(CASE_EXPENSE_PAYMENT_LABELS) as CaseExpensePaymentStatus[]).map(
                              (s) => (
                                <option key={s} value={s}>
                                  {CASE_EXPENSE_PAYMENT_LABELS[s]}
                                </option>
                              )
                            )}
                          </Select>
                        ) : (
                          <Badge variant={paymentBadgeVariant(row.paymentStatus)}>
                            {CASE_EXPENSE_PAYMENT_LABELS[row.paymentStatus]}
                          </Badge>
                        )}
                      </td>
                      <td className="min-w-0 px-2 py-2">
                        <Badge variant={reviewBadgeVariant(row.reviewStatus)}>
                          {CASE_EXPENSE_REVIEW_LABELS[row.reviewStatus]}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={confidenceVariant(row.extractionConfidence)}>
                          {formatConfidence(row.extractionConfidence)}
                        </Badge>
                      </td>
                      <td className="px-1 py-2">
                        <div className="flex flex-col items-stretch gap-1">
                          {editing ? (
                            <>
                              <Button size="sm" className="px-2" disabled={saving} onClick={() => void saveEdit()}>
                                {saving ? <Spinner className="h-4 w-4" /> : "Save"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="px-2"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditDraft({});
                                }}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="px-2"
                                onClick={() => {
                                  setEditingId(expense.id);
                                  setEditDraft({ ...expense });
                                }}
                              >
                                Edit
                              </Button>
                              {needsCaseReview(expense) && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="px-2"
                                  disabled={saving}
                                  onClick={() => void markReviewed(expense.id)}
                                >
                                  Reviewed
                                </Button>
                              )}
                              {!isCasePaid(expense) && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="px-2"
                                  disabled={saving}
                                  onClick={() => void markPaid(expense)}
                                >
                                  Paid
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
