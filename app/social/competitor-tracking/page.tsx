"use client";

/**
 * Social Ops Hub / Competitor Tracking  (Screen 6)
 *
 * Tracks competitor law-firm accounts on Instagram + LinkedIn, with a
 * head-to-head comparison against Katz Melinger and a key-insight box. Reads
 * GET /api/social/competitors (Metricool). Competitors are configured in
 * Metricool (Settings → Competitors); until then this shows our own stats and
 * a guided empty state. Metricool refreshes competitor data ~daily.
 */

import { useEffect, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";
import { DashCard, DashSpinner } from "@/components/dashboard-ui";

type Competitor = {
  network: string;
  name: string;
  username: string;
  picture: string | null;
  followers: number;
  posts: number;
  engagementRate: number;
  topFormat: string | null;
};
type Me = { followers: number; posts: number; engagementRate: number } | null;

type Payload = {
  connected: boolean;
  error?: string;
  instagram: Competitor[];
  linkedin: Competitor[];
  me: { instagram?: Me; linkedin?: Me };
};

type Net = "instagram" | "linkedin";
const ACCENT = "#116AB2";
const NET_COLOR: Record<Net, string> = { instagram: "#C13584", linkedin: "#0A66C2" };

function fmt(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}

export default function CompetitorTrackingPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [net, setNet] = useState<Net>("instagram");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/social/competitors", { cache: "no-store" });
        const json = (await res.json()) as Payload;
        if (cancelled) return;
        if (json.error) setError(json.error);
        setData(json);
      } catch {
        if (!cancelled) setError("Failed to load competitors.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const competitors = net === "instagram" ? data?.instagram ?? [] : data?.linkedin ?? [];
  const me = (net === "instagram" ? data?.me?.instagram : data?.me?.linkedin) ?? null;

  // Key insight: how our engagement rate compares to the competitor average.
  let insight: string | null = null;
  if (me && competitors.length > 0) {
    const avg = competitors.reduce((s, c) => s + c.engagementRate, 0) / competitors.length;
    if (avg > 0) {
      const ratio = me.engagementRate / avg;
      insight =
        ratio >= 1
          ? `Katz Melinger leads on engagement rate by ${ratio.toFixed(1)}× the competitor average (${me.engagementRate}% vs ${avg.toFixed(2)}%).`
          : `Competitors average ${avg.toFixed(2)}% engagement vs our ${me.engagementRate}% — room to close the gap.`;
    }
  }

  return (
    <div className="min-h-full text-slate-900" style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}>
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">Social Ops Hub / Competitor Tracking</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Competitor Tracking</h1>
            <p className="mt-1 text-sm text-slate-500">Benchmark competitor law-firm accounts against Katz Melinger. Refreshes daily.</p>
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-[#e2e8f0]">
            {(["instagram", "linkedin"] as Net[]).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNet(n)}
                className="px-3 py-1.5 text-sm font-medium capitalize"
                style={net === n ? { backgroundColor: ACCENT, color: "#fff" } : { backgroundColor: "#fff", color: "#475569" }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{error}</p> : null}

        {data === null ? (
          <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
            <DashSpinner /> Loading competitors…
          </div>
        ) : competitors.length === 0 ? (
          <EmptyState net={net} me={me} />
        ) : (
          <>
            {insight ? (
              <div className="rounded-xl border-l-4 p-4" style={{ borderColor: NET_COLOR[net], backgroundColor: "#f8fafc" }}>
                <p className="text-sm font-semibold text-slate-800">Key insight</p>
                <p className="mt-1 text-sm text-slate-600">{insight}</p>
              </div>
            ) : null}

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {competitors.map((c) => (
                <article key={c.username || c.name} className="rounded-xl border border-[#e2e8f0] p-4">
                  <p className="font-semibold text-slate-900">{c.name}</p>
                  {c.username ? <p className="text-xs text-slate-400">@{c.username}</p> : null}
                  <div className="mt-3 space-y-1.5 text-sm">
                    <Row label="Followers" value={fmt(c.followers)} />
                    <Row label="Posts" value={String(c.posts)} />
                    <Row label="Engagement rate" value={`${c.engagementRate}%`} />
                    {c.topFormat ? <Row label="Top format" value={c.topFormat} /> : null}
                  </div>
                </article>
              ))}
            </section>

            {/* Head-to-head */}
            <DashCard>
              <h2 className="text-lg font-semibold text-slate-900">Head-to-head vs Katz Melinger</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#e2e8f0] text-slate-500">
                      <th className="pb-2 pr-4 font-medium">Account</th>
                      <th className="pb-2 pr-4 font-medium">Followers</th>
                      <th className="pb-2 pr-4 font-medium">Posts</th>
                      <th className="pb-2 font-medium">Engagement rate</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700">
                    {me ? (
                      <tr className="border-b border-[#e2e8f0]/60 font-semibold" style={{ backgroundColor: "#eff6ff" }}>
                        <td className="py-2 pr-4">Katz Melinger</td>
                        <td className="py-2 pr-4 tabular-nums">{fmt(me.followers)}</td>
                        <td className="py-2 pr-4 tabular-nums">{me.posts}</td>
                        <td className="py-2 tabular-nums">{me.engagementRate}%</td>
                      </tr>
                    ) : null}
                    {competitors.map((c) => (
                      <tr key={c.username || c.name} className="border-b border-[#e2e8f0]/60">
                        <td className="py-2 pr-4">{c.name}</td>
                        <td className="py-2 pr-4 tabular-nums">{fmt(c.followers)}</td>
                        <td className="py-2 pr-4 tabular-nums">{c.posts}</td>
                        <td className="py-2 tabular-nums">{c.engagementRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashCard>
          </>
        )}
      </main>
    </div>
  );
}

function EmptyState({ net, me }: { net: Net; me: Me }) {
  return (
    <DashCard>
      <div className="rounded-lg border border-dashed border-[#cbd5e1] p-8 text-center">
        <p className="text-sm font-medium text-slate-700">No {net} competitors tracked yet</p>
        <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
          Add 2–3 competitor law-firm accounts in Metricool (Settings → Competitors). They&apos;ll appear here
          with followers, posting frequency, engagement, and a head-to-head against Katz Melinger. Metricool
          refreshes the data about once a day.
        </p>
      </div>
      {me ? (
        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-700">Your {net} baseline (for comparison once competitors are added)</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <Stat label="Followers" value={fmt(me.followers)} />
            <Stat label="Posts (30d)" value={String(me.posts)} />
            <Stat label="Engagement rate" value={`${me.engagementRate}%`} />
          </div>
        </div>
      ) : null}
    </DashCard>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums text-slate-900">{value}</span>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
