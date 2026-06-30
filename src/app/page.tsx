"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { fetchCases } from "@/lib/supabase/repo";
import { caseDisplayName } from "@/lib/case-display";
import type { Case } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import { Card, CardBody, EmptyState, PageHeader, PageWrapper } from "@/components/ui";

export default function HomePage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const [cases, setCases] = useState<Case[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    void fetchCases(supabase)
      .then(setCases)
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load cases"));
  }, [user, loading, supabaseReady]);

  if (!hydrated) return <PageSkeleton />;

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <EmptyState title="Supabase not configured" description="Copy .env.example to .env.local and add your keys." />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <PageHeader
        title="Case Financials"
        subtitle="Select a case to review medical expenses and other financial records."
      />

      {err && <p className="mt-4 text-sm text-danger">{err}</p>}

      <div className="mt-8 grid gap-3">
        {cases.length === 0 ? (
          <EmptyState title="No active cases" description="Cases are shared from your firm's case database." />
        ) : (
          cases.map((c) => (
            <Card key={c.id}>
              <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium text-text">{caseDisplayName(c)}</p>
                  {c.caseNumber && <p className="text-sm text-text-muted">Case #{c.caseNumber}</p>}
                </div>
                <Link
                  href={`/cases/${c.id}/financials/medical-expenses`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Medical Expenses →
                </Link>
              </CardBody>
            </Card>
          ))
        )}
      </div>
    </PageWrapper>
  );
}
