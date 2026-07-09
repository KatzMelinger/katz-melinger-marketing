"use client";

/**
 * Social Ops Hub / Hashtag Performance  (Screen 5)
 *
 * Two columns — top-performing tags (ranked by the reach they drove for us) vs
 * generic/over-competitive tags worth replacing — plus a suggested set for the
 * next post. Reads GET /api/social/hashtags (own-attribution from our Instagram
 * captions + Metricool's global volume list for the competitiveness signal).
 */

import { useEffect, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";
import { DashCard, DashSpinner } from "@/components/dashboard-ui";

type TagStat = {
  tag: string;
  uses: number;
  totalReach: number;
  avgReach: number;
  avgEngagement: number;
  globalVolume: number | null;
  overCompetitive: boolean;
};

type Payload = {
  connected: boolean;
  error?: string;
  postsAnalyzed?: number;
  windowDays?: number;
  topTags: TagStat[];
  lowTags: TagStat[];
  suggested: string[];
};

const ACCENT = "#116AB2";

function fmt(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}
function fmtVolume(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export default function HashtagPerformancePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/social/hashtags", { cache: "no-store" });
        const json = (await res.json()) as Payload;
        if (cancelled) return;
        if (json.error) setError(json.error);
        setData(json);
      } catch {
        if (!cancelled) setError("Failed to load hashtag data.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestedStr = (data?.suggested ?? []).map((t) => `#${t}`).join(" ");

  return (
    <div className="min-h-full text-slate-900" style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}>
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">Social Ops Hub / Hashtag Performance</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Hashtag Performance</h1>
          <p className="mt-1 text-sm text-slate-500">
            Which tags actually drive reach on Instagram, and which generic ones to drop.
            {data?.postsAnalyzed != null ? ` Based on ${data.postsAnalyzed} posts over ${data.windowDays} days.` : ""}
          </p>
        </div>

        {error ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{error}</p>
        ) : null}

        {data === null ? (
          <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
            <DashSpinner /> Loading hashtags…
          </div>
        ) : (
          <>
            {/* Suggested set */}
            <DashCard>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Suggested set for your next post</h2>
                  <p className="mt-1 text-sm text-slate-500">Your best niche performers — high reach, low competition.</p>
                </div>
                {suggestedStr ? (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(suggestedStr);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-white"
                    style={{ backgroundColor: ACCENT }}
                  >
                    {copied ? "Copied!" : "Copy set"}
                  </button>
                ) : null}
              </div>
              {suggestedStr ? (
                <p className="mt-3 rounded-lg border border-[#e2e8f0] bg-slate-50 p-3 text-sm font-medium text-slate-700">
                  {suggestedStr}
                </p>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Not enough post history yet to suggest a set.</p>
              )}
            </DashCard>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Top performing */}
              <DashCard>
                <h2 className="text-lg font-semibold text-slate-900">Top performing</h2>
                <p className="mt-1 text-sm text-slate-500">Ranked by average reach driven per use.</p>
                <div className="mt-4 space-y-2">
                  {data.topTags.length === 0 ? (
                    <p className="text-sm text-slate-500">No tagged posts found in the window.</p>
                  ) : (
                    data.topTags.map((t) => (
                      <div key={t.tag} className="flex items-center justify-between rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm">
                        <span className="font-medium text-slate-800">#{t.tag}</span>
                        <span className="flex items-center gap-3 text-xs text-slate-500">
                          <span className="tabular-nums">{t.uses}× used</span>
                          <span className="rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 tabular-nums">
                            {fmt(t.avgReach)} avg reach
                          </span>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </DashCard>

              {/* Low reach / replace */}
              <DashCard>
                <h2 className="text-lg font-semibold text-slate-900">Too competitive — replace</h2>
                <p className="mt-1 text-sm text-slate-500">Generic tags saturated with millions of posts.</p>
                <div className="mt-4 space-y-2">
                  {data.lowTags.length === 0 ? (
                    <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                      None — you&apos;re already using niche tags rather than over-competitive generic ones. Nice.
                    </p>
                  ) : (
                    data.lowTags.map((t) => (
                      <div key={t.tag} className="flex items-center justify-between rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm">
                        <span className="font-medium text-slate-800">#{t.tag}</span>
                        <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600 tabular-nums">
                          {fmtVolume(t.globalVolume)} posts
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </DashCard>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
