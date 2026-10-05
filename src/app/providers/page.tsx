"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  deleteLearnedProviderAlias,
  fetchMedicalProviderNameIndex,
  saveLearnedProviderMerge,
  subscribeLearnedProviderAliases,
  type ProviderNameRecord,
} from "@/lib/supabase/repo";
import { createAliasResolver, providerAliasKey, type LearnedProviderAlias } from "@/lib/provider-aliases";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import { compareValues, SortHeader, useSortState } from "@/lib/table-sort";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, PageHeader, PageWrapper, Select } from "@/components/ui";

type SortKey = "name" | "spellings" | "cases" | "documents";

interface Spelling {
  name: string;
  documents: number;
  cases: Map<string, { caseId: string | null; caseNumber: string }>;
  /** Learned alias that groups this spelling here (removable), if any. */
  aliasKey: string | null;
}

interface ProviderGroup {
  key: string;
  name: string;
  spellings: Spelling[];
  caseCount: number;
  documents: number;
}

function buildGroups(records: ProviderNameRecord[], learned: LearnedProviderAlias[]): ProviderGroup[] {
  const resolve = createAliasResolver([], learned);
  const learnedKeys = new Set(learned.map((a) => a.aliasKey));
  const groups = new Map<string, { names: Map<string, number>; spellings: Map<string, Spelling> }>();

  const spellingFor = (groupKey: string, resolvedName: string, raw: string) => {
    let g = groups.get(groupKey);
    if (!g) {
      g = { names: new Map(), spellings: new Map() };
      groups.set(groupKey, g);
    }
    g.names.set(resolvedName, (g.names.get(resolvedName) ?? 0) + 1);
    let s = g.spellings.get(raw);
    if (!s) {
      const rawKey = providerAliasKey(raw);
      s = {
        name: raw,
        documents: 0,
        cases: new Map(),
        aliasKey: rawKey !== groupKey && learnedKeys.has(rawKey) ? rawKey : null,
      };
      g.spellings.set(raw, s);
    }
    return s;
  };

  for (const r of records) {
    if (r.excluded) continue;
    const resolved = resolve(r.providerName).name;
    const s = spellingFor(providerAliasKey(resolved), resolved, r.providerName);
    s.documents += 1;
    s.cases.set(r.caseId ?? r.caseNumber, { caseId: r.caseId, caseNumber: r.caseNumber });
  }
  for (const a of learned) {
    const resolved = resolve(a.aliasName).name;
    const key = providerAliasKey(resolved);
    if (key === a.aliasKey) continue;
    const g = groups.get(key);
    if (g && !g.spellings.has(a.aliasName)) spellingFor(key, resolved, a.aliasName);
  }

  return [...groups.entries()].map(([key, g]) => {
    const canonical = learned.find((a) => providerAliasKey(a.canonicalName) === key)?.canonicalName;
    const name = canonical ?? [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const spellings = [...g.spellings.values()].sort((a, b) => b.documents - a.documents);
    const caseIds = new Set(spellings.flatMap((s) => [...s.cases.keys()]));
    return {
      key,
      name,
      spellings,
      caseCount: caseIds.size,
      documents: spellings.reduce((n, s) => n + s.documents, 0),
    };
  });
}

function sortValue(g: ProviderGroup, key: SortKey): unknown {
  switch (key) {
    case "name":
      return g.name;
    case "spellings":
      return g.spellings.length;
    case "cases":
      return g.caseCount;
    case "documents":
      return g.documents;
  }
}

export default function ProvidersPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const [records, setRecords] = useState<ProviderNameRecord[] | null>(null);
  const [learned, setLearned] = useState<LearnedProviderAlias[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetKey, setTargetKey] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { sortKey, sortDir, toggleSort } = useSortState<SortKey>("name", "asc");

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  const loadRecords = useCallback(async () => {
    try {
      setRecords(await fetchMedicalProviderNameIndex(getBrowserSupabase()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load providers");
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    void loadRecords();
    return subscribeLearnedProviderAliases(getBrowserSupabase(), setLearned);
  }, [user, loading, supabaseReady, loadRecords]);

  const groups = useMemo(() => (records ? buildGroups(records, learned) : []), [records, learned]);
  const byKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? groups.filter((g) => g.spellings.some((s) => s.name.toLowerCase().includes(q)) || g.name.toLowerCase().includes(q))
      : groups;
    return [...filtered].sort((a, b) => compareValues(sortValue(a, sortKey), sortValue(b, sortKey), sortDir));
  }, [groups, search, sortKey, sortDir]);

  const selectedGroups = useMemo(
    () => [...selected].map((k) => byKey.get(k)).filter((g): g is ProviderGroup => Boolean(g)),
    [selected, byKey]
  );

  useEffect(() => {
    if (selectedGroups.length && !selectedGroups.some((g) => g.key === targetKey)) {
      setTargetKey([...selectedGroups].sort((a, b) => b.documents - a.documents)[0].key);
    }
  }, [selectedGroups, targetKey]);

  const run = async (fn: () => Promise<void>, failMessage: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : failMessage);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const mergeSelected = () => {
    const target = byKey.get(targetKey);
    if (!target || selectedGroups.length < 2) return;
    const sources = selectedGroups.filter((g) => g.key !== target.key);
    const ok = window.confirm(
      `Group ${sources.map((g) => `"${g.name}"`).join(", ")} under "${target.name}" on every case?\n\n` +
        "Documents keep their original names, so you can split them back out here at any time. " +
        "Affected providers go back to Needs Review on their cases."
    );
    if (!ok) return;
    void run(async () => {
      await saveLearnedProviderMerge(getBrowserSupabase(), {
        targetName: target.name,
        sourceNames: sources.flatMap((g) => [g.name, ...g.spellings.map((s) => s.name)]),
        createdBy: user?.email ?? null,
      });
      setSelected(new Set());
    }, "Could not merge providers");
  };

  const splitOut = (group: ProviderGroup, spelling: Spelling) => {
    if (!spelling.aliasKey) return;
    if (!window.confirm(`Split "${spelling.name}" out of "${group.name}" on every case?`)) return;
    void run(() => deleteLearnedProviderAlias(getBrowserSupabase(), spelling.aliasKey!), "Could not split provider");
  };

  if (!hydrated || loading || (user && records === null)) {
    return <PageSkeleton label="Loading providers…" />;
  }

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <EmptyState title="Supabase not configured" description="Providers requires database access." />
      </PageWrapper>
    );
  }

  const mergedCount = groups.filter((g) => g.spellings.some((s) => s.aliasKey)).length;

  return (
    <PageWrapper>
      <PageHeader
        title="Providers"
        subtitle="Every medical provider across all cases. Merge spellings of the same provider, or split them back out."
      />

      {err && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger-light px-4 py-3 text-sm text-danger">{err}</div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Card className="min-w-[8rem]">
          <CardBody className="py-3">
            <p className="text-xs uppercase text-text-muted">Providers</p>
            <p className="text-lg font-semibold text-text">{groups.length}</p>
          </CardBody>
        </Card>
        <Card className="min-w-[8rem]">
          <CardBody className="py-3">
            <p className="text-xs uppercase text-text-muted">With merges</p>
            <p className="text-lg font-semibold text-text">{mergedCount}</p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-text-muted">Search</label>
              <Input placeholder="Provider name or spelling…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {selectedGroups.length >= 2 ? (
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">
                    Merge {selectedGroups.length} selected into
                  </label>
                  <Select className="min-w-[16rem]" value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
                    {selectedGroups.map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button disabled={busy} onClick={mergeSelected}>
                  Merge
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            ) : (
              <p className="pb-2 text-[13px] text-text-dim">
                {selectedGroups.length === 1 ? "Select one more provider to merge." : "Tick two or more providers to merge them."}
              </p>
            )}
          </div>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12">
              <EmptyState title="No providers found" description="Providers appear once medical documents are imported." />
            </div>
          ) : (
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-alt/60 text-xs uppercase text-text-muted">
                  <th className="w-10 px-3 py-3" />
                  <th className="px-3 py-3"><SortHeader label="Provider" field="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></th>
                  <th className="px-3 py-3 text-right"><SortHeader label="Spellings" field="spellings" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                  <th className="px-3 py-3 text-right"><SortHeader label="Cases" field="cases" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                  <th className="px-3 py-3 text-right"><SortHeader label="Documents" field="documents" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((g) => {
                  const open = expanded.has(g.key);
                  const isSelected = selected.has(g.key);
                  const merged = g.spellings.filter((s) => s.aliasKey);
                  return (
                    <Fragment key={g.key}>
                      <tr className={isSelected ? "bg-accent/5" : "hover:bg-surface-alt/40"}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${g.name}`}
                            checked={isSelected}
                            onChange={() => setSelected((s) => toggle(s, g.key))}
                            className="h-4 w-4 accent-[#D3368A]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => setExpanded((s) => toggle(s, g.key))}
                            aria-expanded={open}
                          >
                            <span className="mr-2 text-text-dim" aria-hidden>
                              {open ? "▾" : "▸"}
                            </span>
                            <span className="font-medium text-text">{g.name}</span>
                          </button>
                          {merged.length > 0 && (
                            <Badge variant="primary" className="ml-2">
                              {merged.length} merged
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{g.spellings.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{g.caseCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{g.documents}</td>
                      </tr>
                      {open && (
                        <tr className="bg-surface-alt/30">
                          <td />
                          <td colSpan={4} className="px-3 pb-3 pt-1">
                            <table className="w-full text-[13px]">
                              <thead>
                                <tr className="text-[11px] uppercase tracking-[0.06em] text-text-dim">
                                  <th className="py-1 pr-3 text-left font-medium">Spelling</th>
                                  <th className="py-1 pr-3 text-right font-medium">Documents</th>
                                  <th className="py-1 pr-3 text-left font-medium">Cases</th>
                                  <th className="py-1 text-right font-medium" />
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/40">
                                {g.spellings.map((s) => (
                                  <tr key={s.name}>
                                    <td className="py-1.5 pr-3 text-text">
                                      {s.name}
                                      {s.aliasKey && <span className="ml-2 text-[12px] text-accent">merged</span>}
                                    </td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums">{s.documents}</td>
                                    <td className="py-1.5 pr-3">
                                      {s.cases.size === 0 ? (
                                        <span className="text-text-dim">None yet</span>
                                      ) : (
                                        <span className="flex flex-wrap gap-x-2">
                                          {[...s.cases.values()].map((c) =>
                                            c.caseId ? (
                                              <Link
                                                key={c.caseId}
                                                href={`/cases/${c.caseId}/financials/medical-expenses`}
                                                className="text-accent hover:underline"
                                              >
                                                #{c.caseNumber}
                                              </Link>
                                            ) : (
                                              <span key={c.caseNumber} className="text-text-muted">
                                                #{c.caseNumber}
                                              </span>
                                            )
                                          )}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1.5 text-right">
                                      {s.aliasKey && (
                                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => splitOut(g, s)}>
                                          Split out
                                        </Button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <p className="mt-4 text-xs text-text-dim">
        Merges made here group names on screen and in certified PDFs; documents keep their original names. Documents
        renamed with &quot;Merge into…&quot; on a case page stay under their new name.
      </p>
    </PageWrapper>
  );
}
