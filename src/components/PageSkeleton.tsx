export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10 lg:px-8" aria-busy="true">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-border/60" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-border/40" />
      <div className="mt-10 h-64 animate-pulse rounded-2xl bg-border/30" />
    </div>
  );
}
