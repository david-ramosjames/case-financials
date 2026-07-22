"use client";

import { useMemo } from "react";
import {
  buildMedicalProviderSummary,
  formatMedicalMoney,
} from "@/lib/medical-provider-summary";
import type { MedicalExpense } from "@/lib/types";

export function MedicalProviderSummary({
  expenses,
  needsReview,
}: {
  expenses: MedicalExpense[];
  needsReview: number;
}) {
  const { providers, totals } = useMemo(() => buildMedicalProviderSummary(expenses), [expenses]);

  const sorted = useMemo(
    () => [...providers].sort((a, b) => b.outstanding - a.outstanding || a.providerName.localeCompare(b.providerName)),
    [providers]
  );

  return (
    <div>
      {needsReview > 0 && (
        <p className="mb-5 text-[15px] text-warning">
          {needsReview} invoice{needsReview === 1 ? "" : "s"} need review before totals are final.
        </p>
      )}

      {sorted.length === 0 ? (
        <p className="py-10 text-[15px] text-text-muted">
          No medical providers yet — summary appears when invoices are logged.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((row) => (
            <article
              key={row.providerName}
              className="rounded-xl bg-surface-alt/40 px-5 py-5 transition hover:bg-surface-alt/70"
            >
              <h3 className="font-serif text-lg leading-snug tracking-tight text-text">
                {row.providerName}
              </h3>
              <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.12em] text-text-dim">
                Outstanding
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-text">
                {formatMedicalMoney(row.outstanding, false)}
              </p>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-text-muted">
                <span>
                  Charges{" "}
                  <span className="tabular-nums text-text-secondary">
                    {formatMedicalMoney(row.charge, false)}
                  </span>
                </span>
                <span>
                  Paid{" "}
                  <span className="tabular-nums text-text-secondary">
                    {formatMedicalMoney(row.paid, false)}
                  </span>
                </span>
                {row.adjusted > 0 && (
                  <span>
                    Adjusted{" "}
                    <span className="tabular-nums text-text-secondary">
                      {formatMedicalMoney(row.adjusted, false)}
                    </span>
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {sorted.length > 0 && (
        <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-border/60 pt-5 text-[13px] text-text-muted">
          <span>
            Case outstanding{" "}
            <span className="text-base font-semibold tabular-nums text-text">
              {formatMedicalMoney(totals.outstanding, false)}
            </span>
          </span>
          <span>
            Charges{" "}
            <span className="tabular-nums text-text-secondary">
              {formatMedicalMoney(totals.charge, false)}
            </span>
          </span>
          <span>
            Paid{" "}
            <span className="tabular-nums text-text-secondary">
              {formatMedicalMoney(totals.paid, false)}
            </span>
          </span>
          <span>
            Paid & incurred{" "}
            <span className="tabular-nums text-text-secondary">
              {formatMedicalMoney(totals.paidAndIncurred, false)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
