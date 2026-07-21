"use client";

import { useMemo, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { saveMedicalTrackerProvider } from "@/lib/supabase/repo";
import { preferredProviderName, providerNamesMatch } from "@/lib/provider-name-match";
import { compareValues, SortHeader, useSortState } from "@/lib/table-sort";
import type { MedicalExpense, MedicalTrackerProvider } from "@/lib/types";
import { Badge, Button, Card, CardBody, CardHeader, Input, Select, Spinner } from "@/components/ui";

type SortKey =
  | "providerName"
  | "hasLop"
  | "treatmentFinishedDate"
  | "medicalRequestedDate"
  | "medicalReceivedDate"
  | "billingRequestedDate"
  | "billingReceivedDate";

function blankProvider(
  caseId: string,
  caseNumber: string,
  providerName = "",
  providerId: string | null = null
): MedicalTrackerProvider {
  return {
    id: null,
    caseId,
    caseNumber,
    providerId,
    providerName,
    hasLop: null,
    treatmentFinishedDate: null,
    medicalRequestedDate: null,
    medicalReceivedDate: null,
    billingRequestedDate: null,
    billingReceivedDate: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function trackerFilledScore(row: MedicalTrackerProvider): number {
  let score = 0;
  if (row.hasLop === true) score += 3;
  if (row.hasLop === false) score += 1;
  if (row.treatmentFinishedDate) score += 1;
  if (row.medicalRequestedDate) score += 1;
  if (row.medicalReceivedDate) score += 1;
  if (row.billingRequestedDate) score += 1;
  if (row.billingReceivedDate) score += 1;
  if (row.id) score += 2;
  score += Math.min(row.providerName.trim().length, 40) / 40;
  return score;
}

function mergeProviderRows(a: MedicalTrackerProvider, b: MedicalTrackerProvider): MedicalTrackerProvider {
  const preferA = trackerFilledScore(a) >= trackerFilledScore(b);
  const base = preferA ? a : b;
  const other = preferA ? b : a;
  return {
    ...base,
    providerName: preferredProviderName(a.providerName, b.providerName),
    providerId: base.providerId ?? other.providerId,
    hasLop:
      a.hasLop === true || b.hasLop === true
        ? true
        : a.hasLop === false || b.hasLop === false
          ? false
          : null,
    treatmentFinishedDate: base.treatmentFinishedDate ?? other.treatmentFinishedDate,
    medicalRequestedDate: base.medicalRequestedDate ?? other.medicalRequestedDate,
    medicalReceivedDate: base.medicalReceivedDate ?? other.medicalReceivedDate,
    billingRequestedDate: base.billingRequestedDate ?? other.billingRequestedDate,
    billingReceivedDate: base.billingReceivedDate ?? other.billingReceivedDate,
  };
}

function mergeProviders(
  caseId: string,
  caseNumber: string,
  tracked: MedicalTrackerProvider[],
  expenses: MedicalExpense[]
): MedicalTrackerProvider[] {
  const merged: MedicalTrackerProvider[] = [];

  for (const row of tracked) {
    const idx = merged.findIndex((existing) =>
      providerNamesMatch(existing.providerName, row.providerName)
    );
    if (idx >= 0) merged[idx] = mergeProviderRows(merged[idx]!, row);
    else merged.push(row);
  }

  for (const expense of expenses) {
    const name = expense.providerName.trim();
    if (!name) continue;
    const idx = merged.findIndex((existing) => providerNamesMatch(existing.providerName, name));
    if (idx >= 0) {
      const existing = merged[idx]!;
      merged[idx] = {
        ...existing,
        providerName: preferredProviderName(existing.providerName, name),
        providerId: existing.providerId ?? expense.providerId,
      };
      continue;
    }
    merged.push(blankProvider(caseId, caseNumber, name, expense.providerId));
  }

  return merged;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${month}/${day}/${year}` : value;
}

export function MedicalTracker({
  caseId,
  caseNumber,
  trackedProviders,
  expenses,
}: {
  caseId: string;
  caseNumber: string;
  trackedProviders: MedicalTrackerProvider[];
  expenses: MedicalExpense[];
}) {
  const rows = useMemo(
    () => mergeProviders(caseId, caseNumber, trackedProviders, expenses),
    [caseId, caseNumber, trackedProviders, expenses]
  );
  const { sortKey, sortDir, toggleSort } = useSortState<SortKey>("providerName", "asc");
  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDir)),
    [rows, sortKey, sortDir]
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<MedicalTrackerProvider | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beginEdit = (row: MedicalTrackerProvider) => {
    setEditingKey(row.id ?? row.providerName.trim().toLowerCase());
    setDraft({ ...row });
    setError(null);
  };

  const beginAdd = () => {
    setEditingKey("__new__");
    setDraft(blankProvider(caseId, caseNumber));
    setError(null);
  };

  const cancel = () => {
    setEditingKey(null);
    setDraft(null);
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await saveMedicalTrackerProvider(getBrowserSupabase(), draft);
      cancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save provider");
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (row: MedicalTrackerProvider, key: string) => {
    const editing = editingKey === key;
    const value = editing && draft ? draft : row;
    return (
      <tr key={key} className={value.hasLop === true ? "bg-warning-light/25" : "hover:bg-surface-alt/40"}>
        <td className="px-3 py-2">
          {editing ? (
            <Input
              value={value.providerName}
              placeholder="Provider name"
              onChange={(e) => setDraft((d) => d && ({ ...d, providerName: e.target.value }))}
            />
          ) : (
            <span className="font-medium text-text">{value.providerName}</span>
          )}
        </td>
        <td className="px-3 py-2">
          {editing ? (
            <Select
              value={value.hasLop == null ? "" : value.hasLop ? "yes" : "no"}
              onChange={(e) =>
                setDraft((d) =>
                  d && ({ ...d, hasLop: e.target.value === "" ? null : e.target.value === "yes" })
                )
              }
            >
              <option value="">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          ) : value.hasLop === true ? (
            <Badge variant="warning">Yes</Badge>
          ) : value.hasLop === false ? (
            <Badge>No</Badge>
          ) : (
            <Badge variant="warning">Unknown</Badge>
          )}
        </td>
        <DateCell editing={editing} value={value.treatmentFinishedDate} onChange={(v) => setDraft((d) => d && ({ ...d, treatmentFinishedDate: v }))} />
        <DateCell editing={editing} value={value.medicalRequestedDate} onChange={(v) => setDraft((d) => d && ({ ...d, medicalRequestedDate: v }))} />
        <DateCell editing={editing} value={value.medicalReceivedDate} onChange={(v) => setDraft((d) => d && ({ ...d, medicalReceivedDate: v }))} />
        <DateCell editing={editing} value={value.billingRequestedDate} onChange={(v) => setDraft((d) => d && ({ ...d, billingRequestedDate: v }))} />
        <DateCell editing={editing} value={value.billingReceivedDate} onChange={(v) => setDraft((d) => d && ({ ...d, billingReceivedDate: v }))} />
        <td className="px-3 py-2">
          {editing ? (
            <div className="flex gap-1">
              <Button size="sm" disabled={saving || !value.providerName.trim()} onClick={() => void save()}>
                {saving ? <Spinner className="h-4 w-4" /> : "Save"}
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={cancel}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => beginEdit(row)}>Edit</Button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <Card className="mt-6 border-primary/25">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-text">Medical Tracker</h2>
            <p className="mt-1 text-sm text-text-muted">
              Provider status, LOP exposure, treatment completion, and records follow-up.
            </p>
          </div>
          <Button size="sm" onClick={beginAdd}>Add provider</Button>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </CardHeader>
      <CardBody className="overflow-x-auto p-0">
        <table className="w-full min-w-275 text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-primary-light/40 text-xs uppercase text-text-muted">
              <th className="px-3 py-3"><SortHeader label="Provider" field="providerName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
              <th className="px-3 py-3"><SortHeader label="LOP" field="hasLop" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
              <th className="px-3 py-3"><SortHeader label="Treatment Finished" field="treatmentFinishedDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
              <th className="px-3 py-3"><SortHeader label="Medical Requested" field="medicalRequestedDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
              <th className="px-3 py-3"><SortHeader label="Medical Received" field="medicalReceivedDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
              <th className="px-3 py-3"><SortHeader label="Billing Requested" field="billingRequestedDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
              <th className="px-3 py-3"><SortHeader label="Billing Received" field="billingReceivedDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {editingKey === "__new__" && draft && renderRow(draft, "__new__")}
            {sorted.map((row) => renderRow(row, row.id ?? row.providerName.trim().toLowerCase()))}
            {!sorted.length && editingKey !== "__new__" && (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-text-muted">
                  No providers yet. Add one now or file a medical invoice to populate the list.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

function DateCell({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
      {editing ? (
        <Input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
      ) : (
        formatDate(value)
      )}
    </td>
  );
}
