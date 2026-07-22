"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  fetchCaseListRows,
  fetchStaffContacts,
  type CaseListRow,
} from "@/lib/supabase/repo";
import { caseDisplayName } from "@/lib/case-display";
import type { Contact } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import { EmptyState, Input, PageHeader, PageWrapper, Select } from "@/components/ui";

function formatSyncWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function HomePage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const [rows, setRows] = useState<CaseListRow[]>([]);
  const [staff, setStaff] = useState<Contact[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [attorneyId, setAttorneyId] = useState("all");
  const [paralegalId, setParalegalId] = useState("all");

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    void Promise.all([fetchCaseListRows(supabase), fetchStaffContacts(supabase)])
      .then(([list, contacts]) => {
        setRows(list);
        setStaff(contacts);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load cases"));
  }, [user, loading, supabaseReady]);

  const attorneys = useMemo(
    () => staff.filter((c) => c.role === "attorney"),
    [staff]
  );
  const paralegals = useMemo(
    () => staff.filter((c) => c.role === "paralegal"),
    [staff]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (attorneyId !== "all" && row.attorney?.id !== attorneyId) return false;
      if (paralegalId !== "all" && row.paralegal?.id !== paralegalId) return false;
      if (!q) return true;
      const hay = [
        row.case.name,
        row.case.clientName,
        row.case.caseNumber,
        row.case.causeNumber,
        row.attorney?.name,
        row.paralegal?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, attorneyId, paralegalId]);

  if (!hydrated) return <PageSkeleton />;

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <EmptyState
          title="Supabase not configured"
          description="Copy .env.example to .env.local and add your keys."
        />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <PageHeader
        title="Cases"
        subtitle={`${rows.length} active case${rows.length === 1 ? "" : "s"}`}
      />

      {err && <p className="mt-4 text-sm text-danger">{err}</p>}

      <div className="mt-8 space-y-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all cases (title, case #, client…)"
          className="border-0 bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus:ring-1"
        />
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[12rem] flex-1 sm:flex-none">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-dim">
              Attorney
            </label>
            <Select
              className="border-0 bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus:ring-1"
              value={attorneyId}
              onChange={(e) => setAttorneyId(e.target.value)}
            >
              <option value="all">All attorneys</option>
              {attorneys.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[12rem] flex-1 sm:flex-none">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-dim">
              Paralegal
            </label>
            <Select
              className="border-0 bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus:ring-1"
              value={paralegalId}
              onChange={(e) => setParalegalId(e.target.value)}
            >
              <option value="all">All paralegals</option>
              {paralegals.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {filtered.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? "No active cases" : "No matching cases"}
            description={
              rows.length === 0
                ? "Cases are shared from your firm's case database."
                : "Try a different search or clear the attorney/paralegal filters."
            }
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.map((row) => {
              const href = `/cases/${row.case.id}/financials/medical-expenses`;
              const meta: string[] = [];
              if (row.case.caseNumber) meta.push(`Case #${row.case.caseNumber}`);
              if (row.attorney) meta.push(row.attorney.name);
              if (row.paralegal) meta.push(row.paralegal.name);

              return (
                <li key={row.case.id}>
                  <Link
                    href={href}
                    className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 transition hover:bg-surface-alt/60 lg:px-6"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-text">
                        {caseDisplayName(row.case)}
                      </p>
                      <p className="mt-1 truncate text-[13px] text-text-muted">
                        {meta.length ? meta.join(" · ") : row.case.clientName || "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-right text-[13px]">
                      <p className="tabular-nums text-text">
                        <span className="font-medium">{row.lopCount}</span>{" "}
                        <span className="text-text-muted">
                          LOP{row.lopCount === 1 ? "" : "s"}
                        </span>
                      </p>
                      <p className="text-text-dim">
                        {row.lastDropboxSyncAt
                          ? `Synced ${formatSyncWhen(row.lastDropboxSyncAt)}`
                          : "No Dropbox sync yet"}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {filtered.length > 0 && filtered.length !== rows.length && (
        <p className="mt-3 text-[13px] text-text-dim">
          Showing {filtered.length} of {rows.length} cases
        </p>
      )}
    </PageWrapper>
  );
}
