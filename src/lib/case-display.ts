import type { Case } from "./types";

export function caseDisplayName(c: Case): string {
  const num = c.caseNumber?.trim() || c.causeNumber?.trim() || "";
  if (num && c.clientName) return `${c.clientName} (${num})`;
  if (c.clientName) return c.clientName;
  return c.name || "Case";
}
