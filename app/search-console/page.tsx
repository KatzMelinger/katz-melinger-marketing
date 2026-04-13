"use client";

import { useEffect, useState } from "react";
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

import { MarketingNav } from "@/components/marketing-nav";

const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";

function positionBadgeClass(pos: number): string {
  if (pos >= 1 && pos <= 3) return "bg-emerald-500/25 text-emerald-200 ring-emerald-500/40";
  if (pos <= 10) return "bg-sky-500/25 text-sky-200 ring-sky-500/40";
  return "bg-slate-600/40 text-slate-300 ring-slate-500/30";
}

function formatGscDate(d: string): string {
  if (d.length === 8) {
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  return d;
}

export default function SearchConsolePage() {
  const [overview, setOverview] = useState<{
    totalClicks: number;
    totalImpressions: number;
    avgCtr: number;
    avgPosition: number;
    error?: string;
  } | null>(null);
  const [keywords, setKeywords] = useState<
    {
      query: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }[]
  >([]);
  const [pages, setPages] = useState<
    { page: string; clicks: number; impressions: number; ctr: number; position: number }[]
  >([]);
  const [days, setDays] = useState<
    { date: string; clicks: number; impressions: number }[]
  >([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const [o, k, p, d] = await Promise.all([
          fetch("/api/search-console/overview").then((r) => r.json()),
          fetch("/api/search-console/keywords").then((r) => r.json()),
          fetch("/api/search-console/pages").then((r) => r.json()),
          fetch("/api/search-console/by-day").then((r) => r.json()),
        ]);
        if (c) return;
        setOverview(o);
        setKeywords(Array.isArray(k.keywords) ? k.keywords : []);
        setPages(Array.isArray(p.pages) ? p.pages : []);
        setDays(Array.isArray(d.days) ? d.days : []);
        const parts = [o.error, k.error, p.error, d.error].filter(Boolean);
        if (parts.length) setErr(parts.join(" · "));
      } catch {
        if (!c) setErr("Failed to load Search Console data");
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  const chartData = days.map((x) => ({
    ...x,
    label: formatGscDate(x.date),
  }));

  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Search Console</h1>
          <p className="mt-1 text-sm text-slate-400">Last 28 days · katzmelinger.com</p>
        </div>

        {err ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100"
            style={{ backgroundColor: CARD }}
          >
            {err}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Total clicks",
              value: overview?.totalClicks ?? "—",
              bg: ACCENT,
            },
            {
              label: "Impressions",
              value: overview?.totalImpressions?.toLocaleString() ?? "—",
              bg: "#166534",
            },
            {
              label: "Avg CTR",
              value:
                overview?.avgCtr != null
                  ? `${(overview.avgCtr * 100).toFixed(2)}%`
                  : "—",
              bg: "#b45309",
            },
            {
              label: "Avg position",
              value:
                overview?.avgPosition != null
                  ? overview.avgPosition.toFixed(1)
                  : "—",
              bg: "#475569",
            },
          ].map((x) => (
            <article
              key={x.label}
              className="rounded-xl border border-white/5 p-5"
              style={{ backgroundColor: x.bg }}
            >
              <p className="text-sm text-white/90">{x.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{x.value}</p>
            </article>
          ))}
        </section>

        <section
          className="rounded-xl border p-6"
          style={{ backgroundColor: CARD, borderColor: BORDER }}
        >
          <h2 className="mb-4 text-lg font-semibold">Clicks & impressions by day</h2>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="#2a3f5f" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: CARD,
                    border: `1px solid ${BORDER}`,
                    color: "#fff",
                  }}
                />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="clicks"
                  stroke={ACCENT}
                  strokeWidth={2}
                  dot={false}
                  name="Clicks"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="impressions"
                  stroke="#1D9E75"
                  strokeWidth={2}
                  dot={false}
                  name="Impressions"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section
          className="rounded-xl border p-6"
          style={{ backgroundColor: CARD, borderColor: BORDER }}
        >
          <h2 className="mb-4 text-lg font-semibold">Top queries</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b text-slate-400" style={{ borderColor: BORDER }}>
                  <th className="pb-3 pr-4 font-medium">Query</th>
                  <th className="pb-3 pr-4 font-medium">Position</th>
                  <th className="pb-3 pr-4 font-medium">Clicks</th>
                  <th className="pb-3 pr-4 font-medium">Impressions</th>
                  <th className="pb-3 font-medium">CTR</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {keywords.map((k) => (
                  <tr key={k.query} className="border-b border-[#2a3f5f]/60">
                    <td className="py-2 pr-4 text-white">{k.query}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${positionBadgeClass(k.position)}`}
                      >
                        {k.position.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{k.clicks}</td>
                    <td className="py-2 pr-4 tabular-nums">{k.impressions}</td>
                    <td className="py-2 tabular-nums">
                      {(k.ctr * 100).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="rounded-xl border p-6"
          style={{ backgroundColor: CARD, borderColor: BORDER }}
        >
          <h2 className="mb-4 text-lg font-semibold">Top pages</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b text-slate-400" style={{ borderColor: BORDER }}>
                  <th className="pb-3 pr-4 font-medium">Page</th>
                  <th className="pb-3 pr-4 font-medium">Clicks</th>
                  <th className="pb-3 pr-4 font-medium">Impressions</th>
                  <th className="pb-3 font-medium">CTR</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {pages.map((p) => (
                  <tr key={p.page} className="border-b border-[#2a3f5f]/60">
                    <td className="max-w-md truncate py-2 pr-4 font-mono text-xs text-white">
                      {p.page}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{p.clicks}</td>
                    <td className="py-2 pr-4 tabular-nums">{p.impressions}</td>
                    <td className="py-2 tabular-nums">
                      {(p.ctr * 100).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
