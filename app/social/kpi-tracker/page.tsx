"use client";

/**
 * Social Ops Hub / KPI Tracker  (Screen 2)
 *
 * Four summary cards (reach, engagement rate, followers, posts — last 30 days)
 * plus a per-channel breakdown with each channel's specific metric. Reads
 * GET /api/social/kpi (Metricool-backed). Profile/website clicks aren't exposed
 * by Metricool's post API, so we're transparent about that rather than faking it.
 */

import { useEffect, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";
import { DashCard, DashSpinner } from "@/components/dashboard-ui";

type Channel = {
  network: string;
  key: string;
  followers: number;
  reach: number;
  impressions: number;
  engagement: number;
  engagementRate: number;
  posts: number;
  saved: number;
  shares: number;
  views: number;
};

type Payload = {
  connected: boolean;
  error?: string;
  summary?: {
    totalReach: number;
    totalImpressions: number;
    totalEngagement: number;
    totalFollowers: number;
    totalPosts: number;
    engagementRate: number;
  };
  channels: Channel[];
};

const ACCENT = "#116AB2";
const CHANNEL_COLOR: Record<string, string> = {
  instagram: "#C13584",
  facebook: "#1877F2",
  linkedin: "#0A66C2",
  tiktok: "#111827",
  twitter: "#0F172A",
};

// The channel-specific metric each network leads with (per spec). Clicks aren't
// exposed by Metricool's API, so LinkedIn/Facebook fall back to impressions.
function highlightFor(c: Channel): { label: string; value: number } {
  switch (c.key) {
    case "instagram":
      return { label: "Saves", value: c.saved };
    case "tiktok":
      return { label: "Shares", value: c.shares };
    case "linkedin":
      return { label: "Impressions", value: c.impressions };
    case "facebook":
      return { label: "Impressions", value: c.impressions };
    default:
      return { label: "Engagement", value: c.engagement };
  }
}

function fmt(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}

export default function KpiTrackerPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/social/kpi", { cache: "no-store" });
        const json = (await res.json()) as Payload;
        if (cancelled) return;
        if (json.error) setError(json.error);
        setData(json);
      } catch {
        if (!cancelled) setError("Failed to load KPIs.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const s = data?.summary;
  const cards = [
    { label: "Total reach", value: s ? fmt(s.totalReach) : "—", hint: "Last 30 days" },
    { label: "Engagement rate", value: s ? `${s.engagementRate}%` : "—", hint: "Engagement ÷ reach" },
    { label: "Followers", value: s ? fmt(s.totalFollowers) : "—", hint: "All channels" },
    { label: "Posts", value: s ? String(s.totalPosts) : "—", hint: "Last 30 days" },
  ];

  return (
    <div className="min-h-full text-slate-900" style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}>
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">Social Ops Hub / KPI Tracker</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">KPI Tracker</h1>
          <p className="mt-1 text-sm text-slate-500">Reach, engagement, and growth across all channels — last 30 days.</p>
        </div>

        {error ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{error}</p>
        ) : null}

        {data === null ? (
          <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
            <DashSpinner /> Loading KPIs…
          </div>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {cards.map((c) => (
                <article key={c.label} className="rounded-xl border border-[#e2e8f0] p-5" style={{ backgroundColor: "#fff" }}>
                  <p className="text-sm text-slate-500">{c.label}</p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{c.value}</p>
                  <p className="mt-1 text-xs text-slate-400">{c.hint}</p>
                </article>
              ))}
            </section>

            <p className="text-xs text-slate-400">
              Profile clicks and website clicks aren&apos;t exposed by Metricool&apos;s post analytics API, so they&apos;re omitted here.
            </p>

            <DashCard>
              <h2 className="text-lg font-semibold text-slate-900">Per-channel breakdown</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {data.channels.length === 0 ? (
                  <p className="text-sm text-slate-500">No channel data returned from Metricool.</p>
                ) : (
                  data.channels.map((c) => {
                    const hl = highlightFor(c);
                    const color = CHANNEL_COLOR[c.key] ?? "#64748B";
                    return (
                      <article key={c.key} className="overflow-hidden rounded-xl border border-[#e2e8f0]">
                        <div className="px-4 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: color }}>
                          {c.network}
                        </div>
                        <div className="space-y-2 p-4 text-sm">
                          <Row label="Followers" value={fmt(c.followers)} />
                          <Row label="Reach" value={fmt(c.reach)} />
                          <Row label="Engagement rate" value={`${c.engagementRate}%`} />
                          <Row label={hl.label} value={fmt(hl.value)} highlight color={color} />
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </DashCard>
          </>
        )}
      </main>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
  color,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums" style={highlight ? { color } : { color: "#0f172a" }}>
        {value}
      </span>
    </div>
  );
}
