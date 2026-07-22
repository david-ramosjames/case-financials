"use client";

import { useEffect, useState } from "react";
import { caseDisplayName, formatIncidentDate } from "@/lib/case-display";
import { slackChannelLabel, slackChannelUrl } from "@/lib/slack-channel";
import {
  fetchContactsByIds,
  fetchSlackChannelForCase,
} from "@/lib/supabase/repo";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import type { Case, CaseSlackChannel, Contact } from "@/lib/types";
import { Badge, Card, CardBody } from "@/components/ui";

const ROLE_LABELS: Record<Contact["role"], string> = {
  attorney: "Attorney",
  paralegal: "Paralegal",
  legal_assistant: "Legal assistant",
  other: "Contact",
};

export function CaseSummaryCard({ caseRecord }: { caseRecord: Case }) {
  const [slackChannel, setSlackChannel] = useState<CaseSlackChannel | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    let cancelled = false;
    const supabase = getBrowserSupabase();
    const contactIds = caseRecord.assignedContactIds;

    void fetchSlackChannelForCase(supabase, caseRecord)
      .then((channel) => {
        if (!cancelled) setSlackChannel(channel);
      })
      .catch(() => {
        if (!cancelled) setSlackChannel(null);
      });

    void fetchContactsByIds(supabase, contactIds)
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

  return (
    <Card className="mt-4 border-primary/20">
      <CardBody className="py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight text-text">
              {caseDisplayName(caseRecord)}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
              {dol && <span>DOL {dol}</span>}
              {dol && slackChannel && <span className="text-border-strong">·</span>}
              {slackChannel?.slackChannelId && (
                <a
                  href={slackChannelUrl(slackChannel.slackChannelId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  Slack {slackChannelLabel(slackChannel.slackChannelName, slackChannel.slackChannelId)}
                </a>
              )}
              {(dol || slackChannel) && <span className="text-border-strong">·</span>}
              {caseRecord.status === "active" ? (
                <Badge variant="success">active</Badge>
              ) : (
                <Badge variant="warning">archived</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Assigned contacts</p>
          {contacts.length === 0 ? (
            <p className="mt-2 text-sm text-text-dim">No assigned contacts on this case.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="rounded-lg border border-border bg-surface-alt/50 px-3 py-1.5 text-sm"
                >
                  <span className="font-medium text-text">{contact.name}</span>
                  <span className="ml-2 text-text-muted">{ROLE_LABELS[contact.role]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
