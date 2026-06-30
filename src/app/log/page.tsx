"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { subscribeAllMedicalExpensesLog } from "@/lib/supabase/repo";
import {
  DOCUMENT_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  formatCurrency,
  formatLoggedAt,
  paymentBadgeVariant,
  reviewBadgeVariant,
  sourceFileName,
} from "@/lib/medical-expense-display";
import type { MedicalExpense } from "@/lib/types";
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
} from "@/components/ui";

export default function ExpenseLogPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const [expenses, setExpenses] = useState<MedicalExpense[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    const unsub = subscribeAllMedicalExpensesLog(supabase, setExpenses);
    return () => unsub();
  }, [user, loading, supabaseReady]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter((e) =>
      [
        e.caseNumber,
        e.providerName,
        e.accountNumber,
        e.documentType,
        e.payeeName,
        e.dropboxFilePath,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [expenses, search]);

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
        subtitle="All medical expenses in the order they were logged, newest first."
      />

      <Card className="mt-6">
        <CardHeader>
          <div className="max-w-md">
            <label className="mb-1 block text-xs font-medium text-text-muted">Search</label>
            <Input
              placeholder="Case #, provider, account…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-12">
              <EmptyState
                title="No expenses logged yet"
                description="Records appear here when medical financial documents are extracted by the filing pipeline."
              />
            </div>
          ) : (
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-alt/60 text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3">Logged</th>
                  <th className="px-4 py-3">Case</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3">Review</th>
                  <th className="px-4 py-3">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((expense) => (
                  <tr key={expense.id} className="hover:bg-surface-alt/40">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">
                      {formatLoggedAt(expense.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {expense.caseId ? (
                        <Link
                          href={`/cases/${expense.caseId}/financials/medical-expenses`}
                          className="font-medium text-primary hover:underline"
                        >
                          #{expense.caseNumber}
                        </Link>
                      ) : (
                        <span className="text-text-muted">#{expense.caseNumber}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-text">{expense.providerName}</td>
                    <td className="px-4 py-3 text-text-secondary">
                      {DOCUMENT_TYPE_LABELS[expense.documentType] ?? expense.documentType}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(expense.currentBalance ?? expense.originalCharges)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <Badge variant={reviewBadgeVariant(expense.reviewStatus)}>
                          {REVIEW_STATUS_LABELS[expense.reviewStatus]}
                        </Badge>
                        <Badge variant={paymentBadgeVariant(expense.paymentStatus)} className="w-fit">
                          {PAYMENT_STATUS_LABELS[expense.paymentStatus]}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {expense.dropboxPermalink ? (
                        <a
                          href={expense.dropboxPermalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                          title={expense.dropboxFilePath ?? undefined}
                        >
                          {sourceFileName(expense.dropboxFilePath)}
                        </a>
                      ) : (
                        <span className="text-text-muted">{sourceFileName(expense.dropboxFilePath)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <p className="mt-4 text-xs text-text-dim">
        {filtered.length} record{filtered.length === 1 ? "" : "s"}
        {search.trim() ? ` matching “${search.trim()}”` : ""}
      </p>
    </PageWrapper>
  );
}
