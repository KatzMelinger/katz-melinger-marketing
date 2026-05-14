"use client";

/**
 * AI Referrals — GA4-sourced view of sessions where users arrived from
 * an AI answer engine (ChatGPT, Claude, Perplexity, Gemini, Copilot,
 * You.com, Phind). This is one of the only direct AI-attribution signals
 * we can measure with off-the-shelf analytics — bot crawls (GPTBot,
 * ClaudeBot, etc.) need server-log access we'd have to wire separately.
 */

import { useEffect, useMemo, useState } from "react";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DashCard, DashShell, DashSpinner } from "@/components/dashboard-ui";
import { MarketingNav } from "@/components/marketing-nav";

type ReferralsPayload = {
  totals: {
    sessions: number;
    activeUsers: number;
    newUsers: number;
    conversions: number;
    engagementRate: number;
    averageSessionDuration: number;
  };
  bySource: Array<{
    source: string;
    sessions: number;
    activeUsers: number;
    newUsers: number;
    conversions: number;
  }>;
  byPage: Array<{ page: string; source: string; sessions: number; pageViews: number }>;
  byDay: Array<{ date: string; sessions: number }>;
  hosts: string[];
  error?: string;
};

function formatDate(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd;
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return `${m}/${d}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

const SOURCE_LABELS: Record<string, string> = {
  "chat.openai.com": "ChatGPT",
  "chatgpt.com": "ChatGPT",
  "claude.ai": "Claude",
  "perplexity.ai": "Perplexity",
  "www.perplexity.ai": "Perplexity",
  "gemini.google.com": "Gemini",
  "bard.google.com": "Gemini (Bard)",
  "copilot.microsoft.com": "Copilot",
  "you.com": "You.com",
  "phind.com": "Phind",
};

function prettySource(s: string): string {
  return SOURCE_LABELS[s.toLowerCase()] ?? s;
}

export default function AiReferralsPage() {
  const [data, setData] = useState<ReferralsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/google-analytics?action=ai-referrals", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ReferralsPayload & { error?: string }) => {
        if (d?.error) setError(d.error);
        setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const dayChart = useMemo(
    () => (data?.byDay ?? []).map((d) => ({ date: formatDate(d.date), sessions: d.sessions })),
    [data?.byDay],
  );

  const sourceChart = useMemo(
    () =>
      (data?.bySource ?? []).map((s) => ({
        name: prettySource(s.source),
        sessions: s.sessions,
      })),
    [data?.bySource],
  );

  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <MarketingNav />
      <DashShell>
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#185FA5]">
            AI Ops Hub / Referrals
          </p>
          <h1 className="mt-1 text-2xl font-semibold">AI engine referrals</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            Sessions on katzmelinger.com where the referrer is an AI answer engine. The clearest
            signal that AI search is sending real visitors — last 30 days.
          </p>
        </header>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {loading && !data && <DashSpinner />}

        {data && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile label="Sessions" value={data.totals.sessions.toLocaleString()} />
              <KpiTile label="Active users" value={data.totals.activeUsers.toLocaleString()} />
              <KpiTile label="New users" value={data.totals.newUsers.toLocaleString()} />
              <KpiTile label="Conversions" value={data.totals.conversions.toLocaleString()} />
            </section>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile
                label="Engagement rate"
                value={`${Math.round(data.totals.engagementRate * 100)}%`}
              />
              <KpiTile
                label="Avg session"
                value={formatDuration(data.totals.averageSessionDuration)}
              />
              <KpiTile
                label="Conversion rate"
                value={
                  data.totals.sessions > 0
                    ? `${((data.totals.conversions / data.totals.sessions) * 100).toFixed(1)}%`
                    : "—"
                }
              />
              <KpiTile
                label="AI sources detected"
                value={data.bySource.length.toString()}
                hint="Of 10 tracked engines"
              />
            </section>

            <DashCard>
              <h2 className="text-sm font-semibold mb-3">Daily AI-referred sessions</h2>
              {dayChart.length === 0 ? (
                <p className="text-xs text-slate-500">No AI-referred sessions in the last 30 days.</p>
              ) : (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dayChart}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#475569" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#475569" }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="sessions" stroke="#185FA5" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </DashCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <DashCard>
                <h2 className="text-sm font-semibold mb-3">Sessions by AI engine</h2>
                {sourceChart.length === 0 ? (
                  <p className="text-xs text-slate-500">No AI engines detected as referrers yet.</p>
                ) : (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={sourceChart}>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} />
                        <YAxis tick={{ fontSize: 11, fill: "#475569" }} />
                        <Tooltip />
                        <Bar dataKey="sessions" fill="#185FA5" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </DashCard>

              <DashCard>
                <h2 className="text-sm font-semibold mb-3">By source — detail</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="pb-2 pr-3 font-medium">Engine</th>
                        <th className="pb-2 pr-3 font-medium">Sessions</th>
                        <th className="pb-2 pr-3 font-medium">New users</th>
                        <th className="pb-2 font-medium">Conversions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bySource.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-3 text-slate-500">No data yet.</td>
                        </tr>
                      )}
                      {data.bySource.map((row) => (
                        <tr key={row.source} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 pr-3 text-slate-900">
                            {prettySource(row.source)}
                            <span className="ml-2 text-[10px] text-slate-400 font-mono">
                              {row.source}
                            </span>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {row.sessions.toLocaleString()}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {row.newUsers.toLocaleString()}
                          </td>
                          <td className="py-2 tabular-nums">{row.conversions.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DashCard>
            </div>

            <DashCard>
              <h2 className="text-sm font-semibold mb-3">Top pages AI engines send users to</h2>
              <p className="text-xs text-slate-500 mb-3">
                What pages users land on after clicking through from an AI answer. These are your
                AI-citation winners.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Page</th>
                      <th className="pb-2 pr-3 font-medium">Engine</th>
                      <th className="pb-2 pr-3 font-medium">Sessions</th>
                      <th className="pb-2 font-medium">Page views</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byPage.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-3 text-slate-500">No data yet.</td>
                      </tr>
                    )}
                    {data.byPage.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-3 text-slate-900 font-mono text-[11px]">
                          {row.page}
                        </td>
                        <td className="py-2 pr-3">{prettySource(row.source)}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {row.sessions.toLocaleString()}
                        </td>
                        <td className="py-2 tabular-nums">{row.pageViews.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashCard>

            <DashCard>
              <h2 className="text-sm font-semibold mb-2">About this data</h2>
              <p className="text-xs text-slate-600">
                Source: Google Analytics 4, last 30 days. Tracked referrer hosts:
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {data.hosts.map((h) => (
                  <li
                    key={h}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 font-mono"
                  >
                    {h}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                <b>Note:</b> AI bot crawls (GPTBot, ClaudeBot, PerplexityBot, etc.) are not in this
                view — GA4 strips bots by default. To track bot crawls, we'd need to enable Vercel
                Edge Middleware or Cloudflare log forwarding for katzmelinger.com.
              </p>
            </DashCard>
          </>
        )}
      </DashShell>
    </div>
  );
}

function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <DashCard>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </DashCard>
  );
}
