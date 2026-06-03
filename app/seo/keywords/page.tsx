"use client";

/**
 * SEO keyword tracker — extended detail.
 *
 * Adds previous position + position delta (movement arrow), CPC, traffic
 * value, competition, URL the keyword ranks for, plus column sorting and
 * a search filter. Data comes from /api/seo/keywords backed by Semrush
 * domain_organic.
 */

import { useEffect, useMemo, useState } from "react";

import { ContentActionsRow, useContentActions } from "@/components/content-actions";
import { RecentSearchesStrip } from "@/components/recent-searches-strip";
import { SeoShell, formatNumber } from "@/components/seo-shell";
import {
  classifyKeywordGeo,
  passesGeoFilter,
  REGION_FILTER_OPTIONS,
  STATE_FILTER_OPTIONS,
  type RegionFilter,
  type StateFilter,
} from "@/lib/keyword-geo";
import { recordSearch } from "@/lib/recent-searches";

type KeywordRow = {
  keyword: string;
  position: number;
  previousPosition: number;
  positionDelta: number;
  searchVolume: number;
  keywordDifficulty: number;
  trendScore: number;
  estimatedTraffic: number;
  cpc: number;
  trafficCost: number;
  competition: number;
  url: string;
};

type KeywordResponse = {
  tracked?: Array<KeywordRow & { isTargetKeyword?: boolean }>;
  missingTargets?: string[];
  trendingKeywords?: Array<{ keyword: string; searchVolume: number; trendScore: number }>;
  longTailSuggestions?: Array<{ keyword: string; searchVolume: number }>;
  competitors?: string[];
  competitive?: Array<{
    keyword: string;
    competitorPosition: number;
    ourPosition: number;
    opportunityScore: number;
    domain: string;
    competitorsBeatingUs?: number;
  }>;
};

type SortKey =
  | "keyword"
  | "position"
  | "positionDelta"
  | "searchVolume"
  | "keywordDifficulty"
  | "estimatedTraffic"
  | "cpc"
  | "trafficCost";

// Geo classification + filter logic now lives in lib/keyword-geo so the
// /seo/keywords/competitive page can share it.

