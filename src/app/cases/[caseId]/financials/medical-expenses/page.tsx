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
import { alignProviderName } from "@/lib/medical-provider-summary";
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
import { CaseSummaryCard } from "@/components/CaseSummaryCard";
import { CaseExpensesSection } from "@/components/CaseExpensesSection";
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

  const providerNameCandidates = useMemo(
    () => expenses.map((e) => e.providerName.trim() || "Unknown provider"),
    [expenses]
  );

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
        <span className="font-medium text-text">Financials</span>
      </nav>

      {caseRecord && <CaseSummaryCard caseRecord={caseRecord} />}

      <PageHeader
        className="mt-6"
        title="Case Financials"
        subtitle="Medical tracker and invoices first, then vendor case expenses — all on one page."
      />

      {err && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger-light px-4 py-3 text-sm text-danger">
          {err}
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-xl font-semibold text-text">Medical Expenses</h2>
        <p className="mt-1 text-sm text-text-muted">
          Track providers and records first, then review financial details from filed medical documents.
        </p>
      </div>

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
        <CardBody className="overflow-hidden p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-12">
              <EmptyState
                title="No medical expenses yet"
                description="Expenses appear when medical financial documents are filed through the document pipeline."
              />
            </div>
          ) : (
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[5%]" />
                <col className="w-[5%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-surface-alt/60 text-[11px] uppercase tracking-wide">
                  <th className="px-2 py-2"><SortHeader label="Provider" field="providerName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-2 py-2"><SortHeader label="Type" field="documentType" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-2 py-2"><SortHeader label="Acct #" field="accountNumber" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-2 py-2"><SortHeader label="DOS" field="dateOfService" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-2 py-2 text-right"><SortHeader label="Original" field="originalCharges" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                  <th className="px-2 py-2 text-right"><SortHeader label="Balance" field="currentBalance" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                  <th className="px-2 py-2 text-right"><SortHeader label="Final" field="finalPayAmount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                  <th className="px-2 py-2"><SortHeader label="Payment" field="paymentStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-2 py-2"><SortHeader label="Review" field="reviewStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-2 py-2"><SortHeader label="Conf" field="extractionConfidence" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-2 py-2"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((expense) => {
                  const isEditing = editingId === expense.id;
                  const row = isEditing ? { ...expense, ...editDraft } : expense;
                  const displayProvider = isEditing
                    ? row.providerName
                    : alignProviderName(row.providerName, providerNameCandidates);
                  const sourceLabel = sourceFileName(row.dropboxFilePath);
                  return (
                    <tr key={expense.id} className={needsMedicalReview(expense) ? "bg-warning-light/20 hover:bg-warning-light/40" : "hover:bg-surface-alt/40"}>
                      <td className="min-w-0 px-2 py-2 align-top">
                        {isEditing ? (
                          <Input className="px-1.5 py-1 text-xs" value={row.providerName} onChange={(e) => setEditDraft((d) => ({ ...d, providerName: e.target.value }))} />
                        ) : (
                          <>
                            <span className="block truncate font-medium" title={displayProvider}>{displayProvider}</span>
                            {row.dropboxPermalink ? (
                              <a
                                href={row.dropboxPermalink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-0.5 block truncate text-[11px] leading-tight text-primary hover:underline"
                                title={row.dropboxFilePath ?? sourceLabel}
                              >
                                {sourceLabel}
                              </a>
                            ) : sourceLabel !== "—" ? (
                              <span className="mt-0.5 block truncate text-[11px] leading-tight text-text-dim" title={row.dropboxFilePath ?? undefined}>
                                {sourceLabel}
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="min-w-0 px-2 py-2">
                        {isEditing ? (
                          <Select className="px-1.5 py-1 text-xs" value={row.documentType} onChange={(e) => setEditDraft((d) => ({ ...d, documentType: e.target.value as MedicalExpenseDocumentType }))}>
                            {(Object.keys(DOCUMENT_TYPE_LABELS) as MedicalExpenseDocumentType[]).map((t) => (
                              <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
                            ))}
                          </Select>
                        ) : (
                          <span className="block truncate" title={DOCUMENT_TYPE_LABELS[row.documentType] ?? row.documentType}>
                            {DOCUMENT_TYPE_LABELS[row.documentType] ?? row.documentType}
                          </span>
                        )}
                      </td>
                      <td className="min-w-0 truncate px-2 py-2" title={row.accountNumber ?? undefined}>{isEditing ? <Input className="px-1.5 py-1 text-xs" value={row.accountNumber ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, accountNumber: e.target.value || null }))} /> : row.accountNumber ?? "—"}</td>
                      <td className="px-2 py-2">{isEditing ? <Input type="date" className="px-1 py-1 text-xs" value={row.dateOfService ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, dateOfService: e.target.value || null }))} /> : row.dateOfService ?? "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{isEditing ? <Input type="number" step="0.01" className="px-1.5 py-1 text-right text-xs" value={row.originalCharges ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, originalCharges: e.target.value ? Number(e.target.value) : null }))} /> : formatCurrency(row.originalCharges)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{isEditing ? <Input type="number" step="0.01" className="px-1.5 py-1 text-right text-xs" value={row.currentBalance ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, currentBalance: e.target.value ? Number(e.target.value) : null }))} /> : formatCurrency(row.currentBalance)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{isEditing ? <Input type="number" step="0.01" className="px-1.5 py-1 text-right text-xs" value={row.finalPayAmount ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, finalPayAmount: e.target.value ? Number(e.target.value) : null }))} /> : formatCurrency(row.finalPayAmount)}</td>
                      <td className="min-w-0 px-2 py-2">
                        {isEditing ? (
                          <Select className="px-1.5 py-1 text-xs" value={row.paymentStatus} onChange={(e) => setEditDraft((d) => ({ ...d, paymentStatus: e.target.value as MedicalExpensePaymentStatus }))}>
                            {(Object.keys(PAYMENT_STATUS_LABELS) as MedicalExpensePaymentStatus[]).map((s) => (
                              <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</option>
                            ))}
                          </Select>
                        ) : (
                          <Badge variant={paymentBadgeVariant(row.paymentStatus)}>{PAYMENT_STATUS_LABELS[row.paymentStatus]}</Badge>
                        )}
                      </td>
                      <td className="min-w-0 px-2 py-2">
                        <Badge variant={reviewBadgeVariant(row.reviewStatus)}>{REVIEW_STATUS_LABELS[row.reviewStatus]}</Badge>
                      </td>
                      <td className="px-2 py-2 tabular-nums text-text-secondary">
                        {row.extractionConfidence != null ? formatPercent(row.extractionConfidence) : "—"}
                      </td>
                      <td className="px-1 py-2">
                        <div className="flex flex-col items-stretch gap-1">
                          {isEditing ? (
                            <>
                              <Button size="sm" className="px-2" disabled={saving} onClick={() => void saveEdit()}>{saving ? <Spinner className="h-4 w-4" /> : "Save"}</Button>
                              <Button size="sm" variant="ghost" className="px-2" disabled={saving} onClick={cancelEdit}>Cancel</Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="secondary" className="px-2" onClick={() => startEdit(expense)}>Edit</Button>
                              {needsMedicalReview(expense) && (
                                <Button size="sm" variant="ghost" className="px-2" disabled={saving} onClick={() => void markReviewed(expense.id)}>Reviewed</Button>
                              )}
                              {!isMedicalPaid(expense) && (
                                <Button size="sm" variant="ghost" className="px-2" disabled={saving} onClick={() => void markPaid(expense.id)}>Paid</Button>
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

      <CaseExpensesSection caseId={caseId} caseNumber={caseRecord?.caseNumber ?? null} />
    </PageWrapper>
  );
}
