"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  subscribeCase,
  subscribeMedicalExpensesForCase,
  subscribeMedicalProviderReviews,
  subscribeMedicalTrackerForCase,
} from "@/lib/supabase/repo";
import type { MedicalTrackerAttestation } from "@/lib/medical-attestation";
import { buildReviewProgress, certifiedProviderKeys } from "@/lib/medical-review";
import { MedicalReviewWorkflow } from "@/components/MedicalReviewWorkflow";
import { caseDisplayName } from "@/lib/case-display";
import { needsMedicalReview } from "@/lib/expense-review";
import { buildMedicalProviderSummary } from "@/lib/medical-provider-summary";
import { buildMedicalLedger } from "@/lib/medical-ledger";
import { isMedicalImportConfigured } from "@/lib/medical-import-api";
import type { Case, MedicalExpense, MedicalProviderReview, MedicalTrackerProvider } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ManualMedicalExpenseForm } from "@/components/ManualExpenseForm";
import { MedicalProviderSummary } from "@/components/MedicalProviderSummary";
import { MedicalTracker, type MedicalTrackerHandle } from "@/components/MedicalTracker";
import { MedicalFolderImport } from "@/components/MedicalFolderImport";
import { MedicalInvoicesByProvider } from "@/components/MedicalInvoicesByProvider";
import { CaseFinancialHero } from "@/components/CaseFinancialHero";
import { FinancialSection } from "@/components/FinancialSection";
import { CaseExpensesSection } from "@/components/CaseExpensesSection";
import { ImportExcludedFilesSection } from "@/components/ImportExcludedFilesSection";
import { MedicalTrackerCertification } from "@/components/MedicalTrackerCertification";
import { useHydrated } from "@/hooks/useHydrated";
import { Button, EmptyState, PageWrapper } from "@/components/ui";

export default function MedicalExpensesPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.caseId as string;
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();

  const [caseRecord, setCaseRecord] = useState<Case | null>(null);
  const [expenses, setExpenses] = useState<MedicalExpense[]>([]);
  const [trackedProviders, setTrackedProviders] = useState<MedicalTrackerProvider[]>([]);
  const [providerReviews, setProviderReviews] = useState<MedicalProviderReview[]>([]);
  const [certification, setCertification] = useState<MedicalTrackerAttestation | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [caseReady, setCaseReady] = useState(false);
  const trackerRef = useRef<MedicalTrackerHandle>(null);

  useEffect(() => {
    if (!supabaseReady || loading || !user || !caseId) return;
    setCaseReady(false);
    const supabase = getBrowserSupabase();
    const unsubCase = subscribeCase(supabase, caseId, (c) => {
      setCaseRecord(c);
      setCaseReady(true);
    });
    const unsubExpenses = subscribeMedicalExpensesForCase(supabase, caseId, setExpenses);
    const unsubTracker = subscribeMedicalTrackerForCase(supabase, caseId, setTrackedProviders);
    const unsubReviews = subscribeMedicalProviderReviews(supabase, caseId, setProviderReviews);
    return () => {
      unsubCase();
      unsubExpenses();
      unsubTracker();
      unsubReviews();
    };
  }, [user, loading, supabaseReady, caseId]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  const ledger = useMemo(() => buildMedicalLedger(expenses), [expenses]);
  const counted = ledger.counted;
  const progress = useMemo(
    () => buildReviewProgress(ledger, providerReviews, certifiedProviderKeys(certification, ledger)),
    [ledger, providerReviews, certification]
  );

  const needsReview = useMemo(() => counted.filter(needsMedicalReview).length, [counted]);

  const summary = useMemo(() => buildMedicalProviderSummary(counted), [counted]);

  const lopProviders = useMemo(
    () => trackedProviders.filter((p) => p.hasLop === true).length,
    [trackedProviders]
  );

  if (!hydrated || loading || (user && !caseReady)) {
    return <PageSkeleton label="Loading case financials…" />;
  }

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
              onCertify={() =>
                document.getElementById("certified-pdf")?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
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

          <MedicalReviewWorkflow
            suggestions={ledger.suggestions.length}
            progress={progress}
            certification={certification}
          />

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
                  expenses={counted}
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
            description="Current balance by provider. Duplicates and older statements are left out."
          >
            <MedicalProviderSummary expenses={counted} needsReview={needsReview} />
          </FinancialSection>

          <FinancialSection
            id="invoices"
            level={4}
            title="Invoices"
            description="Each provider's current balance, with every document underneath. Exclude duplicates or older statements instead of deleting them."
            actions={
              <Button size="sm" variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
                {showAddForm ? "Cancel" : "Upload Invoice"}
              </Button>
            }
          >
            {showAddForm && caseRecord?.caseNumber && (
              <div className="mb-6">
                <ManualMedicalExpenseForm
                  caseId={caseId}
                  caseNumber={caseRecord.caseNumber}
                  onClose={() => setShowAddForm(false)}
                />
              </div>
            )}
            {showAddForm && !caseRecord?.caseNumber && (
              <p className="mb-6 text-sm text-danger">This case has no case number — cannot upload yet.</p>
            )}
            <MedicalInvoicesByProvider caseId={caseId} ledger={ledger} progress={progress} />
          </FinancialSection>

          <CaseExpensesSection caseId={caseId} caseNumber={caseRecord?.caseNumber ?? null} />

          {caseRecord && (
            <MedicalTrackerCertification
              caseRecord={caseRecord}
              trackedProviders={trackedProviders}
              expenses={expenses}
              providersNeedingReview={progress.needsReview}
              onCurrentMedicalCertification={setCertification}
            />
          )}

          <ImportExcludedFilesSection caseId={caseId} />
      </div>
    </PageWrapper>
  );
}
