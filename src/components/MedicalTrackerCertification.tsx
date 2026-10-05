"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  createMedicalTrackerAttestation,
  fetchCaseExpensesForCase,
  fetchFinancialVersions,
  fetchMedicalExpensesForCase,
  fetchMedicalTrackerAttestations,
  fetchMedicalTrackerForCase,
  fetchLearnedProviderAliases,
  fetchProviderAliases,
  subscribeCaseExpensesForCase,
} from "@/lib/supabase/repo";
import { applyProviderAliases } from "@/lib/provider-aliases";
import {
  ATTESTATION_STATEMENT_SETS,
  CERTIFICATION_SCOPES,
  SCOPE_DOCUMENT_TITLES,
  SCOPE_LABELS,
  buildStatementRecords,
  buildTrackerSnapshot,
  formatCentralTime,
  hashSnapshot,
  isAttestationCurrent,
  isFlaggedCaseExpense,
  isFlaggedInvoice,
  reviewerDisplayName,
  scopeIncludesExpenses,
  scopeIncludesMedical,
  type CertificationScope,
  type FinancialVersions,
  type MedicalTrackerAttestation,
} from "@/lib/medical-attestation";
import { buildMedicalLedger } from "@/lib/medical-ledger";
import type { Case, CaseExpense, MedicalExpense, MedicalTrackerProvider } from "@/lib/types";
import { FinancialSection } from "@/components/FinancialSection";
import { Badge, Button, Spinner } from "@/components/ui";

async function downloadPdf(attestation: MedicalTrackerAttestation) {
  const { downloadMedicalTrackerPdf } = await import("@/lib/medical-tracker-pdf");
  downloadMedicalTrackerPdf(attestation);
}

/** e.g. "Medical Tracker version 7 and Case Expenses version 3" */
function describeVersions(scope: CertificationScope, v: FinancialVersions): string {
  const parts: string[] = [];
  if (scopeIncludesMedical(scope)) parts.push(`Medical Tracker version ${v.medical}`);
  if (scopeIncludesExpenses(scope)) parts.push(`Case Expenses version ${v.expenses}`);
  return parts.join(" and ");
}

function changedLabel(scope: CertificationScope, before: FinancialVersions, after: FinancialVersions): string | null {
  const medical = scopeIncludesMedical(scope) && before.medical !== after.medical;
  const expenses = scopeIncludesExpenses(scope) && before.expenses !== after.expenses;
  if (medical && expenses) return "The Medical Tracker and Case Expenses";
  if (medical) return "The Medical Tracker";
  if (expenses) return "Case Expenses";
  return null;
}

