"use client";

import type { MedicalTrackerAttestation } from "@/lib/medical-attestation";
import type { MedicalReviewProgress } from "@/lib/medical-review";
import { Button } from "@/components/ui";

type StepState = "done" | "active" | "waiting";

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Step({
  number,
  title,
  detail,
  state,
  action,
  onAction,
}: {
  number: number;
  title: string;
  detail: string;
  state: StepState;
  action?: string;
  onAction?: () => void;
}) {
  const marker =
    state === "done"
      ? "bg-success text-white"
      : state === "active"
        ? "bg-primary text-white"
        : "bg-surface-alt text-text-dim";
  return (
    <li className="flex min-w-0 flex-1 items-start gap-3">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${marker}`}
        aria-hidden
      >
        {state === "done" ? "✓" : number}
      </span>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${state === "waiting" ? "text-text-muted" : "text-text"}`}>{title}</p>
        <p className="mt-0.5 text-[13px] text-text-muted">{detail}</p>
        {action && onAction && state === "active" && (
          <Button size="sm" variant="secondary" className="mt-2" onClick={onAction}>
            {action}
          </Button>
        )}
      </div>
    </li>
  );
}

export function MedicalReviewWorkflow({
  suggestions,
  progress,
  certification,
}: {
  suggestions: number;
  progress: MedicalReviewProgress;
  certification: MedicalTrackerAttestation | null;
}) {
  const total = progress.reviewable.length;
  if (total === 0) return null;

  const confirmed = progress.reviewed + progress.certified;
  const cleanupDone = suggestions === 0;
  const totalsDone = progress.needsReview === 0;
  const certified = Boolean(certification);

  return (
    <section aria-label="Review progress" className="rounded-2xl border border-border/70 px-6 py-5 lg:px-8">
      <ol className="flex flex-col gap-5 md:flex-row md:gap-8">
        <Step
          number={1}
          title="Clean up AI extraction"
          state={cleanupDone ? "done" : "active"}
          detail={
            cleanupDone
              ? "No suggested duplicates or older balances left."
              : `${suggestions} item${suggestions === 1 ? "" : "s"} flagged as duplicate or superseded.`
          }
          action="Review items"
          onAction={() => scrollTo("invoices")}
        />
        <Step
          number={2}
          title="Confirm provider totals"
          state={totalsDone ? "done" : cleanupDone ? "active" : "waiting"}
          detail={`${confirmed} of ${total} provider${total === 1 ? "" : "s"} confirmed.`}
          action="Confirm providers"
          onAction={() => scrollTo("invoices")}
        />
        <Step
          number={3}
          title="Certify tracker"
          state={certified ? "done" : totalsDone ? "active" : "waiting"}
          detail={
            certification
              ? `Certified PDF v${certification.pdfVersion} is current.`
              : "Generate the certified PDF."
          }
          action="Certify"
          onAction={() => scrollTo("certified-pdf")}
        />
      </ol>
    </section>
  );
}
