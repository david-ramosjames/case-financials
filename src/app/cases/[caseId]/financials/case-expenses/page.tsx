"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  markCaseExpenseReviewed,
  subscribeCase,
  subscribeCaseExpensesForCase,
  updateCaseExpense,
} from "@/lib/supabase/repo";
import { caseDisplayName } from "@/lib/case-display";
import {
  CASE_EXPENSE_DOC_LABELS,
  CASE_EXPENSE_PAYMENT_LABELS,
  CASE_EXPENSE_REVIEW_LABELS,
  formatCurrency,
  formatLoggedAt,
  paymentBadgeVariant,
  reviewBadgeVariant,
  sourceFileName,
} from "@/lib/case-expense-display";
import type { Case, CaseExpense, CaseExpenseDocumentType, CaseExpensePaymentStatus } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
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

export default function CaseExpensesPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.caseId as string;
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();

  const [caseRecord, setCaseRecord] = useState<Case | null>(null);
  const [expenses, setExpenses] = useState<CaseExpense[]>([]);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<CaseExpense>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  useEffect(() => {
    if (!supabaseReady || loading || !user || !caseId) return;
    const supabase = getBrowserSupabase();
    const unsubCase = subscribeCase(supabase, caseId, setCaseRecord);
    const unsub = subscribeCaseExpensesForCase(supabase, caseId, setExpenses);
    return () => {
      unsubCase();
      unsub();
    };
  }, [user, loading, supabaseReady, caseId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter((e) =>
      [e.vendorName, e.expenseType, e.description, e.invoiceNumber, e.referenceNumber, e.relatedParty]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [expenses, search]);

  const summary = useMemo(
    () => ({
      total: expenses.reduce((a, e) => a + (e.amount ?? 0), 0),
      paid: expenses.reduce((a, e) => a + (e.paidAmount ?? 0), 0),
      count: expenses.length,
      needsReview: expenses.filter((e) => e.reviewStatus === "needs_review" || e.reviewStatus === "pending").length,
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

  if (!hydrated) return <PageSkeleton />;

  const caseTitle = caseRecord ? caseDisplayName(caseRecord) : "Case";

  return (
    <PageWrapper>
      <nav className="mb-4 text-sm text-text-muted">
        <Link href="/" className="hover:text-primary">← Cases</Link>
        <span className="mx-2 text-text-dim">/</span>
        <span className="text-text-secondary">{caseTitle}</span>
        <span className="mx-2 text-text-dim">/</span>
        <span className="font-medium text-text">Case Expenses</span>
      </nav>

      <PageHeader
        title="Case Expenses"
        subtitle="Vendor invoices and case costs from the Expenses folder. Separate from medical provider billing."
      />

      {err && <div className="mt-4 rounded-lg border border-danger/30 bg-danger-light px-4 py-3 text-sm text-danger">{err}</div>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardBody className="py-4"><p className="text-xs uppercase text-text-muted">Total Amount</p><p className="mt-1 text-xl font-semibold">{formatCurrency(summary.total)}</p></CardBody></Card>
        <Card><CardBody className="py-4"><p className="text-xs uppercase text-text-muted">Paid</p><p className="mt-1 text-xl font-semibold">{formatCurrency(summary.paid)}</p></CardBody></Card>
        <Card><CardBody className="py-4"><p className="text-xs uppercase text-text-muted">Count</p><p className="mt-1 text-xl font-semibold">{summary.count}</p></CardBody></Card>
        <Card><CardBody className="py-4"><p className="text-xs uppercase text-text-muted">Needs Review</p><p className="mt-1 text-xl font-semibold text-warning">{summary.needsReview}</p></CardBody></Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <Input placeholder="Search vendor, invoice #, description…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-12">
              <EmptyState title="No case expenses yet" description="Expenses appear when documents are filed to the Dropbox Expenses folder." />
            </div>
          ) : (
            <table className="w-full min-w-[1200px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-alt/60 text-xs uppercase text-text-muted">
                  <th className="px-3 py-3">Logged</th>
                  <th className="px-3 py-3">Vendor</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Description</th>
                  <th className="px-3 py-3">Invoice #</th>
                  <th className="px-3 py-3">Invoice Date</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                  <th className="px-3 py-3">Payment</th>
                  <th className="px-3 py-3">Review</th>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((expense) => {
                  const editing = editingId === expense.id;
                  const row = editing ? { ...expense, ...editDraft } : expense;
                  return (
                    <tr key={expense.id} className="hover:bg-surface-alt/40">
                      <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{formatLoggedAt(row.createdAt)}</td>
                      <td className="px-3 py-2">
                        {editing ? <Input value={row.vendorName} onChange={(e) => setEditDraft((d) => ({ ...d, vendorName: e.target.value }))} /> : <span className="font-medium">{row.vendorName}</span>}
                      </td>
                      <td className="px-3 py-2">{editing ? <Input value={row.expenseType ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, expenseType: e.target.value || null }))} /> : (row.expenseType ?? "—")}</td>
                      <td className="max-w-[12rem] px-3 py-2 truncate">{editing ? <Input value={row.description ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value || null }))} /> : (row.description ?? "—")}</td>
                      <td className="px-3 py-2">{editing ? <Input value={row.invoiceNumber ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, invoiceNumber: e.target.value || null }))} /> : (row.invoiceNumber ?? "—")}</td>
                      <td className="px-3 py-2">{editing ? <Input type="date" value={row.invoiceDate ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, invoiceDate: e.target.value || null }))} /> : (row.invoiceDate ?? "—")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{editing ? <Input type="number" step="0.01" className="text-right" value={row.amount ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, amount: e.target.value ? Number(e.target.value) : null }))} /> : formatCurrency(row.amount)}</td>
                      <td className="px-3 py-2">
                        {editing ? (
                          <Select value={row.paymentStatus} onChange={(e) => setEditDraft((d) => ({ ...d, paymentStatus: e.target.value as CaseExpensePaymentStatus }))}>
                            {(Object.keys(CASE_EXPENSE_PAYMENT_LABELS) as CaseExpensePaymentStatus[]).map((s) => (
                              <option key={s} value={s}>{CASE_EXPENSE_PAYMENT_LABELS[s]}</option>
                            ))}
                          </Select>
                        ) : (
                          <Badge variant={paymentBadgeVariant(row.paymentStatus)}>{CASE_EXPENSE_PAYMENT_LABELS[row.paymentStatus]}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={reviewBadgeVariant(row.reviewStatus)}>{CASE_EXPENSE_REVIEW_LABELS[row.reviewStatus]}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {row.dropboxPermalink ? (
                          <a href={row.dropboxPermalink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{sourceFileName(row.dropboxFilePath)}</a>
                        ) : (
                          sourceFileName(row.dropboxFilePath)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {editing ? (
                            <>
                              <Button size="sm" disabled={saving} onClick={() => void saveEdit()}>{saving ? <Spinner className="h-4 w-4" /> : "Save"}</Button>
                              <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditDraft({}); }}>Cancel</Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => { setEditingId(expense.id); setEditDraft({ ...expense }); }}>Edit</Button>
                              {(expense.reviewStatus === "needs_review" || expense.reviewStatus === "pending") && (
                                <Button size="sm" variant="ghost" onClick={() => void markCaseExpenseReviewed(getBrowserSupabase(), expense.id)}>Mark Reviewed</Button>
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
        </CardBody>
      </Card>
    </PageWrapper>
  );
}
