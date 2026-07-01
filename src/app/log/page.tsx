"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { subscribeAllCaseExpensesLog, subscribeAllMedicalExpensesLog } from "@/lib/supabase/repo";
import {
  REVIEW_STATUS_LABELS,
  formatCurrency,
  formatLoggedAt,
  reviewBadgeVariant,
  sourceFileName,
} from "@/lib/medical-expense-display";
import { CASE_EXPENSE_PAYMENT_LABELS, CASE_EXPENSE_REVIEW_LABELS } from "@/lib/case-expense-display";
import type { CaseExpense, MedicalExpense } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  PageWrapper,
  Select,
} from "@/components/ui";

type LogFilter = "all" | "medical" | "case";

type LogRow =
  | { kind: "medical"; createdAt: number; expense: MedicalExpense }
  | { kind: "case"; createdAt: number; expense: CaseExpense };

export default function ExpenseLogPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const [medical, setMedical] = useState<MedicalExpense[]>([]);
  const [caseExpenses, setCaseExpenses] = useState<CaseExpense[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LogFilter>("all");

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
    ].sort((a, b) => b.createdAt - a.createdAt);

    const q = search.trim().toLowerCase();
    return merged.filter((row) => {
      if (filter === "medical" && row.kind !== "medical") return false;
      if (filter === "case" && row.kind !== "case") return false;
      if (!q) return true;
      const text =
        row.kind === "medical"
          ? [row.expense.caseNumber, row.expense.providerName, row.expense.accountNumber, row.expense.documentType].join(" ")
          : [row.expense.caseNumber, row.expense.vendorName, row.expense.expenseType, row.expense.invoiceNumber, row.expense.description].join(" ");
      return text.toLowerCase().includes(q);
    });
  }, [medical, caseExpenses, search, filter]);

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
        subtitle="All financial records in the order they were logged — medical expenses and case expenses."
      />

      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-text-muted">Search</label>
              <Input placeholder="Case #, vendor, provider…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
              <EmptyState title="No expenses logged yet" description="Records appear when documents are extracted by the filing pipeline." />
            </div>
          ) : (
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-alt/60 text-xs uppercase text-text-muted">
                  <th className="px-4 py-3">Logged</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Case</th>
                  <th className="px-4 py-3">Vendor / Provider</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Review</th>
                  <th className="px-4 py-3">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  if (row.kind === "medical") {
                    const e = row.expense;
                    const caseLink = e.caseId ? `/cases/${e.caseId}/financials/medical-expenses` : null;
                    return (
                      <tr key={`medical-${e.id}`} className="hover:bg-surface-alt/40">
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">
                          {formatLoggedAt(row.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="primary">Medical</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {caseLink ? (
                            <Link href={caseLink} className="font-medium text-primary hover:underline">
                              #{e.caseNumber}
                            </Link>
                          ) : (
                            <span className="text-text-muted">#{e.caseNumber}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium">{e.providerName}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatCurrency(e.currentBalance ?? e.originalCharges)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={reviewBadgeVariant(e.reviewStatus)}>{REVIEW_STATUS_LABELS[e.reviewStatus]}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {e.dropboxPermalink ? (
                            <a href={e.dropboxPermalink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              {sourceFileName(e.dropboxFilePath)}
                            </a>
                          ) : (
                            sourceFileName(e.dropboxFilePath)
                          )}
                        </td>
                      </tr>
                    );
                  }

                  const e = row.expense;
                  const caseLink = e.caseId ? `/cases/${e.caseId}/financials/case-expenses` : null;
                  return (
                    <tr key={`case-${e.id}`} className="hover:bg-surface-alt/40">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">
                        {formatLoggedAt(row.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="default">Case</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {caseLink ? (
                          <Link href={caseLink} className="font-medium text-primary hover:underline">
                            #{e.caseNumber}
                          </Link>
                        ) : (
                          <span className="text-text-muted">#{e.caseNumber}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">{e.vendorName}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(e.amount)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={reviewBadgeVariant(e.reviewStatus)}>{CASE_EXPENSE_REVIEW_LABELS[e.reviewStatus]}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {e.dropboxPermalink ? (
                          <a href={e.dropboxPermalink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            {sourceFileName(e.dropboxFilePath)}
                          </a>
                        ) : (
                          sourceFileName(e.dropboxFilePath)
                        )}
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
