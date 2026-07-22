"use client";

import { useEffect, useState, type ReactNode } from "react";
import { caseDisplayName, formatIncidentDate } from "@/lib/case-display";
import { formatMedicalMoney } from "@/lib/medical-provider-summary";
import { slackChannelLabel, slackChannelUrl } from "@/lib/slack-channel";
import {
  fetchContactsByIds,
  fetchSlackChannelForCase,
} from "@/lib/supabase/repo";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import type { Case, CaseSlackChannel, Contact } from "@/lib/types";
import { Button } from "@/components/ui";

const ROLE_LABELS: Record<Contact["role"], string> = {
  attorney: "Attorney",
  paralegal: "Paralegal",
  legal_assistant: "Legal assistant",
  other: "Contact",
};

export function CaseFinancialHero({
  caseRecord,
  outstanding,
  total,
  paid,
  providerCount,
  needsReview,
  lopProviders,
  onImport,
  onAddProvider,
  importConfigured,
}: {
  caseRecord: Case;
  outstanding: number;
  total: number;
  paid: number;
  providerCount: number;
  needsReview: number;
  lopProviders: number;
  onImport?: () => void;
  onAddProvider?: () => void;
  importConfigured?: boolean;
}) {
  const [slackChannel, setSlackChannel] = useState<CaseSlackChannel | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    let cancelled = false;
    const supabase = getBrowserSupabase();
    void fetchSlackChannelForCase(supabase, caseRecord)
      .then((channel) => {
        if (!cancelled) setSlackChannel(channel);
      })
      .catch(() => {
        if (!cancelled) setSlackChannel(null);
      });
    void fetchContactsByIds(supabase, caseRecord.assignedContactIds)
      .then((list) => {
        if (!cancelled) setContacts(list);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [
    caseRecord.id,
    caseRecord.caseNumber,
    caseRecord.causeNumber,
    caseRecord.assignedContactIds.join(","),
  ]);

  const dol = formatIncidentDate(caseRecord.dateOfIncident);
  const meta: string[] = [];
  if (caseRecord.caseNumber) meta.push(`Case #${caseRecord.caseNumber}`);
  if (dol) meta.push(`DOL ${dol}`);

  return (
    <div className="rounded-2xl bg-surface px-6 py-7 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.07)] lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-[2rem] leading-none tracking-tight text-text lg:text-[2.25rem]">
              {caseDisplayName(caseRecord)}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                caseRecord.status === "active"
                  ? "bg-success-light text-success"
                  : "bg-warning-light text-warning"
              }`}
            >
              {caseRecord.status === "active" ? "Active" : "Archived"}
            </span>
          </div>
          <p className="mt-2 text-[15px] text-text-muted">
            {meta.length ? meta.join(" · ") : "Case financials"}
            {slackChannel?.slackChannelId && (
              <>
                {" · "}
                <a
                  href={slackChannelUrl(slackChannel.slackChannelId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  Slack {slackChannelLabel(slackChannel.slackChannelName, slackChannel.slackChannelId)}
                </a>
              </>
            )}
          </p>
          {contacts.length > 0 && (
            <p className="mt-2 text-[13px] text-text-dim">
              {contacts.map((c) => `${c.name} (${ROLE_LABELS[c.role]})`).join(" · ")}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {importConfigured && onImport && (
            <Button variant="secondary" onClick={onImport}>
              Import Dropbox
            </Button>
          )}
          {onAddProvider && (
            <Button onClick={onAddProvider}>Add Provider</Button>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-border/70 pt-6 sm:grid-cols-3 lg:grid-cols-6">
        <HeroStat label="Outstanding" value={formatMedicalMoney(outstanding, false)} emphasize />
        <HeroStat label="Total" value={formatMedicalMoney(total, false)} emphasize />
        <HeroStat label="Paid" value={formatMedicalMoney(paid, false)} emphasize />
        <HeroStat
          label="Needs Review"
          value={String(needsReview)}
          emphasize={needsReview > 0}
          warn={needsReview > 0}
        />
        <HeroStat label="Providers" value={String(providerCount)} />
        <HeroStat label="LOP Providers" value={String(lopProviders)} />
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  emphasize,
  warn,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-dim">{label}</p>
      <p
        className={`mt-1.5 tabular-nums tracking-tight ${
          emphasize
            ? warn
              ? "text-2xl font-semibold text-warning"
              : "text-2xl font-semibold text-text"
            : "text-xl font-medium text-text"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function StatusDot({
  kind,
  children,
}: {
  kind: "action" | "success" | "neutral" | "muted";
  children: ReactNode;
}) {
  const styles = {
    action: "bg-warning-light text-warning ring-1 ring-warning/25",
    success: "bg-success-light text-success",
    neutral: "bg-surface-alt text-text-secondary",
    muted: "bg-transparent text-text-dim",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[kind]}`}
    >
      {kind === "action" && (
        <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
      )}
      {kind === "success" && (
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
      )}
      {children}
    </span>
  );
}
