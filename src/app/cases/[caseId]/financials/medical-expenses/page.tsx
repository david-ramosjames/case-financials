"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  alignProviderName,
  buildMedicalProviderSummary,
  deriveLineAmounts,
} from "@/lib/medical-provider-summary";
import { isMedicalImportConfigured } from "@/lib/medical-import-api";
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
import { MedicalTracker, type MedicalTrackerHandle } from "@/components/MedicalTracker";
import { MedicalFolderImport } from "@/components/MedicalFolderImport";
import { CaseFinancialHero, StatusDot } from "@/components/CaseFinancialHero";
import { FinancialSection } from "@/components/FinancialSection";
import { CaseExpensesSection } from "@/components/CaseExpensesSection";
import { useHydrated } from "@/hooks/useHydrated";
import {
  Button,
  EmptyState,
  Input,
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

function reviewStatusKind(
  status: MedicalExpenseReviewStatus
): "action" | "success" | "neutral" {
  if (status === "needs_review" || status === "pending" || status === "in_review") return "action";
  if (status === "reviewed" || status === "approved") return "success";
  return "neutral";
}

function paymentStatusKind(
  status: MedicalExpensePaymentStatus
): "action" | "success" | "neutral" {
  if (status === "paid" || status === "closed" || status === "waived") return "success";
  if (status === "unpaid" || status === "pending_review" || status === "partially_paid") return "action";
  return "neutral";
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
  const [importOpen, setImportOpen] = useState(false);
  const trackerRef = useRef<MedicalTrackerHandle>(null);

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

  const summary = useMemo(() => buildMedicalProviderSummary(expenses), [expenses]);

  const lopProviders = useMemo(
    () => trackedProviders.filter((p) => p.hasLop === true).length,
    [trackedProviders]
  );

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
      <nav className="mb-8 text-[13px] text-text-muted">
        <Link href="/" className="hover:text-accent">
          ← Cases
        </Link>
        <span className="mx-2 text-text-dim">/</span>
        <span className="text-text-secondary">{caseTitle}</span>
        <span className="mx-2 text-text-dim">/</span>
        <span className="text-text">Financials</span>
      </nav>

      <div className="space-y-14">
          {caseRecord && (
            <CaseFinancialHero
              caseRecord={caseRecord}
              outstanding={summary.totals.outstanding}
              total={summary.totals.charge}
              paid={summary.totals.paid}
              providerCount={summary.providers.length || trackedProviders.length}
              needsReview={needsReview}
              lopProviders={lopProviders}
              importConfigured={isMedicalImportConfigured() && Boolean(caseRecord.caseNumber)}
              onImport={() => setImportOpen(true)}
              onAddProvider={
                caseRecord.caseNumber
                  ? () => {
                      document.getElementById("medical-tracker")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      trackerRef.current?.beginAdd();
                    }
                  : undefined
              }
            />
          )}

          {err && (
            <div className="rounded-xl bg-danger-light px-4 py-3 text-sm text-danger">{err}</div>
          )}

          {caseRecord?.caseNumber && (
            <MedicalFolderImport
              caseId={caseId}
              caseNumber={caseRecord.caseNumber}
              open={importOpen}
              onOpenChange={setImportOpen}
              hideTrigger
            />
          )}

          <FinancialSection
            id="medical-tracker"
            level={2}
            title="Medical Tracker"
            description="Track provider progression from LOP → treatment → final bill."
          >
            {caseRecord?.caseNumber ? (
              <div className="-mx-6 -mb-5 lg:-mx-8 lg:-mb-6">
                <MedicalTracker
                  ref={trackerRef}
                  caseId={caseId}
                  caseNumber={caseRecord.caseNumber}
                  trackedProviders={trackedProviders}
                  expenses={expenses}
                  hideChrome
                />
              </div>
            ) : (
              <p className="text-[15px] text-warning">Add a case number before using the Medical Tracker.</p>
            )}
          </FinancialSection>

          <FinancialSection
            id="financial-summary"
            level={3}
            title="Financial Summary"
            description="Outstanding balances rolled up by provider."
          >
            <MedicalProviderSummary expenses={expenses} needsReview={needsReview} />
          </FinancialSection>

          <FinancialSection
            id="invoices"
            level={4}
            title="Invoices"
            description="Review individual medical bills — which provider, how much, what needs action."
            actions={
              <Button size="sm" variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
                {showAddForm ? "Cancel" : "Upload Invoice"}
              </Button>
            }
          >
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-dim">
                    Search
                  </label>
                  <Input
                    className="border-0 bg-surface-alt/70 shadow-none focus:ring-1"
                    placeholder="Provider, account #…"
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
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-dim">
                    Payment
                  </label>
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
              </div>

              {showAddForm && caseRecord?.caseNumber && (
                <div className="mt-5">
                  <ManualMedicalExpenseForm
                    caseId={caseId}
                    caseNumber={caseRecord.caseNumber}
                    onClose={() => setShowAddForm(false)}
                  />
                </div>
              )}
              {showAddForm && !caseRecord?.caseNumber && (
                <p className="mt-4 text-sm text-danger">This case has no case number — cannot upload yet.</p>
              )}

              <div className="mt-6 -mx-6 overflow-hidden lg:-mx-8">
                {filtered.length === 0 ? (
                  <div className="px-6 py-12 lg:px-8">
                    <EmptyState
                      title="No invoices yet"
                      description="Import Dropbox files or upload an invoice to get started."
                    />
                  </div>
                ) : (
                  <table className="w-full table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[28%]" />
                      <col className="w-[14%]" />
                      <col className="w-[14%]" />
                      <col className="w-[14%]" />
                      <col className="w-[18%]" />
                      <col className="w-[12%]" />
                    </colgroup>
                    <thead>
                      <tr className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-dim">
                        <th className="px-6 py-3 lg:px-8">
                          <SortHeader
                            label="Provider"
                            field="providerName"
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={toggleSort}
                          />
                        </th>
                        <th className="px-3 py-3 text-right">
                          <SortHeader
                            label="Outstanding"
                            field="currentBalance"
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={toggleSort}
                            align="right"
                          />
                        </th>
                        <th className="px-3 py-3">
                          <SortHeader
                            label="Review"
                            field="reviewStatus"
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={toggleSort}
                          />
                        </th>
                        <th className="px-3 py-3">
                          <SortHeader
                            label="Payment"
                            field="paymentStatus"
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={toggleSort}
                          />
                        </th>
                        <th className="px-3 py-3">Details</th>
                        <th className="px-4 py-3 text-right lg:px-8"> </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {filtered.map((expense) => {
                        const isEditing = editingId === expense.id;
                        const row = isEditing ? { ...expense, ...editDraft } : expense;
                        const displayProvider = isEditing
                          ? row.providerName
                          : alignProviderName(row.providerName, providerNameCandidates);
                        const sourceLabel = sourceFileName(row.dropboxFilePath);
                        const amounts = deriveLineAmounts(expense);
                        return (
                          <tr
                            key={expense.id}
                            className={
                              needsMedicalReview(expense)
                                ? "bg-warning-light/25 hover:bg-warning-light/40"
                                : "hover:bg-surface-alt/40"
                            }
                          >
                            <td className="min-w-0 px-6 py-4 align-top lg:px-8">
                              {isEditing ? (
                                <Input
                                  className="border-0 bg-surface-alt px-2 py-1.5 text-sm"
                                  value={row.providerName}
                                  onChange={(e) =>
                                    setEditDraft((d) => ({ ...d, providerName: e.target.value }))
                                  }
                                />
                              ) : (
                                <>
                                  <span
                                    className="block truncate text-[15px] font-medium text-text"
                                    title={displayProvider}
                                  >
                                    {displayProvider}
                                  </span>
                                  {row.dropboxPermalink ? (
                                    <a
                                      href={row.dropboxPermalink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mt-1 block truncate text-[12px] text-accent hover:underline"
                                      title={row.dropboxFilePath ?? sourceLabel}
                                    >
                                      {sourceLabel}
                                    </a>
                                  ) : sourceLabel !== "—" ? (
                                    <span className="mt-1 block truncate text-[12px] text-text-dim">
                                      {sourceLabel}
                                    </span>
                                  ) : null}
                                </>
                              )}
                            </td>
                            <td className="px-3 py-4 text-right align-top">
                              {isEditing ? (
                                <Input
                                  type="number"
                                  step="0.01"
                                  className="border-0 bg-surface-alt px-2 py-1.5 text-right text-sm"
                                  value={row.currentBalance ?? ""}
                                  onChange={(e) =>
                                    setEditDraft((d) => ({
                                      ...d,
                                      currentBalance: e.target.value ? Number(e.target.value) : null,
                                    }))
                                  }
                                />
                              ) : (
                                <span className="text-base font-semibold tabular-nums text-text">
                                  {formatCurrency(amounts.outstanding)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-4 align-top">
                              <StatusDot kind={reviewStatusKind(row.reviewStatus)}>
                                {REVIEW_STATUS_LABELS[row.reviewStatus]}
                              </StatusDot>
                            </td>
                            <td className="min-w-0 px-3 py-4 align-top">
                              {isEditing ? (
                                <Select
                                  className="border-0 bg-surface-alt px-2 py-1.5 text-xs"
                                  value={row.paymentStatus}
                                  onChange={(e) =>
                                    setEditDraft((d) => ({
                                      ...d,
                                      paymentStatus: e.target.value as MedicalExpensePaymentStatus,
                                    }))
                                  }
                                >
                                  {(Object.keys(PAYMENT_STATUS_LABELS) as MedicalExpensePaymentStatus[]).map(
                                    (s) => (
                                      <option key={s} value={s}>
                                        {PAYMENT_STATUS_LABELS[s]}
                                      </option>
                                    )
                                  )}
                                </Select>
                              ) : (
                                <StatusDot kind={paymentStatusKind(row.paymentStatus)}>
                                  {PAYMENT_STATUS_LABELS[row.paymentStatus]}
                                </StatusDot>
                              )}
                            </td>
                            <td className="px-3 py-4 align-top text-[12px] leading-relaxed text-text-dim">
                              {isEditing ? (
                                <div className="space-y-2">
                                  <Select
                                    className="border-0 bg-surface-alt px-2 py-1 text-xs"
                                    value={row.documentType}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        documentType: e.target.value as MedicalExpenseDocumentType,
                                      }))
                                    }
                                  >
                                    {(Object.keys(DOCUMENT_TYPE_LABELS) as MedicalExpenseDocumentType[]).map(
                                      (t) => (
                                        <option key={t} value={t}>
                                          {DOCUMENT_TYPE_LABELS[t]}
                                        </option>
                                      )
                                    )}
                                  </Select>
                                  <Input
                                    className="border-0 bg-surface-alt px-2 py-1 text-xs"
                                    placeholder="Account #"
                                    value={row.accountNumber ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        accountNumber: e.target.value || null,
                                      }))
                                    }
                                  />
                                  <Input
                                    type="date"
                                    className="border-0 bg-surface-alt px-2 py-1 text-xs"
                                    value={row.dateOfService ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        dateOfService: e.target.value || null,
                                      }))
                                    }
                                  />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    className="border-0 bg-surface-alt px-2 py-1 text-xs"
                                    placeholder="Original"
                                    value={row.originalCharges ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        originalCharges: e.target.value ? Number(e.target.value) : null,
                                      }))
                                    }
                                  />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    className="border-0 bg-surface-alt px-2 py-1 text-xs"
                                    placeholder="Final"
                                    value={row.finalPayAmount ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        finalPayAmount: e.target.value ? Number(e.target.value) : null,
                                      }))
                                    }
                                  />
                                </div>
                              ) : (
                                <>
                                  <div>{DOCUMENT_TYPE_LABELS[row.documentType] ?? row.documentType}</div>
                                  <div className="mt-0.5">
                                    {row.dateOfService ?? "No DOS"}
                                    {row.accountNumber ? ` · #${row.accountNumber}` : ""}
                                  </div>
                                  <div className="mt-0.5 tabular-nums">
                                    Charge {formatCurrency(row.originalCharges)}
                                    {row.extractionConfidence != null
                                      ? ` · ${formatPercent(row.extractionConfidence)}`
                                      : ""}
                                  </div>
                                </>
                              )}
                            </td>
                            <td className="px-4 py-4 align-top lg:px-8">
                              <div className="flex flex-col items-end gap-1">
                                {isEditing ? (
                                  <>
                                    <Button size="sm" disabled={saving} onClick={() => void saveEdit()}>
                                      {saving ? <Spinner className="h-4 w-4" /> : "Save"}
                                    </Button>
                                    <Button size="sm" variant="ghost" disabled={saving} onClick={cancelEdit}>
                                      Cancel
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button size="sm" variant="ghost" onClick={() => startEdit(expense)}>
                                      Edit
                                    </Button>
                                    {needsMedicalReview(expense) && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={saving}
                                        onClick={() => void markReviewed(expense.id)}
                                      >
                                        Reviewed
                                      </Button>
                                    )}
                                    {!isMedicalPaid(expense) && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={saving}
                                        onClick={() => void markPaid(expense.id)}
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
            </FinancialSection>

          <CaseExpensesSection caseId={caseId} caseNumber={caseRecord?.caseNumber ?? null} />
      </div>
    </PageWrapper>
  );
}
