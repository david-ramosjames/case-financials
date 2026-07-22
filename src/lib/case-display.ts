import type { Case } from "./types";

export function caseDisplayName(c: Case): string {
  const num = c.caseNumber?.trim() || c.causeNumber?.trim() || "";
  if (num && c.clientName) return `${c.clientName} (${num})`;
  if (c.clientName) return c.clientName;
  return c.name || "Case";
}

/** Keys to match `case_slack_channels.case_number` (exact, digits-only, no leading zeros). */
export function caseNumberLookupKeys(
  caseRecord: Pick<Case, "caseNumber" | "causeNumber">
): string[] {
  const keys = new Set<string>();
  for (const raw of [caseRecord.caseNumber, caseRecord.causeNumber]) {
    const t = raw?.trim();
    if (!t) continue;
    keys.add(t);
    const digits = t.replace(/\D/g, "");
    if (digits) {
      keys.add(digits);
      const n = Number.parseInt(digits, 10);
      if (Number.isFinite(n)) keys.add(String(n));
    }
  }
  return [...keys];
}

export function formatIncidentDate(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const [year, month, day] = iso.trim().slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${month}/${day}/${year}`;
}