export default function SeoKeywordsPage() {
  const [data, setData] = useState<KeywordResponse | null>(null);
  const [competitive, setCompetitive] = useState<KeywordResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Debounced recent-search log. Records once the user pauses typing for 1.2s
  // and the query is at least 3 chars — avoids logging every keystroke.
  useEffect(() => {
    if (search.trim().length < 3) return;
    const t = setTimeout(() => recordSearch("keywords", search), 1200);
    return () => clearTimeout(t);
  }, [search]);

  const [sortKey, setSortKey] = useState<SortKey>("estimatedTraffic");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showRanking, setShowRanking] = useState<"all" | "top10" | "top50" | "missing">("all");
  // Default hides out-of-state keywords since the firm is NY/NJ-only.
  const [stateFilter, setStateFilter] = useState<StateFilter>("ny_nj_and_generic");
  const [regionFilter, setRegionFilter] = useState<RegionFilter>("all");

  // Tracker pagination: 20 per page, with "show more" (grow the page) or
  // page-by-page nav. `manageOpen` collapses the "Manage target keywords" card.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [manageOpen, setManageOpen] = useState(false);

  // Target keyword management — persisted in Supabase via
  // /api/seo/keywords/targets. The tracker table below shows one row per
  // target, populated with Semrush position/volume/KD data.
  const [targets, setTargets] = useState<string[]>([]);
  const [newTarget, setNewTarget] = useState("");
  const [targetBusy, setTargetBusy] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushResult, setPushResult] = useState<string | null>(null);

  // Tracked-competitor management — persisted in Supabase via
  // /api/seo/competitors. `suggested` is the Semrush auto-detected list
  // (directories already filtered out server-side) for one-click add.
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [suggestedCompetitors, setSuggestedCompetitors] = useState<string[]>([]);
  const [newCompetitor, setNewCompetitor] = useState("");
  const [competitorBusy, setCompetitorBusy] = useState<string | null>(null);
  const [competitorError, setCompetitorError] = useState<string | null>(null);

  // Ideas + Create flow lives in a shared hook — modal/toast/menu state +
  // the actual fetches are all in components/content-actions.tsx so the
  // /seo/opportunities, /aeo, and /ai-search pages share the same UX.
  const contentActions = useContentActions();

  const loadData = () => {
    setLoading(true);
    return Promise.all([
      fetch("/api/seo/keywords", { cache: "no-store" }).then((r) => r.json()),
      // "all" → merged gap across every curated competitor, not one hardcoded firm.
      fetch("/api/seo/keywords?competitor=all", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/seo/tracked-keywords", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/seo/competitors", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([d, c, t, comp]) => {
        setData(d);
        setCompetitive(c);
        // Unified source of truth: seo_keywords (same list the KM Agent reads).
        // GET /api/seo/tracked-keywords returns an array of row objects.
        setTargets(
          Array.isArray(t)
            ? t.map((row: { keyword?: string }) => row.keyword ?? "").filter(Boolean)
            : [],
        );
        setCompetitors(Array.isArray(comp?.trackedDomains) ? comp.trackedDomains : []);
        const suggestions: Array<{ domain: string; tracked?: boolean }> = Array.isArray(
          comp?.suggestedFromSemrush,
        )
          ? comp.suggestedFromSemrush
          : [];
        setSuggestedCompetitors(
          suggestions.filter((s) => !s.tracked).map((s) => s.domain).slice(0, 8),
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const addTarget = async (keyword: string) => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    setTargetBusy(trimmed);
    setTargetError(null);
    try {
      const res = await fetch("/api/seo/tracked-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        setTargetError(json?.error ?? "Failed to add");
        return;
      }
      setNewTarget("");
      await loadData();
    } finally {
      setTargetBusy(null);
    }
  };

  const removeTarget = async (keyword: string) => {
    if (!confirm(`Stop tracking "${keyword}"?`)) return;
    setTargetBusy(keyword);
    setTargetError(null);
    try {
      const res = await fetch(
        `/api/seo/tracked-keywords?keyword=${encodeURIComponent(keyword)}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok) {
        setTargetError(json?.error ?? "Failed to remove");
        return;
      }
      await loadData();
    } finally {
      setTargetBusy(null);
    }
  };

  // One-time bulk push of every tracked keyword into the Semrush Position
  // Tracking campaign. Spends ~100 API units/keyword, so we confirm first.
  const pushToSemrush = async () => {
    if (
      !confirm(
        `Push all ${targets.length} tracked keywords into your Semrush Position Tracking campaign?\n\nThis spends ~100 Semrush API units per keyword (about ${(
          targets.length * 100
        ).toLocaleString()} total). Run this once.`,
      )
    )
      return;
    setPushBusy(true);
    setPushResult(null);
    try {
      const res = await fetch("/api/seo/tracked-keywords/push-to-semrush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPushResult(`❌ ${json?.error ?? "Push failed"}`);
        return;
      }
      setPushResult(
        `✓ Pushed ${json.pushed ?? 0} of ${json.attempted ?? 0} keywords (${(
          json.unitsSpent ?? 0
        ).toLocaleString()} API units).`,
      );
    } catch (e) {
      setPushResult(`❌ ${e instanceof Error ? e.message : "Push failed"}`);
    } finally {
      setPushBusy(false);
    }
  };

  const addCompetitor = async (domain: string, source: "manual" | "suggested" = "manual") => {
    const trimmed = domain.trim();
    if (!trimmed) return;
    setCompetitorBusy(trimmed);
    setCompetitorError(null);
    try {
      const res = await fetch("/api/seo/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: trimmed, source }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCompetitorError(json?.error ?? "Failed to add");
        return;
      }
      setNewCompetitor("");
      await loadData();
    } finally {
      setCompetitorBusy(null);
    }
  };

  const removeCompetitor = async (domain: string) => {
    if (!confirm(`Stop tracking competitor "${domain}"?`)) return;
    setCompetitorBusy(domain);
    setCompetitorError(null);
    try {
      const res = await fetch(
        `/api/seo/competitors?domain=${encodeURIComponent(domain)}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok) {
        setCompetitorError(json?.error ?? "Failed to remove");
        return;
      }
      await loadData();
    } finally {
      setCompetitorBusy(null);
    }
  };

  // Shared action row for the Trends + Long-tail suggestion cards: "+ Track"
  // (adds to Supabase target keywords, reflecting already-tracked state) plus
  // the same Ideas / Fan-out / Create content flow the tracker rows use.
  const renderSuggestionActions = (keyword: string, originSource: string) => {
    const isTracked = targets.includes(keyword.toLowerCase());
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => addTarget(keyword)}
          disabled={isTracked || targetBusy === keyword.trim()}
          className={`text-xs px-2 py-1 rounded border disabled:opacity-60 ${
            isTracked
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-[#185FA5] text-[#185FA5] hover:bg-[#185FA5]/5"
          }`}
          title={isTracked ? "Already a tracked target keyword" : "Add to tracked target keywords"}
        >
          {isTracked ? "Tracked ✓" : targetBusy === keyword.trim() ? "…" : "+ Track"}
        </button>
        <ContentActionsRow
          keyword={keyword}
          actions={contentActions}
          originSource={originSource}
          originContext={{ source_keyword: keyword }}
        />
      </div>
    );
  };

  const sorted = useMemo(() => {
    const rows = (data?.tracked ?? []).slice();
    const lc = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (lc && !r.keyword.toLowerCase().includes(lc)) return false;
      if (showRanking === "top10" && !(r.position > 0 && r.position <= 10)) return false;
      if (showRanking === "top50" && !(r.position > 0 && r.position <= 50)) return false;
      if (showRanking === "missing" && !(r.position === 0 || r.position > 100)) return false;
      const geo = classifyKeywordGeo(r.keyword);
      if (!passesGeoFilter(geo, stateFilter, regionFilter)) return false;
      return true;
    });
    filtered.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // For position fields, lower number = better; we still let user sort asc/desc.
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const aNum = typeof av === "number" ? av : 0;
      const bNum = typeof bv === "number" ? bv : 0;
      return sortDir === "asc" ? aNum - bNum : bNum - aNum;
    });
    return filtered;
  }, [data, search, sortKey, sortDir, showRanking, stateFilter, regionFilter]);

  // Reset to the first page whenever the filtered set changes underneath us.
  useEffect(() => {
    setPage(0);
  }, [search, showRanking, stateFilter, regionFilter]);

  const setSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Default to descending for numeric, ascending for keyword.
      setSortDir(key === "keyword" ? "asc" : "desc");
    }
  };

  const sortIndicator = (key: SortKey) => (sortKey !== key ? "" : sortDir === "asc" ? " ▲" : " ▼");

  const top10Count = (data?.tracked ?? []).filter(
    (i) => i.position > 0 && i.position <= 10,
  ).length;
  const totalTracked = data?.tracked?.length ?? 0;
  const totalTraffic = (data?.tracked ?? []).reduce((sum, r) => sum + (r.estimatedTraffic ?? 0), 0);
  const totalTrafficValue = (data?.tracked ?? []).reduce(
    (sum, r) => sum + (r.trafficCost ?? 0),
    0,
  );

  // Tracker pagination math.
  const PAGE_STEP = 20;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);

  return (
    <SeoShell
      title="Keyword Tracking & Research"
      subtitle="Target rankings, position movement, CPC value, competition, and competitor opportunity gaps."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Tracked keywords" value={formatNumber(totalTracked)} />
        <Stat label="Top 10 rankings" value={formatNumber(top10Count)} />
        <Stat label="Missing targets" value={formatNumber(data?.missingTargets?.length ?? 0)} />
        <Stat label="Est. monthly traffic" value={formatNumber(totalTraffic)} />
        <Stat
          label="Est. traffic value"
          value={"$" + Math.round(totalTrafficValue).toLocaleString()}
          hint="What this organic traffic would cost in paid search."
        />
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <button
            onClick={() => setManageOpen((o) => !o)}
            className="flex items-start gap-2 text-left"
            aria-expanded={manageOpen}
          >
            <span className="mt-0.5 text-slate-400">{manageOpen ? "▾" : "▸"}</span>
            <span>
              <span className="block text-lg font-semibold text-slate-900">
                Manage target keywords{" "}
                <span className="text-sm font-normal text-slate-400">
                  ({targets.length})
                </span>
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                Phrases the firm wants to rank for. {manageOpen ? "" : "Click to expand."}
              </span>
            </span>
          </button>
          <button
            onClick={pushToSemrush}
            disabled={pushBusy || targets.length === 0}
            className="shrink-0 rounded-md border border-[#185FA5] px-3 py-2 text-xs font-medium text-[#185FA5] hover:bg-[#185FA5]/5 disabled:opacity-50"
            title="Add all tracked keywords to your Semrush Position Tracking campaign (spends ~100 API units each)"
          >
            {pushBusy ? "Pushing…" : "Push all to Semrush"}
          </button>
        </div>

        {pushResult && (
          <div className="mt-2 rounded-md border border-[#e2e8f0] bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {pushResult}
          </div>
        )}

        {manageOpen && (
          <>
            {targetError && (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {targetError}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTarget.trim()) addTarget(newTarget);
                }}
                placeholder='e.g. "best employment lawyer brooklyn"'
                className="flex-1 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
              />
              <button
                onClick={() => addTarget(newTarget)}
                disabled={!newTarget.trim() || targetBusy === newTarget.trim()}
                className="rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
              >
                {targetBusy === newTarget.trim() ? "…" : "Add"}
              </button>
            </div>

            <ul className="mt-3 flex flex-wrap gap-2">
              {targets.length === 0 && !loading && (
                <li className="text-xs text-slate-500">No target keywords yet.</li>
              )}
              {targets.map((t) => (
                <li
                  key={t}
                  className="inline-flex items-center gap-2 rounded-full border border-[#e2e8f0] bg-slate-50 pl-3 pr-1 py-1 text-xs text-slate-700"
                >
                  <span>{t}</span>
                  <button
                    onClick={() => removeTarget(t)}
                    disabled={targetBusy === t}
                    className="rounded-full h-5 w-5 inline-flex items-center justify-center text-slate-400 hover:bg-red-100 hover:text-red-700 disabled:opacity-50"
                    title={`Remove "${t}"`}
                    aria-label={`Remove ${t}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-semibold">Target keyword tracker</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keywords…"
              className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0] focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
            />
            <select
              value={showRanking}
              onChange={(e) =>
                setShowRanking(e.target.value as "all" | "top10" | "top50" | "missing")
              }
              className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0]"
            >
              <option value="all">All rankings</option>
              <option value="top10">Top 10</option>
              <option value="top50">Top 50</option>
              <option value="missing">Missing / unranked</option>
            </select>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as StateFilter)}
              className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0]"
              title="State scope (Semrush returns US-wide data; default hides explicit out-of-state keywords)"
            >
              {STATE_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value as RegionFilter)}
              className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0]"
              title="Narrow to a specific borough / county / NJ region"
            >
              {REGION_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-3">
          <RecentSearchesStrip scope="keywords" limit={6} onPick={setSearch} />
        </div>

        {loading && !data && <p className="text-sm text-slate-500">Loading…</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-slate-500 text-xs">
              <tr>
                <ThButton onClick={() => setSort("keyword")}>
                  Keyword{sortIndicator("keyword")}
                </ThButton>
                <ThButton onClick={() => setSort("position")}>
                  Pos{sortIndicator("position")}
                </ThButton>
                <ThButton onClick={() => setSort("positionDelta")}>
                  Δ{sortIndicator("positionDelta")}
                </ThButton>
                <ThButton onClick={() => setSort("searchVolume")}>
                  Volume/mo{sortIndicator("searchVolume")}
                </ThButton>
                <ThButton onClick={() => setSort("keywordDifficulty")}>
                  KD{sortIndicator("keywordDifficulty")}
                </ThButton>
                <ThButton onClick={() => setSort("cpc")}>
                  CPC{sortIndicator("cpc")}
                </ThButton>
                <ThButton onClick={() => setSort("estimatedTraffic")}>
                  Traffic{sortIndicator("estimatedTraffic")}
                </ThButton>
                <ThButton onClick={() => setSort("trafficCost")}>
                  Value{sortIndicator("trafficCost")}
                </ThButton>
                <th className="pb-2 pr-3 font-medium">URL</th>
                <th className="pb-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-slate-500">
                    No keywords match these filters.
                  </td>
                </tr>
              )}
              {pageRows.map((item) => {
                const geo = classifyKeywordGeo(item.keyword);
                const badgeLabel = geo.city
                  ? geo.city
                  : geo.state === "ny"
                    ? "NY"
                    : geo.state === "nj"
                      ? "NJ"
                      : geo.state === "other_state"
                        ? "out-of-state"
                        : null;
                const badgeTone =
                  geo.state === "other_state"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200";
                return (
                <tr
                  key={item.keyword}
                  className="border-b border-[#e2e8f0]/60 text-slate-700 last:border-0 hover:bg-slate-50"
                >
                  <td className="py-2 pr-3 text-slate-900 font-medium">
                    {item.keyword}
                    {badgeLabel && (
                      <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded border ${badgeTone}`}>
                        {badgeLabel}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {item.position > 0 ? item.position : "—"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    <PositionDelta
                      delta={item.positionDelta}
                      prev={item.previousPosition}
                      position={item.position}
                    />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatNumber(item.searchVolume)}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    <KdBadge kd={item.keywordDifficulty} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {item.cpc > 0 ? `$${item.cpc.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatNumber(item.estimatedTraffic)}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {item.trafficCost > 0 ? `$${Math.round(item.trafficCost)}` : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#185FA5] hover:underline truncate block max-w-[300px]"
                        title={item.url}
                      >
                        {item.url.replace(/^https?:\/\/(www\.)?[^/]+/, "")}
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <ContentActionsRow keyword={item.keyword} actions={contentActions} />
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {sorted.length === 0
              ? "No keywords match these filters."
              : `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, sorted.length)} of ${sorted.length}${
                  sorted.length !== totalTracked ? ` (filtered from ${totalTracked})` : ""
                }. Click any column header to sort.`}
          </p>
          {sorted.length > PAGE_STEP && (
            <div className="flex items-center gap-2">
              {pageSize < sorted.length && (
                <button
                  onClick={() => setPageSize((s) => s + PAGE_STEP)}
                  className="rounded-md border border-[#e2e8f0] px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  title="Show 20 more rows on this page"
                >
                  Show 20 more
                </button>
              )}
              {pageSize !== PAGE_STEP && (
                <button
                  onClick={() => {
                    setPageSize(PAGE_STEP);
                    setPage(0);
                  }}
                  className="rounded-md border border-[#e2e8f0] px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  title="Back to 20 per page"
                >
                  Reset to 20
                </button>
              )}
              <button
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage <= 0}
                className="rounded-md border border-[#e2e8f0] px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                ◀ Prev
              </button>
              <span className="text-xs text-slate-500 tabular-nums">
                Page {safePage + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                disabled={safePage >= totalPages - 1}
                className="rounded-md border border-[#e2e8f0] px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Next ▶
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
          <h2 className="text-lg font-semibold">Legal industry trends</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data?.trendingKeywords ?? []).map((item) => (
              <li
                key={item.keyword}
                className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2"
              >
                <p className="text-slate-900">{item.keyword}</p>
                <p className="text-xs text-slate-500">
                  Volume {formatNumber(item.searchVolume)} · Trend {item.trendScore}
                </p>
                {renderSuggestionActions(item.keyword, "trending_keyword")}
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
          <h2 className="text-lg font-semibold">Long-tail opportunities</h2>
          <p className="mt-1 text-xs text-slate-500">
            Real question &amp; long-tail searches related to your targets (Semrush).
          </p>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {(data?.longTailSuggestions ?? []).length === 0 && !loading && (
              <li className="text-xs text-slate-500">No long-tail suggestions available.</li>
            )}
            {(data?.longTailSuggestions ?? []).map((item) => (
              <li
                key={item.keyword}
                className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{item.keyword}</span>
                  <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                    {formatNumber(item.searchVolume)}/mo
                  </span>
                </div>
                {renderSuggestionActions(item.keyword, "long_tail_suggestion")}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold">Manage tracked competitors</h2>
        <p className="mt-1 text-xs text-slate-500">
          Firms to benchmark against. The gap table below runs across this whole set. Saved to
          Supabase. Suggestions come from Semrush&apos;s organic-competitor detection (directories
          &amp; aggregators already filtered out).
        </p>

        {competitorError && (
          <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {competitorError}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newCompetitor}
            onChange={(e) => setNewCompetitor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newCompetitor.trim()) addCompetitor(newCompetitor);
            }}
            placeholder="e.g. outtengolden.com"
            className="flex-1 rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
          />
          <button
            onClick={() => addCompetitor(newCompetitor)}
            disabled={!newCompetitor.trim() || competitorBusy === newCompetitor.trim()}
            className="rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
          >
            {competitorBusy === newCompetitor.trim() ? "…" : "Add"}
          </button>
        </div>

        <ul className="mt-3 flex flex-wrap gap-2">
          {competitors.length === 0 && !loading && (
            <li className="text-xs text-slate-500">No tracked competitors yet.</li>
          )}
          {competitors.map((c) => (
            <li
              key={c}
              className="inline-flex items-center gap-2 rounded-full border border-[#e2e8f0] bg-slate-50 pl-3 pr-1 py-1 text-xs text-slate-700"
            >
              <span>{c}</span>
              <button
                onClick={() => removeCompetitor(c)}
                disabled={competitorBusy === c}
                className="rounded-full h-5 w-5 inline-flex items-center justify-center text-slate-400 hover:bg-red-100 hover:text-red-700 disabled:opacity-50"
                title={`Remove "${c}"`}
                aria-label={`Remove ${c}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        {suggestedCompetitors.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-500">Suggested by Semrush — click to track:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {suggestedCompetitors.map((s) => (
                <li key={s}>
                  <button
                    onClick={() => addCompetitor(s, "suggested")}
                    disabled={competitorBusy === s}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#185FA5]/40 bg-[#185FA5]/5 px-3 py-1 text-xs text-[#185FA5] hover:bg-[#185FA5]/10 disabled:opacity-50"
                    title={`Track ${s}`}
                  >
                    + {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold">Competitor keyword opportunities</h2>
        <p className="text-xs text-slate-500 mt-1">
          Keywords where a tracked competitor outranks us with meaningful search volume, merged
          across {competitors.length || "your"} tracked {competitors.length === 1 ? "firm" : "firms"}.
          &quot;Firms&quot; = how many of them beat us on that keyword.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-slate-500 text-xs">
              <tr>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium">Best competitor pos</th>
                <th className="pb-2 pr-3 font-medium">Our pos</th>
                <th className="pb-2 pr-3 font-medium">Firms</th>
                <th className="pb-2 pr-3 font-medium">Opportunity score</th>
                <th className="pb-2 font-medium">Top domain</th>
              </tr>
            </thead>
            <tbody>
              {(competitive?.competitive ?? []).length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No competitor gaps found. Add tracked competitors above to populate this table.
                  </td>
                </tr>
              )}
              {(competitive?.competitive ?? []).slice(0, 30).map((item) => (
                <tr
                  key={`${item.domain}-${item.keyword}`}
                  className="border-b border-[#e2e8f0]/60 last:border-0 hover:bg-slate-50"
                >
                  <td className="py-2 pr-3 text-slate-900">{item.keyword}</td>
                  <td className="py-2 pr-3 tabular-nums">{item.competitorPosition}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {item.ourPosition > 0 ? item.ourPosition : "—"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{item.competitorsBeatingUs ?? 1}</td>
                  <td className="py-2 pr-3 tabular-nums">{Math.round(item.opportunityScore)}</td>
                  <td className="py-2 text-slate-600">{item.domain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {contentActions.modal}
    </SeoShell>
  );
}

function ThButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <th className="pb-2 pr-3 font-medium">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center hover:text-[#185FA5]"
      >
        {children}
      </button>
    </th>
  );
}

function PositionDelta({
  delta,
  prev,
  position,
}: {
  delta: number;
  prev: number;
  position: number;
}) {
  if (!delta) {
    // Never ranked in Google's top 100 — was shown as misleading "NEW" before.
    if (prev === 0 && position === 0) return <span className="text-slate-400">—</span>;
    // Just entered the top 100 this period.
    if (prev === 0 && position > 0) {
      return <span className="text-emerald-700 text-xs font-medium">NEW</span>;
    }
    return <span className="text-slate-400">—</span>;
  }
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
        ↑ {delta}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-700 text-xs font-medium">
      ↓ {Math.abs(delta)}
    </span>
  );
}

function KdBadge({ kd }: { kd: number }) {
  if (!kd) return <span className="text-slate-400">—</span>;
  const tone =
    kd < 30 ? "emerald" : kd < 60 ? "amber" : "red";
  const colors: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${colors[tone]}`}>
      {kd}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </article>
  );
}
