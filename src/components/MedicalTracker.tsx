"use client";

import { useImperativeHandle, useMemo, useState, forwardRef } from "react";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  deleteMedicalTrackerProvider,
  saveMedicalTrackerProvider,
} from "@/lib/supabase/repo";
import { preferredProviderName, providerNamesMatch } from "@/lib/provider-name-match";
import { compareValues, SortHeader, useSortState } from "@/lib/table-sort";
import type { MedicalExpense, MedicalTrackerProvider } from "@/lib/types";
import { Button, Input, Select, Spinner } from "@/components/ui";

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

export type MedicalTrackerHandle = {
  beginAdd: () => void;
};

export const MedicalTracker = forwardRef<
  MedicalTrackerHandle,
  {
    caseId: string;
    caseNumber: string;
    trackedProviders: MedicalTrackerProvider[];
    expenses: MedicalExpense[];
    hideChrome?: boolean;
  }
>(function MedicalTracker(
  { caseId, caseNumber, trackedProviders, expenses, hideChrome = false },
  ref
) {
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

  useImperativeHandle(ref, () => ({ beginAdd }), []);

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

  const deleteProvider = async (row: MedicalTrackerProvider, key: string) => {
    if (!row.id) {
      setError("This provider only exists from invoices — delete those invoice rows instead.");
      return;
    }
    if (!window.confirm(`Delete tracker row for ${row.providerName}?`)) return;
    setSavingKey(key);
    setError(null);
    try {
      await deleteMedicalTrackerProvider(getBrowserSupabase(), row.id);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete provider");
      setSavingKey(null);
    }
  };

  const renderRow = (row: MedicalTrackerProvider, key: string) => {
    const saving = savingKey === key;
    return (
      <tr
        key={key}
        className={row.hasLop === true ? "bg-primary-light/30" : "hover:bg-surface-alt/50"}
      >
        <td className="min-w-0 px-5 py-4 align-middle lg:px-6">
          <div className="truncate text-[15px] font-medium text-text" title={row.providerName}>
            {row.providerName}
          </div>
          {row.lopFiles.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {row.lopFiles.map((file, index) => (
                <a
                  key={file.fileId || file.path || `${file.url}-${index}`}
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[12px] leading-tight text-primary hover:underline"
                  title={file.name}
                >
                  {file.name}
                </a>
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-4 align-middle">
          <Select
            aria-label={`LOP status for ${row.providerName}`}
            className="border-0 bg-surface-alt/80 px-2 py-1.5 text-xs shadow-none focus:ring-1"
            disabled={saving}
            value={row.hasLop == null ? "" : row.hasLop ? "yes" : "no"}
            onChange={(e) => {
              const hasLop = e.target.value === "" ? null : e.target.value === "yes";
              void saveProvider({ ...row, hasLop }, key);
            }}
          >
            <option value="">?</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </td>
        <DateCell
          label="Treatment finished"
          disabled={saving}
          value={row.treatmentFinishedDate}
          onChange={(v) => void saveProvider({ ...row, treatmentFinishedDate: v }, key)}
        />
        <DateCell
          label="Medical requested"
          disabled={saving}
          value={row.medicalRequestedDate}
          onChange={(v) => void saveProvider({ ...row, medicalRequestedDate: v }, key)}
        />
        <DateCell
          label="Medical received"
          disabled={saving}
          value={row.medicalReceivedDate}
          onChange={(v) => void saveProvider({ ...row, medicalReceivedDate: v }, key)}
        />
        <DateCell
          label="Billing requested"
          disabled={saving}
          value={row.billingRequestedDate}
          onChange={(v) => void saveProvider({ ...row, billingRequestedDate: v }, key)}
        />
        <DateCell
          label="Billing received"
          disabled={saving}
          value={row.billingReceivedDate}
          onChange={(v) => void saveProvider({ ...row, billingReceivedDate: v }, key)}
        />
        <td className="px-4 py-4 align-middle">
          <div className="flex items-center justify-end gap-1">
            {saving && <Spinner className="h-3.5 w-3.5" />}
            {row.id && (
              <Button
                size="sm"
                variant="ghost"
                className="px-2 text-text-dim hover:text-danger"
                disabled={saving}
                onClick={() => void deleteProvider(row, key)}
              >
                Delete
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const table = (
    <div className="overflow-hidden rounded-xl">
      {error && <p className="border-b border-danger/20 bg-danger-light px-6 py-3 text-sm text-danger">{error}</p>}
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[8%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead>
          <tr className="bg-primary-light/70 text-[12px] font-medium uppercase tracking-[0.06em] text-navy-light">
            <th className="px-5 py-3.5 lg:px-6">
              <SortHeader label="Provider" field="providerName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </th>
            <th className="px-3 py-3.5">
              <SortHeader label="LOP" field="hasLop" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </th>
            <th className="px-3 py-3.5" title="Treatment Finished">
              <SortHeader label="Tx Fin" field="treatmentFinishedDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </th>
            <th className="px-3 py-3.5" title="Medical Requested">
              <SortHeader label="Med Req" field="medicalRequestedDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </th>
            <th className="px-3 py-3.5" title="Medical Received">
              <SortHeader label="Med Rcv" field="medicalReceivedDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </th>
            <th className="px-3 py-3.5" title="Billing Requested">
              <SortHeader label="Bill Req" field="billingRequestedDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </th>
            <th className="px-3 py-3.5" title="Billing Received">
              <SortHeader label="Bill Rcv" field="billingReceivedDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            </th>
            <th className="px-4 py-3.5 text-right"> </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {editingKey === "__new__" && (
            <tr className="bg-primary-light/20">
              <td className="px-5 py-4 lg:px-6" colSpan={7}>
                <Input
                  autoFocus
                  value={addingName}
                  placeholder="Provider name"
                  className="border-0 bg-white shadow-sm"
                  onChange={(e) => setAddingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addProvider();
                    if (e.key === "Escape") cancel();
                  }}
                />
              </td>
              <td className="px-4 py-4">
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    disabled={savingKey === "__new__" || !addingName.trim()}
                    onClick={() => void addProvider()}
                  >
                    {savingKey === "__new__" ? <Spinner className="h-4 w-4" /> : "Add"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancel}>
                    Cancel
                  </Button>
                </div>
              </td>
            </tr>
          )}
          {sorted.map((row) => renderRow(row, row.id ?? row.providerName.trim().toLowerCase()))}
          {!sorted.length && editingKey !== "__new__" && (
            <tr>
              <td colSpan={8} className="px-6 py-14 text-center text-[15px] text-text-muted">
                No providers yet. Add one or import Dropbox files to populate the tracker.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  if (hideChrome) return table;

  return table;
});

function DateCell({
  label,
  disabled,
  value,
  onChange,
}: {
  label: string;
  disabled: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <td className="min-w-0 px-3 py-4 align-middle">
      <Input
        type="date"
        className="min-w-0 border-0 bg-surface-alt/80 px-2 py-1.5 text-xs shadow-none focus:ring-1"
        disabled={disabled}
        value={value ?? ""}
        aria-label={value ? `${label}: ${formatDate(value)}` : label}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </td>
  );
}
