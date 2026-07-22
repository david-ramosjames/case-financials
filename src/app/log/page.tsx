"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  markCaseExpensePaid,
  markCaseExpenseReviewed,
  markMedicalExpensePaid,
  markMedicalExpenseReviewed,
  subscribeAllCaseExpensesLog,
  subscribeAllMedicalExpensesLog,
} from "@/lib/supabase/repo";
import {
  PAYMENT_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  formatCurrency,
  formatLoggedAt,
  paymentBadgeVariant,
  reviewBadgeVariant,
  sourceFileName,
} from "@/lib/medical-expense-display";
import { CASE_EXPENSE_PAYMENT_LABELS, CASE_EXPENSE_REVIEW_LABELS } from "@/lib/case-expense-display";
import {
  confidenceVariant,
  formatConfidence,
  isCasePaid,
  isMedicalPaid,
  needsCaseReview,
  needsMedicalReview,
} from "@/lib/expense-review";
import type { CaseExpense, MedicalExpense } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import { compareValues, SortHeader, useSortState } from "@/lib/table-sort";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  PageWrapper,
  Select,
  Spinner,
} from "@/components/ui";

type LogFilter = "all" | "medical" | "case";
type ReviewFilter = "needs_review" | "all" | "reviewed";

type LogRow =
  | { kind: "medical"; createdAt: number; expense: MedicalExpense }
  | { kind: "case"; createdAt: number; expense: CaseExpense };

type LogSortKey =
  | "createdAt"
  | "kind"
  | "caseNumber"
  | "name"
  | "amount"
  | "confidence"
  | "paymentStatus"
  | "reviewStatus"
  | "source";

function rowConfidence(row: LogRow): number | null {
  return row.expense.extractionConfidence;
}

function rowAmount(row: LogRow): number | null {
  if (row.kind === "medical") {
    const e = row.expense;
    return e.currentBalance ?? e.originalCharges ?? e.finalPayAmount;
  }
  return row.expense.amount;
}

function rowName(row: LogRow): string {
  return row.kind === "medical" ? row.expense.providerName : row.expense.vendorName;
}

function rowNeedsReview(row: LogRow): boolean {
  return row.kind === "medical" ? needsMedicalReview(row.expense) : needsCaseReview(row.expense);
}

function rowIsPaid(row: LogRow): boolean {
  return row.kind === "medical" ? isMedicalPaid(row.expense) : isCasePaid(row.expense);
}

function sortValue(row: LogRow, key: LogSortKey): unknown {
  const e = row.expense;
  switch (key) {
    case "createdAt":
      return row.createdAt;
    case "kind":
      return row.kind;
    case "caseNumber":
      return e.caseNumber;
    case "name":
      return rowName(row);
    case "amount":
      return rowAmount(row);
    case "confidence":
      return rowConfidence(row);
    case "paymentStatus":
      return e.paymentStatus;
    case "reviewStatus":
      return e.reviewStatus;
    case "source":
      return e.dropboxFilePath;
    default:
      return null;
  }
}

