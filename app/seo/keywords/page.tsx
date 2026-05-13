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
  longTailSuggestions?: string[];
  competitive?: Array<{
    keyword: string;
    competitorPosition: number;
    ourPosition: number;
    opportunityScore: number;
    domain: string;
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

type ContentIdea = {
  headline: string;
  summary: string;
  contentType: string;
  practiceArea: string;
  whyItHelps: string;
  suggestedHeadings: string[];
};

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

  // Target keyword management — persisted in Supabase via
  // /api/seo/keywords/targets. The tracker table below shows one row per
  // target, populated with Semrush position/volume/KD data.
  const [targets, setTargets] = useState<string[]>([]);
  const [newTarget, setNewTarget] = useState("");
  const [targetBusy, setTargetBusy] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  // Content recommendations modal — generated per-keyword via Claude.
  const [recsFor, setRecsFor] = useState<string | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [recsIdeas, setRecsIdeas] = useState<ContentIdea[]>([]);

  // Draft creation state — keyed by either the target keyword (quick Create)
  // or the headline (when creating from a recommendation idea).
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [createToast, setCreateToast] = useState<{ keyword: string; draftId: string } | null>(
    null,
  );
  const [createError, setCreateError] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    return Promise.all([
      fetch("/api/seo/keywords", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/seo/keywords?competitor=nilawfirm.com", { cache: "no-store" }).then((r) =>
        r.json(),
      ),
      fetch("/api/seo/keywords/targets", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([d, c, t]) => {
        setData(d);
        setCompetitive(c);
        setTargets(Array.isArray(t?.targets) ? t.targets : []);
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
      const res = await fetch("/api/seo/keywords/targets", {
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
        `/api/seo/keywords/targets?keyword=${encodeURIComponent(keyword)}`,
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

  const openRecs = async (keyword: string) => {
    setRecsFor(keyword);
    setRecsIdeas([]);
    setRecsError(null);
    setRecsLoading(true);
    try {
      const res = await fetch("/api/seo/keywords/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRecsError(json?.error ?? "Failed to load recommendations");
        return;
      }
      setRecsIdeas(Array.isArray(json?.ideas) ? json.ideas : []);
    } catch (e) {
      setRecsError(e instanceof Error ? e.message : "Failed to load recommendations");
    } finally {
      setRecsLoading(false);
    }
  };

  const closeRecs = () => {
    setRecsFor(null);
    setRecsIdeas([]);
    setRecsError(null);
  };

  /**
   * Creates a blog draft. `topic` is what the article is about (either the
   * raw keyword for quick Create, or the headline of a chosen idea). The
   * keyword is always passed to target_keywords so the draft is optimized
   * for it. busyKey scopes the spinner: per-row keyword for quick Create,
   * per-headline for idea-driven Create.
   */
  const createDraft = async (params: {
    topic: string;
    keyword: string;
    practiceArea?: string;
    headings?: string[];
    busyKey: string;
  }) => {
    setCreatingKey(params.busyKey);
    setCreateError(null);
    try {
      const res = await fetch("/api/content/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: "blog",
          topic: params.topic,
          practice_area: params.practiceArea || "General",
          tone: "Professional",
          length: "medium",
          target_keywords: [params.keyword],
          seo_brief: params.headings && params.headings.length > 0
            ? { headings: params.headings }
            : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.draft_id) {
        setCreateError(json?.error ?? "Draft generation failed");
        return;
      }
      setCreateToast({ keyword: params.keyword, draftId: json.draft_id });
      // Auto-close the recommendations modal once a draft lands so the user
      // sees the toast and can jump straight to editing.
      closeRecs();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Draft generation failed");
    } finally {
      setCreatingKey(null);
    }
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
        <h2 className="text-lg font-semibold">Manage target keywords</h2>
        <p className="mt-1 text-xs text-slate-500">
          Phrases the firm wants to rank for. Saved to Supabase — survive Vercel cold boots and
          drive the tracker below.
        </p>

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
              {sorted.map((item) => {
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
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => openRecs(item.keyword)}
                        disabled={recsLoading && recsFor === item.keyword}
                        className="text-xs px-2 py-1 rounded border border-[#185FA5] text-[#185FA5] hover:bg-[#185FA5]/5 disabled:opacity-50"
                        title="See AI-generated content ideas to rank for this keyword"
                      >
                        {recsLoading && recsFor === item.keyword ? "…" : "Ideas"}
                      </button>
                      <button
                        onClick={() =>
                          createDraft({
                            topic: item.keyword,
                            keyword: item.keyword,
                            busyKey: `quick:${item.keyword}`,
                          })
                        }
                        disabled={creatingKey === `quick:${item.keyword}`}
                        className="text-xs px-2 py-1 rounded bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50"
                        title="Generate a blog draft targeting this keyword"
                      >
                        {creatingKey === `quick:${item.keyword}` ? "…" : "Create"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Showing {sorted.length} of {totalTracked} keywords. Click any column header to sort.
        </p>
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
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-5">
          <h2 className="text-lg font-semibold">Long-tail opportunities</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {(data?.longTailSuggestions ?? []).map((keyword) => (
              <li
                key={keyword}
                className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2"
              >
                {keyword}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold">Competitor keyword opportunities</h2>
        <p className="text-xs text-slate-500 mt-1">
          Keywords where a tracked competitor outranks us with meaningful search volume.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-slate-500 text-xs">
              <tr>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium">Competitor pos</th>
                <th className="pb-2 pr-3 font-medium">Our pos</th>
                <th className="pb-2 pr-3 font-medium">Opportunity score</th>
                <th className="pb-2 font-medium">Domain</th>
              </tr>
            </thead>
            <tbody>
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
                  <td className="py-2 pr-3 tabular-nums">{Math.round(item.opportunityScore)}</td>
                  <td className="py-2 text-slate-600">{item.domain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {createToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md rounded-xl border border-emerald-300 bg-white p-4 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-700">Draft created</p>
              <p className="mt-1 text-xs text-slate-600">
                Optimized for <span className="font-medium">"{createToast.keyword}"</span>.
              </p>
            </div>
            <button
              onClick={() => setCreateToast(null)}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <a
              href={`/content/drafts?id=${encodeURIComponent(createToast.draftId)}`}
              className="text-xs px-3 py-1.5 rounded bg-[#185FA5] text-white hover:bg-[#1f6fb8]"
            >
              Open draft
            </a>
            <button
              onClick={() => setCreateToast(null)}
              className="text-xs px-3 py-1.5 rounded border border-[#e2e8f0] text-slate-700 hover:bg-slate-50"
            >
              Stay here
            </button>
          </div>
        </div>
      )}

      {createError && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md rounded-xl border border-red-300 bg-red-50 p-4 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-red-700">{createError}</p>
            <button
              onClick={() => setCreateError(null)}
              className="text-red-400 hover:text-red-700"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {recsFor && (
        <RecommendationsModal
          keyword={recsFor}
          loading={recsLoading}
          error={recsError}
          ideas={recsIdeas}
          creatingKey={creatingKey}
          onClose={closeRecs}
          onCreateFromIdea={(idea) =>
            createDraft({
              topic: idea.headline,
              keyword: recsFor,
              practiceArea: idea.practiceArea,
              headings: idea.suggestedHeadings,
              busyKey: `idea:${idea.headline}`,
            })
          }
        />
      )}
    </SeoShell>
  );
}

function RecommendationsModal({
  keyword,
  loading,
  error,
  ideas,
  creatingKey,
  onClose,
  onCreateFromIdea,
}: {
  keyword: string;
  loading: boolean;
  error: string | null;
  ideas: ContentIdea[];
  creatingKey: string | null;
  onClose: () => void;
  onCreateFromIdea: (idea: ContentIdea) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Content ideas for</p>
            <h3 className="mt-1 text-lg font-semibold">{keyword}</h3>
            <p className="mt-1 text-xs text-slate-500">
              AI-suggested article angles to help the firm rank for this keyword.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5">
          {loading && (
            <p className="text-sm text-slate-500">Generating ideas… (typically 5-10s)</p>
          )}
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && ideas.length === 0 && (
            <p className="text-sm text-slate-500">No ideas returned.</p>
          )}
          <ul className="space-y-3">
            {ideas.map((idea) => (
              <li
                key={idea.headline}
                className="rounded-lg border border-[#e2e8f0] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-slate-900">{idea.headline}</h4>
                    <p className="mt-1 text-xs text-slate-600">{idea.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                      <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-700">
                        {idea.contentType}
                      </span>
                      <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-violet-700">
                        {idea.practiceArea}
                      </span>
                    </div>
                    {idea.whyItHelps && (
                      <p className="mt-2 text-[11px] italic text-slate-500">
                        Why it ranks: {idea.whyItHelps}
                      </p>
                    )}
                    {idea.suggestedHeadings && idea.suggestedHeadings.length > 0 && (
                      <details className="mt-2 text-xs text-slate-600">
                        <summary className="cursor-pointer text-[#185FA5] hover:underline">
                          Outline ({idea.suggestedHeadings.length} sections)
                        </summary>
                        <ul className="mt-1 ml-4 list-disc space-y-0.5">
                          {idea.suggestedHeadings.map((h, i) => (
                            <li key={i}>{h}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <button
                    onClick={() => onCreateFromIdea(idea)}
                    disabled={creatingKey === `idea:${idea.headline}`}
                    className="shrink-0 rounded bg-[#185FA5] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
                  >
                    {creatingKey === `idea:${idea.headline}` ? "Generating…" : "Create draft"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
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