export function MedicalTrackerCertification({
  caseRecord,
  trackedProviders,
  expenses,
  providersNeedingReview = 0,
  onCurrentMedicalCertification,
}: {
  caseRecord: Case;
  trackedProviders: MedicalTrackerProvider[];
  expenses: MedicalExpense[];
  /** Providers whose totals haven't been confirmed; blocks medical certification. */
  providersNeedingReview?: number;
  onCurrentMedicalCertification?: (attestation: MedicalTrackerAttestation | null) => void;
}) {
  const { user } = useAuth();
  const caseId = caseRecord.id;
  const [scope, setScope] = useState<CertificationScope>("medical");
  const [versions, setVersions] = useState<FinancialVersions | null>(null);
  const [caseExpenses, setCaseExpenses] = useState<CaseExpense[]>([]);
  const [attestations, setAttestations] = useState<MedicalTrackerAttestation[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recertifying, setRecertifying] = useState(false);
  const reviewedVersions = useRef<FinancialVersions | null>(null);

  useEffect(
    () => subscribeCaseExpensesForCase(getBrowserSupabase(), caseId, setCaseExpenses),
    [caseId]
  );

  const load = useCallback(async () => {
    const supabase = getBrowserSupabase();
    try {
      const [v, list] = await Promise.all([
        fetchFinancialVersions(supabase, caseId),
        fetchMedicalTrackerAttestations(supabase, caseId),
      ]);
      setVersions(v);
      setAttestations(list);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not load certification status: ${e.message}`
          : "Could not load certification status"
      );
    } finally {
      setLoaded(true);
    }
  }, [caseId]);

  // Re-check versions whenever the live data changes.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 400);
    return () => window.clearTimeout(timer);
  }, [load, trackedProviders, expenses, caseExpenses]);

  // A review only applies to the data the reviewer looked at.
  useEffect(() => {
    if (!versions || !reviewedVersions.current) return;
    if (!Object.values(checked).some(Boolean)) return;
    const changed = changedLabel(scope, reviewedVersions.current, versions);
    if (changed) {
      setChecked({});
      setNotice(`${changed} changed while you were reviewing, so the checklist was reset.`);
    }
  }, [versions, checked, scope]);

  const statementSet = ATTESTATION_STATEMENT_SETS[scope];
  const scopeAttestations = attestations.filter((a) => a.scope === scope);
  const latest = scopeAttestations[0] ?? null;
  const isCurrent = Boolean(latest && versions && isAttestationCurrent(latest, versions));
  const allChecked = statementSet.statements.every((s) => checked[s.id]);

  const ledger = useMemo(() => buildMedicalLedger(expenses), [expenses]);
  const flaggedInvoices = useMemo(() => ledger.counted.filter(isFlaggedInvoice).length, [ledger]);
  const pendingSuggestions = scopeIncludesMedical(scope) ? ledger.suggestions.length : 0;
  const flaggedCaseExpenses = useMemo(() => caseExpenses.filter(isFlaggedCaseExpense).length, [caseExpenses]);
  const flaggedMessages: string[] = [];
  if (scopeIncludesMedical(scope) && flaggedInvoices > 0) {
    flaggedMessages.push(`${flaggedInvoices} invoice${flaggedInvoices === 1 ? " is" : "s are"}`);
  }
  if (scopeIncludesExpenses(scope) && flaggedCaseExpenses > 0) {
    flaggedMessages.push(`${flaggedCaseExpenses} case expense${flaggedCaseExpenses === 1 ? " is" : "s are"}`);
  }

  const currentIds = useMemo(() => {
    if (!versions) return new Set<string>();
    const ids = new Set<string>();
    for (const s of CERTIFICATION_SCOPES) {
      const newest = attestations.find((a) => a.scope === s);
      if (newest && isAttestationCurrent(newest, versions)) ids.add(newest.id);
    }
    return ids;
  }, [attestations, versions]);

  useEffect(() => {
    if (!onCurrentMedicalCertification) return;
    const current =
      (["medical", "all"] as CertificationScope[])
        .map((s) => attestations.find((a) => a.scope === s))
        .find((a) => a && currentIds.has(a.id)) ?? null;
    onCurrentMedicalCertification(current);
  }, [attestations, currentIds, onCurrentMedicalCertification]);

  const blockedByProviderReview = scopeIncludesMedical(scope) && providersNeedingReview > 0;

  const selectScope = (next: CertificationScope) => {
    if (next === scope) return;
    setScope(next);
    setRecertifying(false);
    setChecked({});
    setNotice(null);
    setError(null);
    reviewedVersions.current = null;
  };

  const toggle = (id: string) => {
    setNotice(null);
    if (!Object.values(checked).some(Boolean)) reviewedVersions.current = versions;
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const certify = async () => {
    const reviewed = reviewedVersions.current;
    if (!user || !allChecked || !reviewed) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const supabase = getBrowserSupabase();
      const before = await fetchFinancialVersions(supabase, caseId);
      const [rawProviders, rawExpenses, freshCaseExpenses, aliases, learned] = await Promise.all([
        scopeIncludesMedical(scope) ? fetchMedicalTrackerForCase(supabase, caseId) : Promise.resolve([]),
        scopeIncludesMedical(scope) ? fetchMedicalExpensesForCase(supabase, caseId) : Promise.resolve([]),
        scopeIncludesExpenses(scope) ? fetchCaseExpensesForCase(supabase, caseId) : Promise.resolve([]),
        scopeIncludesMedical(scope) ? fetchProviderAliases(supabase, caseId).catch(() => []) : Promise.resolve([]),
        scopeIncludesMedical(scope) ? fetchLearnedProviderAliases(supabase).catch(() => []) : Promise.resolve([]),
      ]);
      const freshProviders = applyProviderAliases(rawProviders, aliases, learned);
      const freshExpenses = applyProviderAliases(rawExpenses, aliases, learned);
      const after = await fetchFinancialVersions(supabase, caseId);
      const updating = changedLabel(scope, before, after);
      if (updating) {
        throw new Error(`${updating} ${updating === "Case Expenses" ? "are" : "is"} being updated right now. Wait a moment and try again.`);
      }
      const changed = changedLabel(scope, reviewed, after);
      if (changed) {
        setChecked({});
        setVersions(after);
        throw new Error(`${changed} changed since you started reviewing. Review the latest data and certify again.`);
      }

      const snapshot = buildTrackerSnapshot(scope, caseRecord, freshProviders, freshExpenses, freshCaseExpenses);
      const attestation = await createMedicalTrackerAttestation(supabase, {
        caseId,
        scope,
        versions: after,
        statementSetVersion: statementSet.version,
        statements: buildStatementRecords(scope, checked),
        snapshot,
        snapshotHash: await hashSnapshot(snapshot),
        reviewerName: reviewerDisplayName(user),
      });

      setChecked({});
      setRecertifying(false);
      setAttestations((prev) => [attestation, ...prev]);
      await downloadPdf(attestation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not certify");
      void load();
    } finally {
      setSubmitting(false);
    }
  };

  const downloadLatest = async () => {
    if (!latest || !isCurrent) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadPdf(latest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <FinancialSection
      id="certified-pdf"
      level={3}
      title="Certified PDF"
      description="Choose what the PDF covers, then review and certify it. Any later change to the certified data requires a new review."
    >
      {!loaded ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Spinner className="h-4 w-4" /> Checking certification status…
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label="PDF contents" className="inline-flex rounded-lg bg-surface-alt p-1">
              {CERTIFICATION_SCOPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={scope === s}
                  disabled={submitting}
                  onClick={() => selectScope(s)}
                  className={
                    scope === s
                      ? "rounded-md bg-surface px-3.5 py-1.5 text-sm font-semibold text-text shadow-sm"
                      : "rounded-md px-3.5 py-1.5 text-sm text-text-muted transition hover:text-text"
                  }
                >
                  {SCOPE_LABELS[s]}
                </button>
              ))}
            </div>
            <span className="text-[13px] text-text-muted">{SCOPE_DOCUMENT_TITLES[scope]}</span>
          </div>

          {error && <p className="rounded-lg bg-danger-light px-4 py-3 text-sm text-danger">{error}</p>}
          {notice && <p className="rounded-lg bg-warning-light px-4 py-3 text-sm text-warning">{notice}</p>}

          {latest && isCurrent && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-success-light px-5 py-4">
              <div className="text-sm">
                <p className="font-semibold text-success">Reviewed &amp; Verified</p>
                <p className="mt-1 text-text-secondary">
                  {latest.reviewerName} certified{" "}
                  {describeVersions(scope, { medical: latest.trackerVersion, expenses: latest.expensesVersion })} on{" "}
                  {formatCentralTime(latest.attestedAt)}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!recertifying && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setRecertifying(true);
                      setChecked({});
                      setNotice(null);
                      setError(null);
                    }}
                  >
                    Certify new version
                  </Button>
                )}
                <Button disabled={downloading} onClick={() => void downloadLatest()}>
                  {downloading ? <Spinner className="h-4 w-4" /> : `Download PDF (v${latest.pdfVersion})`}
                </Button>
              </div>
            </div>
          )}

          {latest && !isCurrent && (
            <div className="rounded-xl bg-warning-light px-5 py-4 text-sm">
              <p className="font-semibold text-warning">Certification out of date</p>
              <p className="mt-1 text-text-secondary">
                {latest.reviewerName} certified{" "}
                {describeVersions(scope, { medical: latest.trackerVersion, expenses: latest.expensesVersion })} on{" "}
                {formatCentralTime(latest.attestedAt)}, but the data has changed since then
                {versions ? ` (now ${describeVersions(scope, versions)})` : ""}. A new review is required
                before generating a final PDF.
              </p>
            </div>
          )}

          {(!isCurrent || recertifying) && (
            <div className="rounded-xl border border-border px-5 py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold text-text">Required attestations</h3>
                {versions && (
                  <span className="text-[13px] tabular-nums text-text-muted">
                    Reviewing {describeVersions(scope, versions)}
                  </span>
                )}
              </div>
              {flaggedMessages.length > 0 && (
                <p className="mt-2 text-sm text-warning">
                  {flaggedMessages.join(" and ")} currently flagged (needs review or low extraction confidence).
                </p>
              )}
              {pendingSuggestions > 0 && (
                <p className="mt-2 text-sm text-warning">
                  {pendingSuggestions} medical document{pendingSuggestions === 1 ? " looks" : "s look"} like a
                  duplicate or older balance and {pendingSuggestions === 1 ? "is" : "are"} left out of the PDF.
                  Confirm or keep {pendingSuggestions === 1 ? "it" : "them"} under Invoices before certifying.
                </p>
              )}

              <ul className="mt-4 space-y-3">
                {statementSet.statements.map((statement) => (
                  <li key={statement.id}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition hover:bg-surface-alt/60">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                        checked={checked[statement.id] === true}
                        disabled={submitting}
                        onChange={() => toggle(statement.id)}
                      />
                      <span className="text-sm">
                        <span className="block font-medium text-text">{statement.title}</span>
                        <span className="mt-0.5 block text-text-muted">{statement.detail}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button
                  disabled={!allChecked || submitting || !user || blockedByProviderReview}
                  onClick={() => void certify()}
                >
                  {submitting ? <Spinner className="h-4 w-4" /> : "Generate Final PDF"}
                </Button>
                <span className="text-[13px] text-text-muted">
                  {blockedByProviderReview
                    ? `Confirm totals for ${providersNeedingReview} more provider${providersNeedingReview === 1 ? "" : "s"} under Invoices first.`
                    : allChecked
                      ? `Signing as ${user ? reviewerDisplayName(user) : "—"}. Your certification is logged.`
                      : recertifying && latest
                        ? `This creates PDF v${latest.pdfVersion + 1}; v${latest.pdfVersion} stays in the history.`
                        : "Check every statement to enable the final PDF."}
                </span>
                {recertifying && (
                  <Button
                    variant="ghost"
                    disabled={submitting}
                    onClick={() => {
                      setRecertifying(false);
                      setChecked({});
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}

          {attestations.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-text-muted hover:text-text">
                Certification history ({attestations.length})
              </summary>
              <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
                {attestations.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="text-text-secondary">
                      <span className="font-medium text-text">
                        {SCOPE_LABELS[a.scope]} · PDF v{a.pdfVersion}
                      </span>
                      {scopeIncludesMedical(a.scope) && ` · Tracker v${a.trackerVersion}`}
                      {scopeIncludesExpenses(a.scope) && ` · Expenses v${a.expensesVersion}`} · {a.reviewerName} ·{" "}
                      {formatCentralTime(a.attestedAt)}
                    </span>
                    <Badge variant={currentIds.has(a.id) ? "success" : "default"}>
                      {currentIds.has(a.id) ? "Current" : "Superseded"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </FinancialSection>
  );
}