export default function ExpenseLogPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const [medical, setMedical] = useState<MedicalExpense[]>([]);
  const [caseExpenses, setCaseExpenses] = useState<CaseExpense[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LogFilter>("all");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("needs_review");
  const { sortKey, sortDir, toggleSort } = useSortState<LogSortKey>("confidence", "asc");
  const [actingId, setActingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    const unsubMedical = subscribeAllMedicalExpensesLog(supabase, setMedical);
    const unsubCase = subscribeAllCaseExpensesLog(supabase, setCaseExpenses);
    return () => {
      unsubMedical();
      unsubCase();
    };
  }, [user, loading, supabaseReady]);

  const rows = useMemo(() => {
    const merged: LogRow[] = [
      ...medical.map((expense) => ({ kind: "medical" as const, createdAt: expense.createdAt, expense })),
      ...caseExpenses.map((expense) => ({ kind: "case" as const, createdAt: expense.createdAt, expense })),
    ];

    const q = search.trim().toLowerCase();
    const filtered = merged.filter((row) => {
      if (filter === "medical" && row.kind !== "medical") return false;
      if (filter === "case" && row.kind !== "case") return false;
      if (reviewFilter === "needs_review" && !rowNeedsReview(row)) return false;
      if (reviewFilter === "reviewed" && rowNeedsReview(row)) return false;
      if (!q) return true;
      const text =
        row.kind === "medical"
          ? [row.expense.caseNumber, row.expense.providerName, row.expense.accountNumber, row.expense.documentType].join(" ")
          : [row.expense.caseNumber, row.expense.vendorName, row.expense.expenseType, row.expense.invoiceNumber, row.expense.description].join(" ");
      return text.toLowerCase().includes(q);
    });

    return [...filtered].sort((a, b) => compareValues(sortValue(a, sortKey), sortValue(b, sortKey), sortDir));
  }, [medical, caseExpenses, search, filter, reviewFilter, sortKey, sortDir]);

  const needsReviewCount = useMemo(
    () =>
      medical.filter(needsMedicalReview).length + caseExpenses.filter(needsCaseReview).length,
    [medical, caseExpenses]
  );

  const runAction = useCallback(async (id: string, fn: () => Promise<void>) => {
    setActingId(id);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActingId(null);
    }
  }, []);

  if (!hydrated) return <PageSkeleton />;

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <EmptyState title="Supabase not configured" description="Expense log requires database access." />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <PageHeader
        title="Expense Log"
        subtitle="Review queue across all cases — sort by confidence, mark reviewed or paid in one click."
      />

      {err && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger-light px-4 py-3 text-sm text-danger">{err}</div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Card className="min-w-[8rem]">
          <CardBody className="py-3">
            <p className="text-xs uppercase text-text-muted">Needs Review</p>
            <p className="text-lg font-semibold text-warning">{needsReviewCount}</p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-text-muted">Search</label>
              <Input placeholder="Case #, vendor, provider…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Review</label>
              <Select className="min-w-[9rem]" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value as ReviewFilter)}>
                <option value="needs_review">Needs Review</option>
                <option value="all">All</option>
                <option value="reviewed">Reviewed</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Type</label>
              <Select className="min-w-[9rem]" value={filter} onChange={(e) => setFilter(e.target.value as LogFilter)}>
                <option value="all">All</option>
                <option value="medical">Medical</option>
                <option value="case">Case Expense</option>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12">
              <EmptyState
                title={reviewFilter === "needs_review" ? "Nothing waiting for review" : "No expenses logged yet"}
                description={
                  reviewFilter === "needs_review"
                    ? "All caught up — switch to All to browse the full log."
                    : "Records appear when documents are extracted by the filing pipeline."
                }
              />
            </div>
          ) : (
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-alt/60 text-xs uppercase text-text-muted">
                  <th className="px-3 py-3"><SortHeader label="Logged" field="createdAt" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-3 py-3"><SortHeader label="Type" field="kind" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-3 py-3"><SortHeader label="Case" field="caseNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-3 py-3"><SortHeader label="Vendor / Provider" field="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-3 py-3 text-right"><SortHeader label="Amount" field="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                  <th className="px-3 py-3"><SortHeader label="Confidence" field="confidence" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-3 py-3"><SortHeader label="Payment" field="paymentStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-3 py-3"><SortHeader label="Review" field="reviewStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-3 py-3"><SortHeader label="Source" field="source" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const e = row.expense;
                  const actionKey = `${row.kind}-${e.id}`;
                  const busy = actingId === actionKey;
                  const needsReview = rowNeedsReview(row);
                  const caseLink =
                    e.caseId &&
                    (row.kind === "medical"
                      ? `/cases/${e.caseId}/financials/medical-expenses`
                      : `/cases/${e.caseId}/financials/medical-expenses#case-expenses`);
                  const conf = rowConfidence(row);
                  const paymentLabel =
                    row.kind === "medical"
                      ? PAYMENT_STATUS_LABELS[row.expense.paymentStatus]
                      : CASE_EXPENSE_PAYMENT_LABELS[row.expense.paymentStatus];
                  const reviewLabel =
                    row.kind === "medical"
                      ? REVIEW_STATUS_LABELS[row.expense.reviewStatus]
                      : CASE_EXPENSE_REVIEW_LABELS[row.expense.reviewStatus];

                  return (
                    <tr
                      key={actionKey}
                      className={needsReview ? "bg-warning-light/30 hover:bg-warning-light/50" : "hover:bg-surface-alt/40"}
                    >
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-text-secondary">
                        {formatLoggedAt(row.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={row.kind === "medical" ? "primary" : "default"}>
                          {row.kind === "medical" ? "Medical" : "Case"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {caseLink ? (
                          <Link href={caseLink} className="font-medium text-accent hover:underline">
                            #{e.caseNumber}
                          </Link>
                        ) : (
                          <span className="text-text-muted">#{e.caseNumber}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium">{rowName(row)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(rowAmount(row))}</td>
                      <td className="px-3 py-2">
                        <Badge variant={confidenceVariant(conf)}>{formatConfidence(conf)}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={paymentBadgeVariant(e.paymentStatus)}>{paymentLabel}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={reviewBadgeVariant(e.reviewStatus)}>{reviewLabel}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {e.dropboxPermalink ? (
                          <a href={e.dropboxPermalink} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                            {sourceFileName(e.dropboxFilePath)}
                          </a>
                        ) : (
                          sourceFileName(e.dropboxFilePath)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {needsReview && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                void runAction(actionKey, () =>
                                  row.kind === "medical"
                                    ? markMedicalExpenseReviewed(getBrowserSupabase(), e.id)
                                    : markCaseExpenseReviewed(getBrowserSupabase(), e.id)
                                )
                              }
                            >
                              {busy ? <Spinner className="h-4 w-4" /> : "Reviewed"}
                            </Button>
                          )}
                          {!rowIsPaid(row) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                void runAction(actionKey, () =>
                                  row.kind === "medical"
                                    ? markMedicalExpensePaid(getBrowserSupabase(), e.id)
                                    : markCaseExpensePaid(getBrowserSupabase(), e.id, row.expense.amount)
                                )
                              }
                            >
                              {busy ? <Spinner className="h-4 w-4" /> : "Paid"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <p className="mt-4 text-xs text-text-dim">{rows.length} record{rows.length === 1 ? "" : "s"}</p>
    </PageWrapper>
  );
}
