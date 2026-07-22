"use client";

import { useMemo } from "react";
import {
  buildMedicalProviderSummary,
  formatMedicalMoney,
  type ProviderRollup,
} from "@/lib/medical-provider-summary";
import type { MedicalExpense } from "@/lib/types";
import { compareValues, SortHeader, useSortState } from "@/lib/table-sort";
import { Card, CardBody, CardHeader } from "@/components/ui";

type ProviderSortKey = keyof Pick<ProviderRollup, "providerName" | "charge" | "paid" | "adjusted" | "outstanding">;

export function MedicalProviderSummary({
  expenses,
  needsReview,
}: {
  expenses: MedicalExpense[];
  needsReview: number;
}) {
  const { providers, totals } = useMemo(() => buildMedicalProviderSummary(expenses), [expenses]);
  const { sortKey, sortDir, toggleSort } = useSortState<ProviderSortKey>("providerName", "asc");

  const sorted = useMemo(
    () => [...providers].sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDir)),
    [providers, sortKey, sortDir]
  );

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text">Medical summary by provider</h2>
            <p className="mt-1 text-sm text-text-muted">
              Rolled up from all medical invoices on this case.
              {needsReview > 0 && (
                <span className="ml-2 text-warning">{needsReview} invoice{needsReview === 1 ? "" : "s"} need review</span>
              )}
            </p>
          </div>
          <SummaryTotalsBox totals={totals} />
        </div>
      </CardHeader>
      <CardBody className="overflow-hidden p-0">
        {sorted.length === 0 ? (
          <p className="px-6 py-8 text-sm text-text-muted">No medical providers yet — summary appears when invoices are logged.</p>
        ) : (
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-alt/60 text-xs uppercase text-text-muted">
                <th className="px-4 py-3"><SortHeader label="Provider" field="providerName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                <th className="px-4 py-3 text-right"><SortHeader label="Charge" field="charge" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                <th className="px-4 py-3 text-right"><SortHeader label="Paid" field="paid" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                <th className="px-4 py-3 text-right"><SortHeader label="Adjusted" field="adjusted" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                <th className="px-4 py-3 text-right"><SortHeader label="Outstanding" field="outstanding" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((row, index) => (
                <tr key={row.providerName} className="hover:bg-surface-alt/40">
                  <td className="px-4 py-2.5 font-medium text-text">
                    <span className="mr-2 text-text-dim tabular-nums">{index + 1}.</span>
                    {row.providerName}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMedicalMoney(row.charge)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMedicalMoney(row.paid)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMedicalMoney(row.adjusted)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMedicalMoney(row.outstanding)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-surface-alt/50 font-semibold">
                <td className="px-4 py-3 text-text">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMedicalMoney(totals.charge)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMedicalMoney(totals.paid)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMedicalMoney(totals.adjusted)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMedicalMoney(totals.outstanding)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

function SummaryTotalsBox({
  totals,
}: {
  totals: ReturnType<typeof buildMedicalProviderSummary>["totals"];
}) {
  const rows: [string, number, boolean?][] = [
    ["Paid & incurred", totals.paidAndIncurred, true],
    ["Charges", totals.charge],
    ["Paid", totals.paid],
    ["Adjusted", totals.adjusted],
    ["Outstanding", totals.outstanding],
  ];

  return (
    <div className="min-w-[11rem] rounded-xl border border-border bg-surface-alt/40 px-4 py-3 text-sm">
      {rows.map(([label, value, highlight]) => (
        <div
          key={label}
          className={`flex items-baseline justify-between gap-6 py-0.5 ${highlight ? "mb-1 border-b border-border pb-2" : ""}`}
        >
          <span className={highlight ? "font-semibold text-primary" : "text-text-muted"}>{label}</span>
          <span className={`tabular-nums ${highlight ? "text-lg font-bold text-primary" : "font-medium text-text"}`}>
            {formatMedicalMoney(value, false)}
          </span>
        </div>
      ))}
    </div>
  );
}
