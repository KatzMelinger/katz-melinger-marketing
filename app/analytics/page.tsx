"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { GoogleServiceAccountSetup } from "@/components/google-service-account-setup";
import { MarketingNav } from "@/components/marketing-nav";

const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";

const PIE_COLORS = ["#185FA5", "#1D9E75", "#CA8A04", "#A855F7", "#64748b"];

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function formatGaDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}`;
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<{
    sessions: number;
    activeUsers: number;
    newUsers: number;
    bounceRate: number;
    averageSessionDuration: number;
    screenPageViews: number;
    segments?: { name: string; sessions: number }[];
    segmentWarning?: string;
    error?: string;
  } | null>(null);
  const [days, setDays] = useState<
    { date: string; sessions: number; activeUsers: number }[]
  >([]);
  const [sources, setSources] = useState<{ name: string; sessions: number }[]>(
    [],
  );
  const [pages, setPages] = useState<
    { pagePath: string; screenPageViews: number; averageSessionDuration: number }[]
  >([]);
  const [segments, setSegments] = useState<
    { name: string; sessions: number }[]
  >([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const setup = (await fetch("/api/google-service-account/status").then((r) =>
          r.json(),
        )) as { configured?: boolean };
        if (cancelled) return;
        if (!setup.configured) {
          setSetupRequired(true);
          setLoadErr(null);
          return;
        }

        const [o, t, p] = await Promise.all([
          fetch("/api/google-analytics?action=overview").then((r) => r.json()),
          fetch("/api/google-analytics?action=traffic").then((r) => r.json()),
          fetch("/api/google-analytics?action=pages").then((r) => r.json()),
        ]);
        if (cancelled) return;
        setOverview(o);
        setDays(Array.isArray(t.days) ? t.days : []);
        setSources(Array.isArray(t.sources) ? t.sources : []);
        setPages(Array.isArray(p.pages) ? p.pages : []);
        setSegments(Array.isArray(o.segments) ? o.segments : []);
        const errs = [
          o.error,
          t.error,
          p.error,
          o.segmentWarning,
        ].filter(Boolean);
        setSetupRequired(false);
        if (errs.length) setLoadErr(errs.join(" · "));
      } catch {
        if (!cancelled) setLoadErr("Failed to load analytics");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const chartDays = days.map((x) => ({
    ...x,
    label: formatGaDate(x.date),
  }));

  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Google Analytics 4
          </h1>
          <p className="mt-1 text-sm text-slate-400">Last 30 days</p>
        </div>

        {loadErr ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100"
            style={{ backgroundColor: CARD }}
          >
            {loadErr}
          </div>
        ) : null}

        {setupRequired ? (
          <GoogleServiceAccountSetup contextLabel="GA4 reporting" />
        ) : null}

        {!setupRequired ? (
          <>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Sessions",
              value: overview?.sessions ?? "—",
              bg: ACCENT,
            },
            {
              label: "Users",
              value: overview?.activeUsers ?? "—",
              bg: "#166534",
            },
            {
              label: "Page views",
              value: overview?.screenPageViews ?? "—",
              bg: "#b45309",
            },
            {
              label: "Bounce rate",
              value:
                overview?.bounceRate != null && Number.isFinite(overview.bounceRate)
                  ? `${(overview.bounceRate * 100).toFixed(1)}%`
                  : "—",
              bg: "#475569",
            },
          ].map((c) => (
            <article
              key={c.label}
              className="rounded-xl border border-white/5 p-5"
              style={{ backgroundColor: c.bg }}
            >
              <p className="text-sm text-white/90">{c.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {c.value}
              </p>
            </article>
          ))}
        </section>

        <section
          className="rounded-xl border p-6"
          style={{ backgroundColor: CARD, borderColor: BORDER }}
        >
          <h2 className="mb-4 text-lg font-semibold">Sessions by day</h2>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartDays}>
                <CartesianGrid stroke="#2a3f5f" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: CARD,
                    border: `1px solid ${BORDER}`,
                    color: "#fff",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="sessions"
                  stroke={ACCENT}
                  fill={ACCENT}
                  fillOpacity={0.25}
                  name="Sessions"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Traffic sources</h2>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sources} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke="#2a3f5f" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      color: "#fff",
                    }}
                  />
                  <Bar dataKey="sessions" fill={ACCENT} name="Sessions" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">
              New vs returning users
            </h2>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={segments}
                    dataKey="sessions"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, percent }) =>
                      `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                  >
                    {segments.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      color: "#fff",
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section
          className="rounded-xl border p-6"
          style={{ backgroundColor: CARD, borderColor: BORDER }}
        >
          <h2 className="mb-4 text-lg font-semibold">Top pages</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b text-slate-400" style={{ borderColor: BORDER }}>
                  <th className="pb-3 pr-4 font-medium">Page path</th>
                  <th className="pb-3 pr-4 font-medium">Views</th>
                  <th className="pb-3 font-medium">Avg duration</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {pages.map((row) => (
                  <tr
                    key={row.pagePath}
                    className="border-b border-[#2a3f5f]/60"
                  >
                    <td className="py-2 pr-4 font-mono text-xs text-white">
                      {row.pagePath}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {row.screenPageViews}
                    </td>
                    <td className="py-2 tabular-nums">
                      {fmtDuration(row.averageSessionDuration)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
