"use client";

import { useMemo, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { saveMedicalTrackerProvider } from "@/lib/supabase/repo";
import { preferredProviderName, providerNamesMatch } from "@/lib/provider-name-match";
import { compareValues, SortHeader, useSortState } from "@/lib/table-sort";
import type { MedicalExpense, MedicalTrackerProvider } from "@/lib/types";
import { Button, Card, CardBody, CardHeader, Input, Select, Spinner } from "@/components/ui";

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
    lopFiles: [],
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
    lopFiles: mergeLopFiles(a.lopFiles, b.lopFiles),
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

function mergeLopFiles(
  a: MedicalTrackerProvider["lopFiles"],
  b: MedicalTrackerProvider["lopFiles"]
): MedicalTrackerProvider["lopFiles"] {
  const files = new Map<string, MedicalTrackerProvider["lopFiles"][number]>();
  for (const file of [...a, ...b]) {
    const key = file.fileId || file.path || file.url;
    if (key) files.set(key, file);
  }
  return [...files.values()];
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
  const [addingName, setAddingName] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const beginAdd = () => {
    setEditingKey("__new__");
    setAddingName("");
    setError(null);
  };

  const cancel = () => {
    setEditingKey(null);
    setAddingName("");
    setError(null);
  };

  const saveProvider = async (
    provider: MedicalTrackerProvider,
    key: string
  ): Promise<boolean> => {
    setSavingKey(key);
    setError(null);
    try {
      await saveMedicalTrackerProvider(getBrowserSupabase(), provider);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save provider");
      return false;
    } finally {
      setSavingKey(null);
    }
  };

  const addProvider = async () => {
    const providerName = addingName.trim();
    if (!providerName) return;
    if (await saveProvider(blankProvider(caseId, caseNumber, providerName), "__new__")) {
      cancel();
    }
  };

  const renderRow = (row: MedicalTrackerProvider, key: string) => {
    const saving = savingKey === key;
    return (
      <tr key={key} className={row.hasLop === true ? "bg-warning-light/25" : "hover:bg-surface-alt/40"}>
        <td className="px-3 py-2">
          <span className="font-medium text-text">{row.providerName}</span>
          {row.lopFiles.length > 0 && (
            <div className="mt-1 flex flex-col items-start gap-0.5">
              {row.lopFiles.map((file, index) => (
                <a
                  key={file.fileId || file.path || `${file.url}-${index}`}
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-64 truncate text-xs text-primary hover:underline"
                  title={file.name}
                >
                  LOP: {file.name}
                </a>
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          <Select
            aria-label={`LOP status for ${row.providerName}`}
            disabled={saving}
            value={row.hasLop == null ? "" : row.hasLop ? "yes" : "no"}
            onChange={(e) => {
              const hasLop = e.target.value === "" ? null : e.target.value === "yes";
              void saveProvider({ ...row, hasLop }, key);
            }}
          >
            <option value="">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </td>
        <DateCell disabled={saving} value={row.treatmentFinishedDate} onChange={(v) => void saveProvider({ ...row, treatmentFinishedDate: v }, key)} />
        <DateCell disabled={saving} value={row.medicalRequestedDate} onChange={(v) => void saveProvider({ ...row, medicalRequestedDate: v }, key)} />
        <DateCell disabled={saving} value={row.medicalReceivedDate} onChange={(v) => void saveProvider({ ...row, medicalReceivedDate: v }, key)} />
        <DateCell disabled={saving} value={row.billingRequestedDate} onChange={(v) => void saveProvider({ ...row, billingRequestedDate: v }, key)} />
        <DateCell disabled={saving} value={row.billingReceivedDate} onChange={(v) => void saveProvider({ ...row, billingReceivedDate: v }, key)} />
        <td className="px-3 py-2">
          {saving && <Spinner className="h-4 w-4" />}
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
            {editingKey === "__new__" && (
              <tr>
                <td className="px-3 py-2">
                  <Input
                    autoFocus
                    value={addingName}
                    placeholder="Provider name"
                    onChange={(e) => setAddingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addProvider();
                      if (e.key === "Escape") cancel();
                    }}
                  />
                </td>
                <td colSpan={6} />
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      disabled={savingKey === "__new__" || !addingName.trim()}
                      onClick={() => void addProvider()}
                    >
                      {savingKey === "__new__" ? <Spinner className="h-4 w-4" /> : "Add"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
                  </div>
                </td>
              </tr>
            )}
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
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
      <Input
        type="date"
        disabled={disabled}
        value={value ?? ""}
        aria-label={value ? `Date ${formatDate(value)}` : "Select date"}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </td>
  );
}
