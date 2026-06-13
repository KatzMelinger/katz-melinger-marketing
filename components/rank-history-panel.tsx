"use client";

/**
 * Position history & visibility — the Semrush-style "Position Tracking" view.
 *
 * Two pieces, both backed by /api/seo/rank-history (the seo_rank_snapshots
 * time-series the daily refresh cron appends to):
 *   • a visibility trend line per domain (firm + tracked competitors), and
 *   • a date-over-date comparison table: pick two capture dates and see each
 *     domain's rank for every tracked keyword, with the movement between them.
 *
 * History accumulates one snapshot per day, so this is empty until the refresh
 * has run at least once and shows a trend once there are 2+ capture dates.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  classifyKeywordCluster,
  CLUSTER_FILTER_OPTIONS,
  type ClusterFilter,
} from "@/lib/keyword-cluster";

type RankHistory = {
  ownDomain: string;
  domains: string[];
  dates: string[];
  visibility: Record<string, Record<string, number>>;
  keywords: Array<{
    keyword: string;
    ranks: Record<string, Record<string, number | null>>;
  }>;
};

// Firm domain gets the brand accent; competitors cycle through a distinct set.
const OWN_COLOR = "#185FA5";
const COMPETITOR_COLORS = [
  "#a855f7", // purple
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#0ea5e9", // sky
  "#ec4899", // pink
  "#84cc16", // lime
  "#6366f1", // indigo
];

function colorForDomain(domain: string, ownDomain: string, competitors: string[]): string {
  if (domain === ownDomain) return OWN_COLOR;
  const idx = competitors.indexOf(domain);
  return COMPETITOR_COLORS[idx % COMPETITOR_COLORS.length];
}

function shortDate(d: string): string {
  // "2026-06-13" → "Jun 13"
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${day}`;
}

type ComparisonRow = { keyword: string; ranks: Record<string, Record<string, number | null>> };

/** Numeric Δ for sorting: positive = improved (moved up). NEW/LOST get large
 *  magnitudes so they sort to the extremes; both-unranked → null (sinks). */
function diffScore(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  if (a === null) return 1000; // entered the rankings — biggest improvement
  if (b === null) return -1000; // dropped out — biggest decline
  return a - b;
}

/** Sort value for a comparison row given the active column. Null = unranked,
 *  which the comparator always sinks to the bottom (like the tracker). */
function sortValueFor(
  row: ComparisonRow,
  col: string,
  dateA: string,
  dateB: string,
): string | number | null {
  if (col === "keyword") return row.keyword;
  const sep = col.lastIndexOf("::");
  const domain = col.slice(0, sep);
  const which = col.slice(sep + 2);
  const a = row.ranks[domain]?.[dateA] ?? null;
  const b = row.ranks[domain]?.[dateB] ?? null;
  if (which === "A") return a;
  if (which === "B") return b;
  return diffScore(a, b);
}

/** Compare two sort values, always sinking nulls to the bottom regardless of
 *  direction (an unranked keyword is the "worst", not the "best"). */
function compareSortValues(
  av: string | number | null,
  bv: string | number | null,
  dir: "asc" | "desc",
): number {
  const an = av === null;
  const bn = bv === null;
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof av === "string" && typeof bv === "string") {
    return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  }
  return dir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
}

