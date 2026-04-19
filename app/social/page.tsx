"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { MarketingNav } from "@/components/marketing-nav";

const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";
const PIE_COLORS = ["#185FA5", "#1D9E75", "#CA8A04", "#A855F7"];

type PlatformName = "Facebook" | "Instagram" | "Twitter" | "LinkedIn";

type SocialPayload = {
  connected: boolean;
  error?: string;
  overview: {
    platform: PlatformName;
    followers: number;
    engagementRate: number;
    postsThisMonth: number;
  }[];
  posts: {
    id: string;
    platform: PlatformName;
    title: string;
    publishedAt: string;
    impressions: number;
    engagements: number;
    clicks: number;
  }[];
  schedule: {
    id: string;
    platform: PlatformName;
    date: string;
    status: "scheduled" | "draft";
    content: string;
  }[];
  trend: { date: string; engagementRate: number; followers: number }[];
};

function fmtPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export default function SocialPage() {
  const [data, setData] = useState<SocialPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/social/metricool", { cache: "no-store" });
        const json = (await res.json()) as SocialPayload;
        if (cancelled) return;
        setData(json);
        setError(json.error ?? null);
      } catch {
        if (!cancelled) setError("Failed to load Metricool data");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const platformBreakdown = useMemo(
    () =>
      (data?.overview ?? []).map((row) => ({
        name: row.platform,
        value: row.followers,
      })),
    [data],
  );

  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Social Media Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Metricool integration for account health, posts, scheduling, and
            engagement analytics.
          </p>
        </div>

        {error ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100"
            style={{ backgroundColor: CARD }}
          >
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(data?.overview ?? []).map((row) => (
            <article
              key={row.platform}
              className="rounded-xl border border-white/5 p-5"
              style={{ backgroundColor: row.platform === "Instagram" ? "#166534" : ACCENT }}
            >
              <p className="text-sm text-white/90">{row.platform}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {row.followers.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-white/90">
                Engagement {fmtPct(row.engagementRate)} · Posts {row.postsThisMonth}
              </p>
            </article>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Engagement trend</h2>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.trend ?? []}>
                  <CartesianGrid stroke="#2a3f5f" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      color: "#fff",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="engagementRate"
                    stroke={ACCENT}
                    strokeWidth={2}
                    name="Engagement %"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Platform breakdown</h2>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={platformBreakdown}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={95}
                    label
                  >
                    {platformBreakdown.map((_, i) => (
                      <Cell key={`platform-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      color: "#fff",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section
          className="rounded-xl border p-6"
          style={{ backgroundColor: CARD, borderColor: BORDER }}
        >
          <h2 className="mb-4 text-lg font-semibold">Recent posts performance</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(data?.posts ?? []).map((post) => (
              <article
                key={post.id}
                className="rounded-lg border border-[#2a3f5f] p-4 text-sm"
              >
                <p className="font-semibold text-white">{post.title}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {post.platform} · {new Date(post.publishedAt).toLocaleDateString()}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-300">
                  <span>Imp: {post.impressions.toLocaleString()}</span>
                  <span>Eng: {post.engagements.toLocaleString()}</span>
                  <span>Clk: {post.clicks.toLocaleString()}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-4 text-lg font-semibold">Posting schedule calendar</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#2a3f5f] text-slate-400">
                    <th className="pb-3 pr-4 font-medium">Date</th>
                    <th className="pb-3 pr-4 font-medium">Platform</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 font-medium">Content</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {(data?.schedule ?? []).map((row) => (
                    <tr key={row.id} className="border-b border-[#2a3f5f]/60">
                      <td className="py-2 pr-4">
                        {new Date(row.date).toLocaleDateString()}
                      </td>
                      <td className="py-2 pr-4">{row.platform}</td>
                      <td className="py-2 pr-4 capitalize">{row.status}</td>
                      <td className="py-2">{row.content}</td>
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
            <h2 className="mb-4 text-lg font-semibold">Account followers by platform</h2>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.overview ?? []}>
                  <CartesianGrid stroke="#2a3f5f" strokeDasharray="3 3" />
                  <XAxis dataKey="platform" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: CARD,
                      border: `1px solid ${BORDER}`,
                      color: "#fff",
                    }}
                  />
                  <Bar dataKey="followers" fill={ACCENT} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section
          className="rounded-xl border border-dashed p-6"
          style={{ backgroundColor: CARD, borderColor: "#185FA5" }}
        >
          <h2 className="text-lg font-semibold text-white">
            Post creation interface
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Connect to Metricool API
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              readOnly
              value="Draft caption..."
              className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-300"
            />
            <input
              readOnly
              value="Select audience and schedule"
              className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-300"
            />
          </div>
        </section>
      </main>
    </div>
  );
}
