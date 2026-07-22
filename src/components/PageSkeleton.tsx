import { Spinner } from "@/components/ui";

export function PageSkeleton({
  label = "Loading…",
}: {
  label?: string;
}) {
  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10 lg:px-10" aria-busy="true" aria-live="polite">
      <div className="mb-8 flex items-center gap-3 text-sm text-text-muted">
        <Spinner className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className="h-9 w-56 animate-pulse rounded-lg bg-border/60" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-border/40" />
      <div className="mt-8 h-12 animate-pulse rounded-xl bg-border/40" />
      <div className="mt-4 flex gap-3">
        <div className="h-10 w-40 animate-pulse rounded-lg bg-border/30" />
        <div className="h-10 w-40 animate-pulse rounded-lg bg-border/30" />
        <div className="h-10 w-40 animate-pulse rounded-lg bg-border/30" />
      </div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4 last:border-b-0"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/3 max-w-sm animate-pulse rounded bg-border/50" />
              <div className="h-3 w-1/2 max-w-xs animate-pulse rounded bg-border/30" />
            </div>
            <div className="space-y-2">
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-border/40" />
              <div className="ml-auto h-3 w-28 animate-pulse rounded bg-border/30" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
