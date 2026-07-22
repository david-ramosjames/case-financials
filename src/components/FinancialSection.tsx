import type { ReactNode } from "react";

const levelShell: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "rounded-2xl bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)]",
  2: "rounded-2xl border border-primary/15 bg-surface shadow-sm",
  3: "rounded-xl bg-surface",
  4: "rounded-xl bg-surface",
  5: "rounded-xl bg-transparent",
};

const titleSize: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "font-serif text-[1.75rem] leading-tight tracking-tight text-text lg:text-[2rem]",
  2: "font-serif text-[1.25rem] leading-snug tracking-tight text-text lg:text-[1.375rem]",
  3: "font-serif text-lg tracking-tight text-text",
  4: "font-serif text-lg tracking-tight text-text",
  5: "font-serif text-base tracking-tight text-text-secondary",
};

/**
 * Workflow section shell — spacing + typography hierarchy for the case financials page.
 */
export function FinancialSection({
  id,
  level = 3,
  title,
  description,
  actions,
  children,
  className = "",
  bare = false,
}: {
  id?: string;
  level?: 1 | 2 | 3 | 4 | 5;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Skip the card shell — header + children only (for nested content). */
  bare?: boolean;
}) {
  const header =
    title || description || actions ? (
      <div className={`flex flex-wrap items-start justify-between gap-4 ${bare || level === 5 ? "mb-6" : "border-b border-border/60 px-6 py-5 lg:px-8"}`}>
        <div className="min-w-0 max-w-2xl">
          {title && <h2 className={titleSize[level]}>{title}</h2>}
          {description && <p className="mt-1.5 text-[15px] leading-relaxed text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    ) : null;

  if (bare) {
    return (
      <section id={id} className={`scroll-mt-8 ${className}`}>
        {header}
        {children}
      </section>
    );
  }

  return (
    <section id={id} className={`scroll-mt-8 ${className}`}>
      <div className={levelShell[level]}>
        {header}
        <div className={level === 5 ? "" : "px-6 py-5 lg:px-8 lg:py-6"}>{children}</div>
      </div>
    </section>
  );
}

export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4 py-2" aria-hidden>
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">{label}</span>
      <div className="h-px flex-1 bg-border/80" />
    </div>
  );
}
