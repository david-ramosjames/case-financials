"use client";

import { useCallback, useState } from "react";

export type SortDir = "asc" | "desc";

export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const mult = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * mult;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }) * mult;
}

export function useSortState<T extends string>(defaultKey: T, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<T>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggleSort = useCallback((key: T) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  return { sortKey, sortDir, toggleSort, setSortKey, setSortDir };
}

export function SortHeader<T extends string>({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
  className = "",
  align = "left",
}: {
  label: string;
  field: T;
  sortKey: T;
  sortDir: SortDir;
  onSort: (field: T) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const active = sortKey === field;
  return (
    <button
      type="button"
      className={`inline-flex w-full items-center gap-1 font-medium text-text-secondary hover:text-text ${
        align === "right" ? "justify-end" : "justify-start"
      } ${className}`}
      onClick={() => onSort(field)}
    >
      {label}
      <span className={`text-xs ${active ? "text-text" : "text-transparent"}`}>{sortDir === "asc" ? "↑" : "↓"}</span>
    </button>
  );
}
