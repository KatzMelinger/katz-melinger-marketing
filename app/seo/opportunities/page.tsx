"use client";

/**
 * SEO Opportunity Radar — the system, not a list.
 *
 * Reads the persistent seo_opportunities table (populated by
 * /api/seo/opportunities/sync). The default view shows only actionable rows:
 * junk/branded/navigational keywords are filtered out (Show excluded reveals
 * them), keywords KM already has a page for are hidden as refresh candidates
 * (Show covered), and keywords already acted on drop out (Show handled).
 *
 * Each row is classified into a KM content type (Practice Page / Blog / Case
 * Result) and practice area. Acting on a row writes back to the table, so it
 * persists across reloads and re-syncs — the module has memory.
 *
 * The per-row "Create Brief" KM wizard + generation land in Phase C.
 */

import { Fragment, useCallback, useEffect, useState } from "react";

import { ContentNav } from "@/components/content-nav";
import { KmBriefWizard } from "@/components/km-brief-wizard";
import { formatNumber, SeoShell } from "@/components/seo-shell";

type Opportunity = {
  id: string;
  keyword: string;
  source: string;
  listName: string | null;
  competitor: string | null;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  practiceArea: string | null;
  pillarId: string | null;
  recommendedContentType: string | null;
  relevanceScore: number;
  excluded: boolean;
  excludeReason: string | null;
  flags: string[];
  existingUrl: string | null;
  status: string;
  coverage: { badge: "published" | "draft"; label: string; status: string | null; href: string | null } | null;
  clusterId: string | null;
  clusterRole: string | null;
  clusterType: string | null;
  clusterPrimaryKeyword: string | null;
};

type KeywordExclusion = { id: string; term: string; reason: string | null };

type Payload = {
  opportunities: Opportunity[];
  counts: { total: number; actionable: number; excluded: number; covered: number; handled: number };
  lastSyncedAt: string | null;
  error?: string;
};

const SOURCE_LABEL: Record<string, string> = {
  quickwin: "Quick win",
  missing: "Missing target",
  longtail: "Long-tail",
  imported: "Imported",
  manual: "Manual (research)",
};

const TYPE_LABEL: Record<string, string> = {
  practice_page: "Practice Page",
  blog_post: "Blog",
  case_result: "Case Result",
};

const TYPE_TONE: Record<string, string> = {
  practice_page: "bg-blue-50 text-blue-700",
  blog_post: "bg-emerald-50 text-emerald-700",
  case_result: "bg-amber-50 text-amber-700",
};

const PRACTICE_LABEL: Record<string, string> = {
  employment: "Employment",
  collections: "Collections",
};

