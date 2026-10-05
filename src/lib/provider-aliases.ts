import { providerGroupKey } from "@/lib/medical-provider-summary";

export interface ProviderAlias {
  aliasKey: string;
  aliasName: string;
  canonicalName: string;
}

export interface LearnedProviderAlias extends ProviderAlias {
  sourceCaseId: string | null;
  createdBy: string | null;
  createdAt: string;
}

export function providerAliasKey(name: string): string {
  return providerGroupKey(name.trim() || "Unknown provider");
}

const MAX_ALIAS_HOPS = 5;

/**
 * Resolve a provider spelling through case merges first, then merges learned on other cases.
 * Follows chains (A → B → C) and stops on cycles.
 */
export function createAliasResolver(caseAliases: ProviderAlias[], learnedAliases: ProviderAlias[] = []) {
  const caseByKey = new Map(caseAliases.map((a) => [a.aliasKey, a.canonicalName]));
  const learnedByKey = new Map(learnedAliases.map((a) => [a.aliasKey, a.canonicalName]));
  return (name: string): { name: string; learned: boolean } => {
    let current = name;
    let learned = false;
    const seen = new Set<string>();
    for (let hop = 0; hop < MAX_ALIAS_HOPS; hop++) {
      const key = providerAliasKey(current);
      if (seen.has(key)) break;
      seen.add(key);
      const fromCase = caseByKey.get(key);
      const next = fromCase ?? learnedByKey.get(key);
      if (!next || providerAliasKey(next) === key) break;
      if (!fromCase) learned = true;
      current = next;
    }
    return { name: current, learned };
  };
}

/** Rename rows whose provider spelling was merged into another provider. */
export function applyProviderAliases<T extends { providerName: string }>(
  rows: T[],
  caseAliases: ProviderAlias[],
  learnedAliases: ProviderAlias[] = []
): T[] {
  if (!caseAliases.length && !learnedAliases.length) return rows;
  const resolve = createAliasResolver(caseAliases, learnedAliases);
  return rows.map((row) => {
    const { name } = resolve(row.providerName);
    return name !== row.providerName ? { ...row, providerName: name } : row;
  });
}

/** Record id → original spelling, for rows grouped by a merge learned on another case. */
export function learnedAliasRenames<T extends { id: string; providerName: string }>(
  rows: T[],
  caseAliases: ProviderAlias[],
  learnedAliases: ProviderAlias[]
): Map<string, string> {
  const out = new Map<string, string>();
  if (!learnedAliases.length) return out;
  const resolve = createAliasResolver(caseAliases, learnedAliases);
  for (const row of rows) {
    const { name, learned } = resolve(row.providerName);
    if (learned && name !== row.providerName) out.set(row.id, row.providerName);
  }
  return out;
}