export function RankHistoryPanel() {
  const [data, setData] = useState<RankHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateA, setDateA] = useState<string>("");
  const [dateB, setDateB] = useState<string>("");
  const [search, setSearch] = useState("");
  // Comparison-table sort. `col` is "keyword" or `${domain}::A|B|diff`.
  const [sortCol, setSortCol] = useState<string>("keyword");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Practice-area cluster filter for the comparison table (lib/keyword-cluster).
  const [clusterFilter, setClusterFilter] = useState<ClusterFilter>("all");
  // Competitors toggled OFF the chart + comparison table. The firm's own domain
  // is never hidden (it's the baseline every comparison is read against).
  const [hiddenDomains, setHiddenDomains] = useState<Set<string>>(new Set());
  // Comparison-table pagination: 20 per page by default, matching the tracker.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const ALL_SIZE = 1_000_000; // sentinel for "show all" (finite so math stays safe)

  const toggleDomain = (domain: string) => {
    setHiddenDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const setSort = (col: string) => {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      // Keyword reads best A→Z; rank / Δ columns default high→low like the tracker.
      setSortDir(col === "keyword" ? "asc" : "desc");
    }
  };

  useEffect(() => {
    fetch("/api/seo/rank-history", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: RankHistory) => {
        // Guard against error / partial payloads (e.g. before the migration is
        // applied) — only accept a fully well-formed response so every
        // downstream .filter/.map (domains, dates, keywords, visibility) is safe.
        if (
          !d ||
          !Array.isArray(d.domains) ||
          !Array.isArray(d.dates) ||
          !Array.isArray(d.keywords) ||
          typeof d.visibility !== "object" ||
          d.visibility === null
        ) {
          setData(null);
          return;
        }
        setData(d);
        if (d.dates.length > 0) {
          setDateA(d.dates[0]);
          setDateB(d.dates[d.dates.length - 1]);
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const competitors = useMemo(
    () => (data ? data.domains.filter((d) => d !== data.ownDomain) : []),
    [data],
  );

  // Domains actually rendered (chart lines + table columns): everything except
  // the competitors the user toggled off. The own domain is always shown.
  const shownDomains = useMemo(
    () =>
      data
        ? data.domains.filter((d) => d === data.ownDomain || !hiddenDomains.has(d))
        : [],
    [data, hiddenDomains],
  );

  // Recharts wants one row per date with a key per domain: { date, [domain]: vis }.
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.dates.map((date) => {
      const row: Record<string, string | number> = { date: shortDate(date) };
      for (const domain of data.domains) {
        row[domain] = data.visibility[domain]?.[date] ?? 0;
      }
      return row;
    });
  }, [data]);

  const comparisonRows = useMemo(() => {
    if (!data) return [];
    const lc = search.trim().toLowerCase();
    const rows = data.keywords.filter((k) => {
      if (lc && !k.keyword.toLowerCase().includes(lc)) return false;
      if (clusterFilter !== "all" && classifyKeywordCluster(k.keyword).key !== clusterFilter)
        return false;
      return true;
    });
    return rows
      .slice()
      .sort((ra, rb) =>
        compareSortValues(
          sortValueFor(ra, sortCol, dateA, dateB),
          sortValueFor(rb, sortCol, dateA, dateB),
          sortDir,
        ),
      );
  }, [data, search, clusterFilter, sortCol, sortDir, dateA, dateB]);

  // Reset to the first page whenever the filtered/sorted set shifts underneath us.
  useEffect(() => {
    setPage(0);
  }, [search, clusterFilter, sortCol, sortDir, dateA, dateB]);

  // If the column we're sorting by belongs to a competitor that just got toggled
  // off, fall back to the keyword sort so the indicator isn't stranded.
  useEffect(() => {
    if (sortCol === "keyword") return;
    const domain = sortCol.slice(0, sortCol.lastIndexOf("::"));
    if (data && !shownDomains.includes(domain)) {
      setSortCol("keyword");
      setSortDir("asc");
    }
  }, [shownDomains, sortCol, data]);

  // Comparison-table pagination math (mirrors the tracker on the keywords page).
  const totalRows = comparisonRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * pageSize;
  const pageRows = comparisonRows.slice(pageStart, pageStart + pageSize);
  const pageSizeValue = pageSize >= ALL_SIZE ? "all" : String(pageSize);

  if (loading) {
    return (
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold">Position history & visibility</h2>
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      </section>
    );
  }

  const hasHistory = data && data.dates.length > 0;

  return (
    <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Position history &amp; visibility</h2>
          <p className="mt-1 text-xs text-slate-500 max-w-2xl">
            Daily rank snapshots for you and every tracked competitor. Visibility is the
            CTR-weighted share of clicks your rankings earn across all tracked keywords —
            higher is better. Captured once per day by the ranking refresh.
          </p>
        </div>
      </div>

      {!hasHistory ? (
        <div className="mt-4 rounded-md border border-dashed border-[#e2e8f0] bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No history yet. Snapshots are captured daily by the ranking refresh — this fills in
          after the next refresh runs, and the trend line appears once there are two or more days.
        </div>
      ) : (
        <>
          {/* Domain toggles — add / remove competitors from both the chart and
              the comparison table below. The firm's own domain is locked on. */}
          {competitors.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Show:</span>
              {data!.domains.map((domain) => {
                const isOwn = domain === data!.ownDomain;
                const shown = isOwn || !hiddenDomains.has(domain);
                const color = colorForDomain(domain, data!.ownDomain, competitors);
                return (
                  <button
                    key={domain}
                    type="button"
                    onClick={() => !isOwn && toggleDomain(domain)}
                    disabled={isOwn}
                    aria-pressed={shown}
                    title={
                      isOwn
                        ? "Your domain is always shown"
                        : shown
                          ? `Hide ${domain}`
                          : `Show ${domain}`
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      shown
                        ? "border-[#e2e8f0] bg-white text-slate-700"
                        : "border-dashed border-[#e2e8f0] bg-slate-50 text-slate-400"
                    } ${isOwn ? "cursor-default" : "hover:border-[#185FA5] cursor-pointer"}`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: shown ? color : "#cbd5e1" }}
                    />
                    {domain}
                    {isOwn ? " (you)" : ""}
                  </button>
                );
              })}
            </div>
          )}

          {/* Visibility trend chart */}
          <div className="mt-4 h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 11 }} />
                <YAxis
                  tick={{ fill: "#475569", fontSize: 11 }}
                  tickFormatter={(v) => `${v}%`}
                  width={48}
                />
                <Tooltip
                  formatter={(v) => `${v}%`}
                  contentStyle={{ fontSize: 12, borderColor: "#e2e8f0" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {shownDomains.map((domain) => (
                  <Line
                    key={domain}
                    type="monotone"
                    dataKey={domain}
                    name={domain}
                    stroke={colorForDomain(domain, data!.ownDomain, competitors)}
                    strokeWidth={domain === data!.ownDomain ? 2.5 : 1.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Date-over-date comparison table */}
          <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-700">Compare positions</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search keywords…"
                className="px-3 py-1.5 text-sm rounded-md border border-[#e2e8f0] focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
              />
              <DateSelect label="From" value={dateA} dates={data!.dates} onChange={setDateA} />
              <DateSelect label="To" value={dateB} dates={data!.dates} onChange={setDateB} />
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm" style={{ minWidth: 320 + data!.domains.length * 220 }}>
              <thead className="text-slate-500 text-xs">
                <tr className="border-b border-[#e2e8f0]">
                  <th rowSpan={2} className="pb-2 pr-3 font-medium align-bottom">
                    <button
                      type="button"
                      onClick={() => setSort("keyword")}
                      className="inline-flex items-center hover:text-[#185FA5]"
                    >
                      Keyword{sortCol === "keyword" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                  {data!.domains.map((domain) => (
                    <th
                      key={domain}
                      colSpan={3}
                      className="pb-1 px-3 font-medium text-center border-l border-[#e2e8f0]"
                      style={{ color: colorForDomain(domain, data!.ownDomain, competitors) }}
                    >
                      {domain}
                      {domain === data!.ownDomain ? " (you)" : ""}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-[#e2e8f0] text-[11px]">
                  {data!.domains.map((domain) => (
                    <DomainSubHead
                      key={domain}
                      domain={domain}
                      dateA={dateA}
                      dateB={dateB}
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSort={setSort}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonRows.length === 0 && (
                  <tr>
                    <td colSpan={1 + data!.domains.length * 3} className="py-6 text-center text-slate-500">
                      No keywords match.
                    </td>
                  </tr>
                )}
                {comparisonRows.map((row) => (
                  <tr
                    key={row.keyword}
                    className="border-b border-[#e2e8f0]/60 text-slate-700 last:border-0 hover:bg-slate-50"
                  >
                    <td className="py-2 pr-3 text-slate-900 font-medium">{row.keyword}</td>
                    {data!.domains.map((domain) => {
                      const a = row.ranks[domain]?.[dateA] ?? null;
                      const b = row.ranks[domain]?.[dateB] ?? null;
                      return (
                        <RankCells key={domain} a={a} b={b} />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function DateSelect({
  label,
  value,
  dates,
  onChange,
}: {
  label: string;
  value: string;
  dates: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-[#e2e8f0] px-2 py-1.5 text-xs text-slate-700"
      >
        {dates.map((d) => (
          <option key={d} value={d}>
            {shortDate(d)}
          </option>
        ))}
      </select>
    </label>
  );
}

function DomainSubHead({
  domain,
  dateA,
  dateB,
  sortCol,
  sortDir,
  onSort,
}: {
  domain: string;
  dateA: string;
  dateB: string;
  sortCol: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
}) {
  const indicator = (col: string) =>
    sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  const cell = (col: string, label: string, extra = "") => (
    <th className={`pb-2 pr-3 font-medium text-center tabular-nums ${extra}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center hover:text-[#185FA5]"
      >
        {label}
        {indicator(col)}
      </button>
    </th>
  );
  return (
    <>
      {cell(`${domain}::A`, shortDate(dateA), "border-l border-[#e2e8f0]")}
      {cell(`${domain}::B`, shortDate(dateB))}
      {cell(`${domain}::diff`, "Δ")}
    </>
  );
}

function RankCells({ a, b }: { a: number | null; b: number | null }) {
  return (
    <>
      <td className="py-2 pr-3 text-center tabular-nums border-l border-[#e2e8f0]/60">
        {a === null ? <span className="text-slate-400">—</span> : a}
      </td>
      <td className="py-2 pr-3 text-center tabular-nums">
        {b === null ? <span className="text-slate-400">—</span> : b}
      </td>
      <td className="py-2 pr-3 text-center">
        <RankDiff a={a} b={b} />
      </td>
    </>
  );
}

function RankDiff({ a, b }: { a: number | null; b: number | null }) {
  // Lower position number is better, so improvement = a - b > 0 (moved up).
  if (a === null && b === null) return <span className="text-slate-400">—</span>;
  if (a === null && b !== null)
    return <span className="text-emerald-700 text-xs font-medium">NEW</span>;
  if (a !== null && b === null)
    return <span className="text-red-700 text-xs font-medium">LOST</span>;
  const delta = (a as number) - (b as number);
  if (delta === 0) return <span className="text-slate-400">–</span>;
  if (delta > 0)
    return <span className="text-emerald-700 text-xs font-medium">↑ {delta}</span>;
  return <span className="text-red-700 text-xs font-medium">↓ {Math.abs(delta)}</span>;
}
