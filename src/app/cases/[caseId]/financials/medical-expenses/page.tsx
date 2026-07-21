"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  markMedicalExpensePaid,
  markMedicalExpenseReviewed,
  subscribeCase,
  subscribeMedicalExpensesForCase,
  subscribeMedicalTrackerForCase,
  updateMedicalExpense,
} from "@/lib/supabase/repo";
import { caseDisplayName } from "@/lib/case-display";
import { isMedicalPaid, needsMedicalReview } from "@/lib/expense-review";
import { SortHeader, useSortState } from "@/lib/table-sort";
import type {
  Case,
  MedicalExpense,
  MedicalExpenseDocumentType,
  MedicalExpensePaymentStatus,
  MedicalExpenseReviewStatus,
  MedicalTrackerProvider,
} from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ManualMedicalExpenseForm } from "@/components/ManualExpenseForm";
import { MedicalProviderSummary } from "@/components/MedicalProviderSummary";
import { MedicalTracker } from "@/components/MedicalTracker";
import { MedicalFolderImport } from "@/components/MedicalFolderImport";
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

const DOCUMENT_TYPE_LABELS: Record<MedicalExpenseDocumentType, string> = {
  medical_bill: "Medical Bill",
  balance_statement: "Balance Statement",
  reduction_letter: "Reduction Letter",
  payment_invoice: "Payment Invoice",
  lop_statement: "LOP Statement",
  medical_provider_statement: "Provider Statement",
};

const PAYMENT_STATUS_LABELS: Record<MedicalExpensePaymentStatus, string> = {
  pending_review: "Pending Review",
  unpaid: "Unpaid",
  partially_paid: "Partially Paid",
  paid: "Paid",
  reduced: "Reduced",
  waived: "Waived",
  closed: "Closed",
  pending_reduction: "Pending Reduction",
  unknown: "Unknown",
};

const REVIEW_STATUS_LABELS: Record<MedicalExpenseReviewStatus, string> = {
  needs_review: "Needs Review",
  reviewed: "Reviewed",
  pending: "Pending",
  in_review: "In Review",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
};

type SortKey =
  | "providerName"
  | "documentType"
  | "accountNumber"
  | "dateOfService"
  | "originalCharges"
  | "currentBalance"
  | "finalPayAmount"
  | "paymentStatus"
  | "reviewStatus"
  | "extractionConfidence";