function relevanceTone(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

export default function SeoOpportunitiesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showCovered, setShowCovered] = useState(false);
  const [showHandled, setShowHandled] = useState(false);
  const [wizardOpp, setWizardOpp] = useState<Opportunity | null>(null);
  const [wizardSecondary, setWizardSecondary] = useState<string[]>([]);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [clustering, setClustering] = useState(false);
  const [clusterMsg, setClusterMsg] = useState<string | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [listFilter, setListFilter] = useState<string>("all");
  const [practiceFilter, setPracticeFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState<number | "all">(20);
  const [page, setPage] = useState(1);
  const [exclusionsOpen, setExclusionsOpen] = useState(false);
  const [exclusions, setExclusions] = useState<KeywordExclusion[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const include = [
      showExcluded ? "excluded" : null,
      showCovered ? "covered" : null,
      showHandled ? "handled" : null,
    ].filter(Boolean);
    const query = include.length ? `?include=${include.join(",")}` : "";
    try {
      const res = await fetch(`/api/seo/opportunities${query}`, { cache: "no-store" });
      const json = (await res.json()) as Payload;
      if (!res.ok) throw new Error(json?.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [showExcluded, showCovered, showHandled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const loadExclusions = useCallback(async () => {
    try {
      const res = await fetch("/api/seo/keyword-exclusions", { cache: "no-store" });
      const json = await res.json();
      setExclusions(json.exclusions ?? []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    loadExclusions();
  }, [loadExclusions]);

  // Any filter or page-size change resets to the first page.
  useEffect(() => {
    setPage(1);
  }, [listFilter, practiceFilter, pageSize, showExcluded, showCovered, showHandled]);

  // Add a custom exclusion term. The API also flips matching existing rows to
  // excluded, so we refetch the list to reflect them leaving the actionable view.
  const addExclusion = async (term: string, reason?: string) => {
    const res = await fetch("/api/seo/keyword-exclusions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term, reason }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Could not add term");
    setExclusions(json.exclusions ?? []);
    await fetchData();
    return json.excludedCount as number;
  };

  const removeExclusion = async (term: string) => {
    const res = await fetch(
      `/api/seo/keyword-exclusions?term=${encodeURIComponent(term)}`,
      { method: "DELETE" },
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Could not remove term");
    setExclusions(json.exclusions ?? []);
    await fetchData();
    return json.restoredCount as number;
  };

  const refresh = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/opportunities/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Sync failed");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const groupIntoClusters = async () => {
    setClustering(true);
    setClusterMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/seo/opportunities/cluster", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Clustering failed");
      setClusterMsg(json.message ?? "Clustered.");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clustering failed");
    } finally {
      setClustering(false);
    }
  };

  const openClusterBrief = (primary: Opportunity, members: Opportunity[]) => {
    setWizardSecondary(members.map((m) => m.keyword));
    setWizardOpp(primary);
  };

  const toggleCluster = (id: string) =>
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setStatus = async (id: string, status: string) => {
    setData((prev) =>
      prev
        ? { ...prev, opportunities: prev.opportunities.filter((o) => o.id !== id) }
        : prev,
    );
    try {
      await fetch(`/api/seo/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      fetchData();
    }
  };

  const counts = data?.counts;
  const allRows = data?.opportunities ?? [];
  const listNames = Array.from(
    new Set(allRows.map((o) => o.listName).filter((n): n is string => !!n)),
  ).sort();
  const practiceAreas = Array.from(
    new Set(allRows.map((o) => o.practiceArea).filter((p): p is string => !!p)),
  ).sort();

  const filteredRows = allRows
    .filter((o) => (listFilter === "all" ? true : o.listName === listFilter))
    .filter((o) => (practiceFilter === "all" ? true : o.practiceArea === practiceFilter));

  // Fold clustered keywords into one "unit" per cluster (primary + members), so
  // related keywords show as a single expandable row instead of competing rows.
  // Unclustered keywords are their own single-member unit. Units keep the
  // first-appearance order of the underlying (relevance-sorted) rows.
  const units: { primary: Opportunity; members: Opportunity[] }[] = [];
  const clusterIndex = new Map<string, number>();
  for (const o of filteredRows) {
    if (o.clusterId) {
      let idx = clusterIndex.get(o.clusterId);
      if (idx === undefined) {
        idx = units.length;
        clusterIndex.set(o.clusterId, idx);
        units.push({ primary: o, members: [] });
      }
      const unit = units[idx];
      if (o.clusterRole === "primary") {
        // Promote: keep the existing display-primary as a member if it wasn't.
        if (unit.primary.id !== o.id) unit.members.push(unit.primary);
        unit.primary = o;
      } else if (o.id !== unit.primary.id) {
        unit.members.push(o);
      }
    } else {
      units.push({ primary: o, members: [] });
    }
  }

  // Page-size + pager operate on units. "all" shows everything.
  const total = units.length;
  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = pageSize === "all" ? 0 : (safePage - 1) * pageSize;
  const pageUnits =
    pageSize === "all" ? units : units.slice(start, start + pageSize);

  return (
    <SeoShell
      title="SEO Opportunity Radar"
      subtitle="Filtered, scored, and classified keyword opportunities — junk and branded terms removed, already-covered terms hidden, and handled keywords stay gone."
    >
      {/* Content Studio tab bar — Opportunities is a tab of the studio. */}
      <ContentNav />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Actionable" value={counts?.actionable ?? 0} tone="emerald" />
        <KpiTile label="Filtered out" value={counts?.excluded ?? 0} tone="slate" />
        <KpiTile label="Already covered" value={counts?.covered ?? 0} tone="slate" />
        <KpiTile label="Handled" value={counts?.handled ?? 0} tone="slate" />
      </section>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {clusterMsg && (
        <div className="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-sm text-violet-700">
          {clusterMsg}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#e2e8f0] bg-slate-50 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} />
            <span className="text-slate-700">Show excluded (junk / branded)</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showCovered} onChange={(e) => setShowCovered(e.target.checked)} />
            <span className="text-slate-700">Show already covered</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} />
            <span className="text-slate-700">Show handled</span>
          </label>
          <button
            onClick={() => setExclusionsOpen((o) => !o)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium ${
              exclusionsOpen
                ? "border-brand text-brand bg-brand/5"
                : "border-slate-300 text-slate-700 hover:border-brand hover:text-brand"
            }`}
          >
            Manage exclusions
            {exclusions.length > 0 && (
              <span className="rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-700">
                {exclusions.length}
              </span>
            )}
          </button>
          {listNames.length > 0 && (
            <label className="inline-flex items-center gap-2">
              <span className="text-slate-500">List:</span>
              <select
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
              >
                <option value="all">All lists</option>
                {listNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
          {practiceAreas.length > 0 && (
            <label className="inline-flex items-center gap-2">
              <span className="text-slate-500">Practice area:</span>
              <select
                value={practiceFilter}
                onChange={(e) => setPracticeFilter(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
              >
                <option value="all">All practice areas</option>
                {practiceAreas.map((p) => (
                  <option key={p} value={p}>{PRACTICE_LABEL[p] ?? p}</option>
                ))}
              </select>
            </label>
          )}
          <label className="inline-flex items-center gap-2">
            <span className="text-slate-500">Show:</span>
            <select
              value={String(pageSize)}
              onChange={(e) =>
                setPageSize(e.target.value === "all" ? "all" : Number(e.target.value))
              }
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
            >
              <option value="20">20</option>
              <option value="40">40</option>
              <option value="100">100</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-500">
            {data?.lastSyncedAt
              ? `Synced ${new Date(data.lastSyncedAt).toLocaleString()}`
              : "Never synced"}
          </span>
          <button
            onClick={() => setScratchOpen(true)}
            className="rounded-md border border-brand px-3 py-1.5 font-medium text-brand hover:bg-brand/5"
          >
            New brief from scratch
          </button>
          <button
            onClick={groupIntoClusters}
            disabled={clustering}
            title="Group related keywords into clusters so you build one page (or one pillar + supporting set) instead of competing pages."
            className="rounded-md border border-violet-400 px-3 py-1.5 font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
          >
            {clustering ? "Grouping…" : "Group into clusters"}
          </button>
          <button
            onClick={refresh}
            disabled={syncing}
            className="rounded-md bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {syncing ? "Refreshing…" : "Refresh opportunities"}
          </button>
        </div>
      </div>

      {exclusionsOpen && (
        <ExclusionsPanel
          exclusions={exclusions}
          onAdd={addExclusion}
          onRemove={removeExclusion}
        />
      )}

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-xs text-slate-500">
              <tr>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium w-32">Relevance</th>
                <th className="pb-2 pr-3 font-medium">Volume</th>
                <th className="pb-2 pr-3 font-medium">Suggested type</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    Loading opportunities…
                  </td>
                </tr>
              )}
              {!loading && pageUnits.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No opportunities match. Adjust the filters above, or click{" "}
                    <b>Refresh opportunities</b> to pull and filter the latest keyword gaps.
                  </td>
                </tr>
              )}
              {pageUnits.map(({ primary, members }) => {
                const hasCluster = members.length > 0;
                const expanded = primary.clusterId
                  ? expandedClusters.has(primary.clusterId)
                  : false;
                return (
                  <Fragment key={primary.clusterId ?? primary.id}>
                    <OppRow
                      o={primary}
                      cluster={
                        hasCluster
                          ? {
                              type: primary.clusterType,
                              memberCount: members.length,
                              expanded,
                              onToggle: () =>
                                primary.clusterId && toggleCluster(primary.clusterId),
                            }
                          : null
                      }
                      onCreateBrief={() =>
                        hasCluster
                          ? openClusterBrief(primary, members)
                          : setWizardOpp(primary)
                      }
                      onSetStatus={setStatus}
                    />
                    {hasCluster &&
                      expanded &&
                      members.map((m) => (
                        <OppMemberRow key={m.id} o={m} onSetStatus={setStatus} />
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {!loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            Showing {start + 1}–
            {Math.min(start + (pageSize === "all" ? total : pageSize), total)} of {total}
          </span>
          {pageSize !== "all" && pageCount > 1 && (
            <div className="flex items-center gap-2">
              <button
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-slate-300 px-2 py-1 hover:border-brand disabled:opacity-40"
              >
                ← Prev
              </button>
              <span>
                Page {safePage} / {pageCount}
              </span>
              <button
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                className="rounded border border-slate-300 px-2 py-1 hover:border-brand disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {(wizardOpp || scratchOpen) && (
        <KmBriefWizard
          opportunity={wizardOpp ?? undefined}
          initialSecondaryKeywords={wizardOpp ? wizardSecondary : undefined}
          onClose={() => {
            setWizardOpp(null);
            setWizardSecondary([]);
            setScratchOpen(false);
          }}
          onGenerated={() => {
            fetchData();
          }}
        />
      )}

    </SeoShell>
  );
}

type ClusterMeta = {
  type: string | null;
  memberCount: number;
  expanded: boolean;
  onToggle: () => void;
};

/** One opportunity row. When `cluster` is set, it's the cluster's primary and
 *  shows a PILLAR/STANDALONE badge + an expand toggle for its related keywords. */
function OppRow({
  o,
  cluster,
  onCreateBrief,
  onSetStatus,
}: {
  o: Opportunity;
  cluster: ClusterMeta | null;
  onCreateBrief: () => void;
  onSetStatus: (id: string, status: string) => void;
}) {
  const isPillar = cluster?.type === "pillar";
  return (
    <tr
      className={`border-b border-[#e2e8f0]/60 last:border-0 hover:bg-slate-50 ${
        o.excluded ? "opacity-60" : ""
      }`}
    >
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          {cluster && (
            <button
              onClick={cluster.onToggle}
              aria-label={cluster.expanded ? "Collapse cluster" : "Expand cluster"}
              className="text-slate-400 hover:text-slate-700 text-xs w-4"
            >
              {cluster.expanded ? "▾" : "▸"}
            </button>
          )}
          <span className="text-slate-900">{o.keyword}</span>
          {cluster && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                isPillar ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"
              }`}
              title={
                isPillar
                  ? "Pillar — build a pillar page plus a supporting content cluster"
                  : "Standalone — one page covers this whole cluster"
              }
            >
              {isPillar ? "PILLAR" : "STANDALONE"}
            </span>
          )}
          {cluster && (
            <button
              onClick={cluster.onToggle}
              className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
            >
              +{cluster.memberCount} related
            </button>
          )}
          {o.listName && (
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
              {o.listName}
            </span>
          )}
          {o.excluded && o.excludeReason && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
              {o.excludeReason}
            </span>
          )}
          {o.existingUrl && (
            <a
              href={o.existingUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:underline"
              title={o.existingUrl}
            >
              Covered ↗
            </a>
          )}
          {o.coverage && (
            <a
              href={o.coverage.href ?? "/content-production"}
              target={o.coverage.badge === "published" ? "_blank" : undefined}
              rel="noreferrer"
              title={`${o.coverage.label || "Existing content"} — view existing`}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium hover:underline ${
                o.coverage.badge === "published"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-blue-50 text-blue-700"
              }`}
            >
              {o.coverage.badge === "published" ? "Published ↗" : "Draft exists ↗"}
            </a>
          )}
        </div>
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full ${relevanceTone(o.relevanceScore)}`}
              style={{ width: `${o.relevanceScore}%` }}
            />
          </div>
          <span className="tabular-nums text-xs text-slate-600">{o.relevanceScore}</span>
        </div>
      </td>
      <td className="py-2 pr-3 tabular-nums text-slate-700">
        {o.searchVolume != null ? formatNumber(o.searchVolume) : "—"}
      </td>
      <td className="py-2 pr-3">
        {o.recommendedContentType && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              TYPE_TONE[o.recommendedContentType] ?? "bg-slate-100 text-slate-600"
            }`}
          >
            {TYPE_LABEL[o.recommendedContentType] ?? o.recommendedContentType}
          </span>
        )}
        {o.practiceArea && (
          <span className="ml-1.5 text-[10px] text-slate-400">
            {PRACTICE_LABEL[o.practiceArea] ?? o.practiceArea}
          </span>
        )}
        <span className="ml-1.5 text-[10px] text-slate-300">
          · {SOURCE_LABEL[o.source] ?? o.source}
        </span>
      </td>
      <td className="py-2 pr-3">
        <StatusChip status={o.status} />
      </td>
      <td className="py-2 text-right whitespace-nowrap">
        {o.status === "dismissed" ? (
          <button
            onClick={() => onSetStatus(o.id, "new")}
            className="text-xs px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            ↺ Restore
          </button>
        ) : (
          <div className="inline-flex items-center gap-1.5">
            {!o.excluded && (
              <button
                onClick={onCreateBrief}
                title={
                  cluster
                    ? "Create one brief for this cluster — related keywords pre-load as secondary keywords"
                    : undefined
                }
                className="text-xs px-2.5 py-1 rounded bg-brand text-white font-medium hover:bg-brand/90"
              >
                {cluster ? "Create Cluster Brief" : "Create Brief"}
              </button>
            )}
            <button
              onClick={() => onSetStatus(o.id, "dismissed")}
              className="text-xs px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:border-red-300 hover:text-red-600"
            >
              ✕ Dismiss
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

/** A clustered member keyword, shown indented under its primary when expanded.
 *  Members fold into the primary's brief, so they have no Create Brief of their
 *  own — just a Dismiss to drop a keyword from the cluster. */
function OppMemberRow({
  o,
  onSetStatus,
}: {
  o: Opportunity;
  onSetStatus: (id: string, status: string) => void;
}) {
  return (
    <tr className="border-b border-[#e2e8f0]/40 last:border-0 bg-slate-50/40">
      <td className="py-1.5 pr-3">
        <div className="flex items-center gap-2 pl-6">
          <span className="text-slate-400">↳</span>
          <span className="text-slate-600">{o.keyword}</span>
        </div>
      </td>
      <td className="py-1.5 pr-3">
        <span className="tabular-nums text-xs text-slate-400">{o.relevanceScore}</span>
      </td>
      <td className="py-1.5 pr-3 tabular-nums text-slate-500">
        {o.searchVolume != null ? formatNumber(o.searchVolume) : "—"}
      </td>
      <td className="py-1.5 pr-3 text-[10px] text-slate-400">
        {o.recommendedContentType
          ? TYPE_LABEL[o.recommendedContentType] ?? o.recommendedContentType
          : ""}
      </td>
      <td className="py-1.5 pr-3 text-[10px] text-slate-400">in cluster</td>
      <td className="py-1.5 text-right whitespace-nowrap">
        <button
          onClick={() => onSetStatus(o.id, "dismissed")}
          className="text-[11px] px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-600"
        >
          ✕ Drop
        </button>
      </td>
    </tr>
  );
}

function ExclusionsPanel({
  exclusions,
  onAdd,
  onRemove,
}: {
  exclusions: KeywordExclusion[];
  onAdd: (term: string, reason?: string) => Promise<number>;
  onRemove: (term: string) => Promise<number>;
}) {
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const add = async () => {
    const t = term.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const n = await onAdd(t);
      setTerm("");
      setMessage(
        `Added “${t.toLowerCase()}”${n > 0 ? ` — ${n} keyword${n === 1 ? "" : "s"} hidden` : ""}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add term");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const n = await onRemove(t);
      setMessage(
        `Removed “${t}”${n > 0 ? ` — ${n} keyword${n === 1 ? "" : "s"} restored` : ""}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove term");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#e2e8f0] bg-white p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Exclusion list</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Any keyword that contains one of these terms is hidden from the Radar.
            Adding a term also hides matching keywords already on the list; removing it brings them back.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {exclusions.length === 0 ? (
          <span className="text-xs text-slate-400 italic">
            No custom terms yet. Add one below.
          </span>
        ) : (
          exclusions.map((ex) => (
            <span
              key={ex.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
              title={ex.reason ?? undefined}
            >
              {ex.term}
              <button
                onClick={() => remove(ex.term)}
                disabled={busy}
                aria-label={`Remove ${ex.term}`}
                className="text-slate-400 hover:text-red-600 disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="e.g. unemployment, workers comp, osha"
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
        />
        <button
          onClick={add}
          disabled={busy || !term.trim()}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          Add term
        </button>
        {message && <span className="text-xs text-emerald-700">{message}</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>

      <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
        Always filtered automatically (built-in): the firm’s own brand, competitor brands,
        login / portal / account queries, and unemployment / 1099 / tax terms.
      </p>
    </section>
  );
}

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "slate";
}) {
  return (
    <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tabular-nums ${
          tone === "emerald" ? "text-emerald-600" : "text-slate-900"
        }`}
      >
        {formatNumber(value)}
      </p>
    </article>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    new: { label: "New", cls: "bg-blue-50 text-blue-700" },
    brief: { label: "Brief", cls: "bg-violet-50 text-violet-700" },
    in_production: { label: "In production", cls: "bg-amber-50 text-amber-700" },
    published: { label: "Published", cls: "bg-emerald-50 text-emerald-700" },
    dismissed: { label: "Dismissed", cls: "bg-slate-100 text-slate-500" },
  };
  const s = map[status] ?? map.new;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
  );
}
