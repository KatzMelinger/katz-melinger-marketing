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

export function RankHistoryPanel() {
  const [data, setData] = useState<RankHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateA, setDateA] = useState<string>("");
  const [dateB, setDateB] = useState<string>("");
  const [search, setSearch] = useState("");

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
    return data.keywords.filter((k) => !lc || k.keyword.toLowerCase().includes(lc));
  }, [data, search]);

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
                {data!.domains.map((domain) => (
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
                    Keyword
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
                    <DomainSubHead key={domain} dateA={dateA} dateB={dateB} />
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

function DomainSubHead({ dateA, dateB }: { dateA: string; dateB: string }) {
  return (
    <>
      <th className="pb-2 pr-3 font-medium text-center border-l border-[#e2e8f0] tabular-nums">
        {shortDate(dateA)}
      </th>
      <th className="pb-2 pr-3 font-medium text-center tabular-nums">{shortDate(dateB)}</th>
      <th className="pb-2 pr-3 font-medium text-center">Δ</th>
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