function formatCurrency(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatPercent(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function sourceFileName(path: string | null): string {
  if (!path) return "—";
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function reviewBadgeVariant(status: MedicalExpenseReviewStatus): "warning" | "success" | "default" {
  if (status === "needs_review" || status === "pending" || status === "in_review") return "warning";
  if (status === "reviewed" || status === "approved") return "success";
  return "default";
}

function paymentBadgeVariant(status: MedicalExpensePaymentStatus): "warning" | "success" | "primary" | "default" {
  if (status === "unpaid" || status === "pending_review" || status === "partially_paid") return "warning";
  if (status === "paid" || status === "closed" || status === "waived") return "success";
  if (status === "reduced") return "primary";
  return "default";
}

export default function MedicalExpensesPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.caseId as string;
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();

  const [caseRecord, setCaseRecord] = useState<Case | null>(null);
  const [expenses, setExpenses] = useState<MedicalExpense[]>([]);
  const [trackedProviders, setTrackedProviders] = useState<MedicalTrackerProvider[]>([]);
  const [search, setSearch] = useState("");
  const [filterReview, setFilterReview] = useState<"all" | "needs_review" | "reviewed">("all");
  const [filterPayment, setFilterPayment] = useState<"all" | MedicalExpensePaymentStatus>("all");
  const { sortKey, sortDir, toggleSort } = useSortState<SortKey>("dateOfService", "desc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<MedicalExpense>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    if (!supabaseReady || loading || !user || !caseId) return;
    const supabase = getBrowserSupabase();
    const unsubCase = subscribeCase(supabase, caseId, setCaseRecord);
    const unsubExpenses = subscribeMedicalExpensesForCase(supabase, caseId, setExpenses);
    const unsubTracker = subscribeMedicalTrackerForCase(supabase, caseId, setTrackedProviders);
    return () => {
      unsubCase();
      unsubExpenses();
      unsubTracker();
    };
  }, [user, loading, supabaseReady, caseId]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = expenses;

    if (filterReview === "needs_review") {
      list = list.filter(needsMedicalReview);
    } else if (filterReview === "reviewed") {
      list = list.filter((e) => e.reviewStatus === "reviewed" || e.reviewStatus === "approved");
    }

    if (filterPayment !== "all") list = list.filter((e) => e.paymentStatus === filterPayment);

    if (q) {
      list = list.filter((e) =>
        [e.providerName, e.accountNumber, e.documentType, e.payeeName, e.dropboxFilePath]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    return [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [expenses, search, filterReview, filterPayment, sortKey, sortDir]);

  const needsReview = useMemo(() => expenses.filter(needsMedicalReview).length, [expenses]);

  const markPaid = useCallback(async (expenseId: string) => {
    setSaving(true);
    setErr(null);
    try {
      await markMedicalExpensePaid(getBrowserSupabase(), expenseId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not mark paid");
    } finally {
      setSaving(false);
    }
  }, []);

  const startEdit = useCallback((expense: MedicalExpense) => {
    setEditingId(expense.id);
    setEditDraft({ ...expense });
    setErr(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditDraft({});
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    setSaving(true);
    setErr(null);
    try {
      await updateMedicalExpense(getBrowserSupabase(), editingId, editDraft);
      setEditingId(null);
      setEditDraft({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }, [editingId, editDraft]);

  const markReviewed = useCallback(async (expenseId: string) => {
    setSaving(true);
    setErr(null);
    try {
      await markMedicalExpenseReviewed(getBrowserSupabase(), expenseId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not mark reviewed");
    } finally {
      setSaving(false);
    }
  }, []);

  if (!hydrated) return <PageSkeleton />;

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <EmptyState title="Supabase not configured" description="Medical Expenses requires database access." />
      </PageWrapper>
    );
  }

  const caseTitle = caseRecord ? caseDisplayName(caseRecord) : "Case";

  return (
    <PageWrapper>
      <nav className="mb-4 text-sm text-text-muted">
        <Link href="/" className="hover:text-primary">
          ← Cases
        </Link>
        <span className="mx-2 text-text-dim">/</span>
        <span className="text-text-secondary">{caseTitle}</span>
        <span className="mx-2 text-text-dim">/</span>
        <span className="font-medium text-text">Medical Expenses</span>
      </nav>

      <PageHeader
        title="Medical Expenses"
        subtitle="Track providers and records first, then review financial details from filed documents."
      />

      {err && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger-light px-4 py-3 text-sm text-danger">
          {err}
        </div>
      )}

      {caseRecord?.caseNumber && (
        <MedicalFolderImport caseId={caseId} caseNumber={caseRecord.caseNumber} />
      )}

      {caseRecord?.caseNumber ? (
        <MedicalTracker
          caseId={caseId}
          caseNumber={caseRecord.caseNumber}
          trackedProviders={trackedProviders}
          expenses={expenses}
        />
      ) : (
        <Card className="mt-6 border-warning/30">
          <CardBody className="text-sm text-warning">
            Add a case number before using the Medical Tracker.
          </CardBody>
        </Card>
      )}

      <MedicalProviderSummary expenses={expenses} needsReview={needsReview} />

      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-lg font-semibold text-text">Invoices</h2>
          <p className="mt-1 text-sm text-text-muted">Individual medical bills and statements — source data for the summary above.</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-text-muted">Search</label>
              <Input placeholder="Provider, account #, document…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Review</label>
              <Select className="min-w-[9rem]" value={filterReview} onChange={(e) => setFilterReview(e.target.value as typeof filterReview)}>
                <option value="all">All</option>
                <option value="needs_review">Needs Review</option>
                <option value="reviewed">Reviewed</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">Payment</label>
              <Select className="min-w-[9rem]" value={filterPayment} onChange={(e) => setFilterPayment(e.target.value as typeof filterPayment)}>
                <option value="all">All</option>
                {(Object.keys(PAYMENT_STATUS_LABELS) as MedicalExpensePaymentStatus[]).map((s) => (
                  <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</option>
                ))}
              </Select>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
              {showAddForm ? "Cancel" : "Add file"}
            </Button>
          </div>
        </CardHeader>
        {showAddForm && caseRecord?.caseNumber && (
          <div className="px-6 pb-4">
            <ManualMedicalExpenseForm
              caseId={caseId}
              caseNumber={caseRecord.caseNumber}
              onClose={() => setShowAddForm(false)}
            />
          </div>
        )}
        {showAddForm && !caseRecord?.caseNumber && (
          <div className="px-6 pb-4 text-sm text-danger">This case has no case number — cannot add a file yet.</div>
        )}
        <CardBody className="overflow-x-auto p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-12">
              <EmptyState
                title="No medical expenses yet"
                description="Expenses appear when medical financial documents are filed through the document pipeline."
              />
            </div>
          ) : (
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-alt/60 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3"><SortHeader label="Provider" field="providerName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-4 py-3"><SortHeader label="Document Type" field="documentType" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-4 py-3"><SortHeader label="Account #" field="accountNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-4 py-3"><SortHeader label="Date of Service" field="dateOfService" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-4 py-3 text-right"><SortHeader label="Original" field="originalCharges" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                  <th className="px-4 py-3 text-right"><SortHeader label="Balance" field="currentBalance" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                  <th className="px-4 py-3 text-right"><SortHeader label="Final Pay" field="finalPayAmount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                  <th className="px-4 py-3"><SortHeader label="Payment" field="paymentStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-4 py-3"><SortHeader label="Review" field="reviewStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-4 py-3"><SortHeader label="Confidence" field="extractionConfidence" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((expense) => {
                  const isEditing = editingId === expense.id;
                  const row = isEditing ? { ...expense, ...editDraft } : expense;
                  return (
                    <tr key={expense.id} className={needsMedicalReview(expense) ? "bg-warning-light/20 hover:bg-warning-light/40" : "hover:bg-surface-alt/40"}>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Input value={row.providerName} onChange={(e) => setEditDraft((d) => ({ ...d, providerName: e.target.value }))} />
                        ) : (
                          <span className="font-medium">{row.providerName}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Select value={row.documentType} onChange={(e) => setEditDraft((d) => ({ ...d, documentType: e.target.value as MedicalExpenseDocumentType }))}>
                            {(Object.keys(DOCUMENT_TYPE_LABELS) as MedicalExpenseDocumentType[]).map((t) => (
                              <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
                            ))}
                          </Select>
                        ) : (
                          DOCUMENT_TYPE_LABELS[row.documentType] ?? row.documentType
                        )}
                      </td>
                      <td className="px-4 py-3">{isEditing ? <Input value={row.accountNumber ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, accountNumber: e.target.value || null }))} /> : row.accountNumber ?? "—"}</td>
                      <td className="px-4 py-3">{isEditing ? <Input type="date" value={row.dateOfService ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, dateOfService: e.target.value || null }))} /> : row.dateOfService ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{isEditing ? <Input type="number" step="0.01" className="text-right" value={row.originalCharges ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, originalCharges: e.target.value ? Number(e.target.value) : null }))} /> : formatCurrency(row.originalCharges)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{isEditing ? <Input type="number" step="0.01" className="text-right" value={row.currentBalance ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, currentBalance: e.target.value ? Number(e.target.value) : null }))} /> : formatCurrency(row.currentBalance)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{isEditing ? <Input type="number" step="0.01" className="text-right" value={row.finalPayAmount ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, finalPayAmount: e.target.value ? Number(e.target.value) : null }))} /> : formatCurrency(row.finalPayAmount)}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Select value={row.paymentStatus} onChange={(e) => setEditDraft((d) => ({ ...d, paymentStatus: e.target.value as MedicalExpensePaymentStatus }))}>
                            {(Object.keys(PAYMENT_STATUS_LABELS) as MedicalExpensePaymentStatus[]).map((s) => (
                              <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</option>
                            ))}
                          </Select>
                        ) : (
                          <Badge variant={paymentBadgeVariant(row.paymentStatus)}>{PAYMENT_STATUS_LABELS[row.paymentStatus]}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={reviewBadgeVariant(row.reviewStatus)}>{REVIEW_STATUS_LABELS[row.reviewStatus]}</Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-text-secondary">
                        {row.extractionConfidence != null ? formatPercent(row.extractionConfidence) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {row.dropboxPermalink ? (
                          <a href={row.dropboxPermalink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" title={row.dropboxFilePath ?? undefined}>
                            {sourceFileName(row.dropboxFilePath)}
                          </a>
                        ) : (
                          sourceFileName(row.dropboxFilePath)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {isEditing ? (
                            <>
                              <Button size="sm" disabled={saving} onClick={() => void saveEdit()}>{saving ? <Spinner className="h-4 w-4" /> : "Save"}</Button>
                              <Button size="sm" variant="ghost" disabled={saving} onClick={cancelEdit}>Cancel</Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => startEdit(expense)}>Edit</Button>
                              {needsMedicalReview(expense) && (
                                <Button size="sm" variant="ghost" disabled={saving} onClick={() => void markReviewed(expense.id)}>Reviewed</Button>
                              )}
                              {!isMedicalPaid(expense) && (
                                <Button size="sm" variant="ghost" disabled={saving} onClick={() => void markPaid(expense.id)}>Paid</Button>
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
