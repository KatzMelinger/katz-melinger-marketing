"use client";

/**
 * Social Ops Hub / Trends
 *
 * Surfaces the two existing Claude-backed endpoints for social planning:
 *   - POST /api/content/intelligence/trends         → trending topics by practice area
 *   - POST /api/content/intelligence/social         → per-platform playbook
 *
 * This page is "Phase A" — the endpoints already existed but had no UI surface
 * on the Social Ops Hub. The banner at the top is honest about the limitation:
 * results are Claude's reasoning, not grounded in live platform signals.
 *
 * Phase B (planned, not built): replace these calls with a `social_trends`
 * table populated by daily cron jobs against paid scrapers (Apify for
 * IG/TikTok/FB, RapidAPI for LinkedIn) plus own-performance mining of
 * Metricool history. See the chat that introduced this page for the build plan.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { MarketingNav } from "@/components/marketing-nav";
import {
  DashCard,
  DashButton,
  DashInput,
  DashSelect,
  DashSpinner,
  DashPill,
} from "@/components/dashboard-ui";
import {
  clearTrendRuns,
  deleteTrendRun,
  listTrendRuns,
  saveTrendRun,
  TREND_RUNS_CHANGE_EVENT,
  type TrendRun,
} from "@/lib/recent-trends";
import {
  latestPlaybookRun,
  savePlaybookRun,
} from "@/lib/recent-playbooks";

type Tab = "trending" | "playbook";

type SocialPlatform =
  | "tiktok"
  | "instagram"
  | "linkedin"
  | "facebook"
  | "twitter"
  | "youtube_shorts";

type TrendRow = {
  topic: string;
  whyTrending: string;
  suggestedAngle: string;
  urgency: "hot" | "warm" | "evergreen";
  platforms: string[];
  sourceDate?: string | null;
};

const MONTHS_BACK_OPTIONS = [
  { value: 3, label: "Last 3 months" },
  { value: 6, label: "Last 6 months" },
  { value: 12, label: "Last 12 months" },
];

function trendDraftHref(t: TrendRow): string {
  const params = new URLSearchParams();
  params.set("topic", t.suggestedAngle || t.topic);
  if (t.suggestedAngle && t.suggestedAngle !== t.topic) {
    params.set("angle", t.suggestedAngle);
  }
  if (t.whyTrending) params.set("context", t.whyTrending);
  if (t.platforms && t.platforms.length > 0) {
    params.set("formats", t.platforms.join(","));
  }
  if (t.sourceDate) params.set("sourceDate", t.sourceDate);
  return `/content/batch?${params.toString()}`;
}

type SocialPlaybook = {
  hashtags?: { broad?: string[]; niche?: string[] };
  hooks?: string[];
  captions?: string[];
  best_times?: string;
  visual_ideas?: string[];
  platform_tips?: string[];
};

const PRACTICE_AREAS = [
  "All",
  "Employment Discrimination",
  "FMLA",
  "Wage & Hour Claims",
  "Wrongful Termination",
  "Sexual Harassment at Work",
  "Severance Negotiations",
  "Commercial Collections",
  "Judgment Enforcement",
];

function urgencyTone(u: string): "red" | "amber" | "emerald" {
  if (u === "hot") return "red";
  if (u === "warm") return "amber";
  return "emerald";
}

export default function SocialTrendsPage() {
  const [tab, setTab] = useState<Tab>("trending");

  // Trending state
  const [practiceArea, setPracticeArea] = useState("All");
  const [monthsBack, setMonthsBack] = useState<number>(6);
  const [trendMeta, setTrendMeta] = useState<{
    today?: string;
    cutoff?: string;
    monthsBack?: number;
    droppedStale?: number;
    droppedMissingDate?: number;
  } | null>(null);
  const [trends, setTrends] = useState<TrendRow[]>([]);

  // Playbook state
  const [socialTopic, setSocialTopic] = useState("");
  const [socialPlatform, setSocialPlatform] = useState<SocialPlatform>("linkedin");
  const [playbook, setPlaybook] = useState<SocialPlaybook | null>(null);

  // Shared state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Recent trend runs — shared localStorage with Content Studio.
  const [recentRuns, setRecentRuns] = useState<TrendRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setRecentRuns(listTrendRuns());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(TREND_RUNS_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(TREND_RUNS_CHANGE_EVENT, sync);
    };
  }, []);

  // Restore the last playbook on mount so navigating away doesn't lose it.
  useEffect(() => {
    const last = latestPlaybookRun();
    if (!last) return;
    setPlaybook(last.playbook);
    if (!socialTopic) setSocialTopic(last.topic);
    setSocialPlatform(last.platform as SocialPlatform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const fetchTrends = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/intelligence/trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practiceArea, monthsBack }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      const fresh = (data.trends ?? []) as TrendRow[];
      setTrends(fresh);
      setTrendMeta(data.meta ?? null);
      const saved = saveTrendRun({ practiceArea, monthsBack, trends: fresh });
      setActiveRunId(saved?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const loadRun = (run: TrendRun) => {
    setPracticeArea(run.practiceArea);
    if (typeof run.monthsBack === "number") setMonthsBack(run.monthsBack);
    setTrends(run.trends as TrendRow[]);
    setActiveRunId(run.id);
    setTrendMeta(null);
    setError(null);
  };

  const removeRun = (id: string) => {
    deleteTrendRun(id);
    if (activeRunId === id) {
      setActiveRunId(null);
      setTrends([]);
    }
  };

  const clearAllRuns = () => {
    clearTrendRuns();
    setActiveRunId(null);
    setTrends([]);
  };

  const fetchPlaybook = async () => {
    if (!socialTopic.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/intelligence/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: socialTopic.trim(),
          platform: socialPlatform,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      const next = data.playbook ?? null;
      setPlaybook(next);
      if (next) {
        savePlaybookRun({
          topic: socialTopic.trim(),
          platform: socialPlatform,
          playbook: next,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-white text-slate-900" style={{ fontFamily: "Arial, sans-serif" }}>
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">
            Social Ops Hub / Trends
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            Trends &amp; Playbooks
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            What to post about, on which platform, and how to frame it — generated
            against the firm&apos;s Brand Voice.
          </p>
        </div>

        {/* Honest disclaimer about current data source */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Heads up — these are AI-reasoned, not live signals.</p>
          <p className="mt-1 text-amber-800">
            Right now this page calls Claude to reason about what&apos;s trending in
            NY/NJ employment law and what&apos;s likely to perform on each platform.
            It does <span className="font-semibold">not</span> yet pull real-time
            data from LinkedIn / Instagram / TikTok / Facebook, and it doesn&apos;t
            mine your own Metricool history for what&apos;s actually working.
            That pipeline is the next build. Use this for fast inspiration; treat
            urgency tags as directional.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
          {[
            { id: "trending", label: "Trending topics" },
            { id: "playbook", label: "Per-platform playbook" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as Tab)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-[1px] ${
                tab === t.id
                  ? "border-rose-700 text-rose-700"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {tab === "trending" ? (
          <div className="space-y-4">
            <DashCard>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-48">
                  <label className="text-xs font-medium text-slate-700">
                    Practice area
                  </label>
                  <DashSelect
                    value={practiceArea}
                    onChange={(e) => setPracticeArea(e.target.value)}
                    className="w-full mt-1"
                  >
                    {PRACTICE_AREAS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </DashSelect>
                </div>
                <div className="min-w-48">
                  <label className="text-xs font-medium text-slate-700">
                    Recency
                  </label>
                  <DashSelect
                    value={String(monthsBack)}
                    onChange={(e) => setMonthsBack(Number(e.target.value))}
                    className="w-full mt-1"
                  >
                    {MONTHS_BACK_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </DashSelect>
                </div>
                <DashButton onClick={fetchTrends} disabled={loading}>
                  {loading ? <DashSpinner /> : "Find trending topics"}
                </DashButton>
              </div>
              {trendMeta?.cutoff ? (
                <p className="mt-3 text-xs text-slate-500">
                  Showing events on or after{" "}
                  <span className="font-medium text-slate-700">
                    {new Date(trendMeta.cutoff + "T00:00:00Z").toLocaleDateString(
                      undefined,
                      { year: "numeric", month: "short", day: "numeric" },
                    )}
                  </span>
                  {(trendMeta.droppedStale ?? 0) +
                    (trendMeta.droppedMissingDate ?? 0) >
                  0 ? (
                    <>
                      {" "}
                      · filtered out{" "}
                      {(trendMeta.droppedStale ?? 0) +
                        (trendMeta.droppedMissingDate ?? 0)}{" "}
                      stale / undated item(s)
                    </>
                  ) : null}
                </p>
              ) : null}
            </DashCard>

            {recentRuns.length > 0 ? (
              <DashCard>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Recent runs
                  </h3>
                  <button
                    type="button"
                    onClick={clearAllRuns}
                    className="text-xs text-slate-500 hover:text-red-700"
                  >
                    Clear all
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  Saved locally in your browser — shared with Content Studio.
                  Click a run to reopen its results.
                </p>
                <ul className="divide-y divide-slate-100">
                  {recentRuns.map((run) => {
                    const isActive = run.id === activeRunId;
                    const when = new Date(run.createdAt);
                    return (
                      <li
                        key={run.id}
                        className={`flex items-center justify-between gap-3 py-2 text-sm ${
                          isActive ? "bg-rose-50 -mx-2 px-2 rounded" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => loadRun(run)}
                          className="flex-1 text-left flex items-center gap-2 min-w-0"
                        >
                          <DashPill tone={isActive ? "red" : "neutral"}>
                            {run.practiceArea}
                          </DashPill>
                          <span className="text-xs text-slate-500 shrink-0">
                            {when.toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                          <span className="text-xs text-slate-600 truncate">
                            {run.trends.length} topic
                            {run.trends.length === 1 ? "" : "s"}
                            {run.trends[0]
                              ? ` · "${run.trends[0].topic}"`
                              : ""}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRun(run.id)}
                          className="shrink-0 text-xs text-slate-400 hover:text-red-700 px-1"
                          aria-label="Delete this run"
                          title="Delete this run"
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </DashCard>
            ) : null}

            {trends.length > 0 ? (
              <div className="space-y-3">
                {trends.map((t, i) => (
                  <DashCard key={i}>
                    <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-900">
                        {t.topic}
                      </h3>
                      <div className="flex items-center gap-1.5">
                        {t.sourceDate ? (
                          <span className="text-[11px] text-slate-500">
                            {new Date(t.sourceDate + "T00:00:00Z").toLocaleDateString(
                              undefined,
                              { year: "numeric", month: "short", day: "numeric" },
                            )}
                          </span>
                        ) : null}
                        <DashPill tone={urgencyTone(t.urgency)}>{t.urgency}</DashPill>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 mb-2">{t.whyTrending}</p>
                    <div className="bg-rose-50 border border-rose-200 rounded-md p-2 mb-2">
                      <span className="text-xs font-medium text-rose-700">
                        Suggested angle:
                      </span>
                      <p className="text-xs text-slate-700 mt-0.5">
                        {t.suggestedAngle}
                      </p>
                    </div>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex gap-1 flex-wrap">
                        {(t.platforms ?? []).map((p, j) => (
                          <DashPill key={j} tone="neutral">
                            {p}
                          </DashPill>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSocialTopic(t.suggestedAngle || t.topic);
                            setTab("playbook");
                          }}
                          className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-rose-700 hover:text-rose-700"
                        >
                          → Build playbook
                        </button>
                        <Link
                          href={trendDraftHref(t)}
                          className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-rose-700 hover:text-rose-700"
                        >
                          → Generate posts
                        </Link>
                      </div>
                    </div>
                  </DashCard>
                ))}
              </div>
            ) : (
              <DashCard>
                <p className="text-sm text-slate-500">
                  Pick a practice area and click <em>Find trending topics</em> to
                  get a fresh set of NY/NJ employment-law story angles with
                  urgency tags.
                </p>
              </DashCard>
            )}
          </div>
        ) : null}

        {tab === "playbook" ? (
          <div className="space-y-4">
            <DashCard>
              <p className="text-xs text-slate-500 mb-3">
                Generates a hashtag pack, video hooks, caption variants, best
                times, and visual ideas for one topic on one platform — all
                framed in your Brand Voice.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-700">
                    Topic / story angle
                  </label>
                  <DashInput
                    value={socialTopic}
                    onChange={(e) => setSocialTopic(e.target.value)}
                    placeholder="e.g. Why severance offers usually leave money on the table"
                    className="w-full mt-1"
                  />
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-48">
                    <label className="text-xs font-medium text-slate-700">
                      Platform
                    </label>
                    <DashSelect
                      value={socialPlatform}
                      onChange={(e) =>
                        setSocialPlatform(e.target.value as SocialPlatform)
                      }
                      className="w-full mt-1"
                    >
                      <option value="linkedin">LinkedIn</option>
                      <option value="instagram">Instagram (Reels + Feed)</option>
                      <option value="tiktok">TikTok</option>
                      <option value="facebook">Facebook</option>
                      <option value="twitter">X / Twitter</option>
                      <option value="youtube_shorts">YouTube Shorts</option>
                    </DashSelect>
                  </div>
                  <DashButton
                    onClick={fetchPlaybook}
                    disabled={loading || !socialTopic.trim()}
                  >
                    {loading ? <DashSpinner /> : "Generate playbook"}
                  </DashButton>
                </div>
              </div>
            </DashCard>

            {playbook ? (
              <div className="space-y-3">
                {playbook.hashtags ? (
                  <DashCard>
                    <h3 className="text-sm font-semibold mb-3">Hashtag pack</h3>
                    {playbook.hashtags.broad &&
                    playbook.hashtags.broad.length > 0 ? (
                      <div className="mb-3">
                        <div className="text-xs font-medium text-slate-700 mb-1">
                          Broad
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {playbook.hashtags.broad.map((h, i) => (
                            <DashPill key={i} tone="blue">
                              {h.startsWith("#") ? h : `#${h}`}
                            </DashPill>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {playbook.hashtags.niche &&
                    playbook.hashtags.niche.length > 0 ? (
                      <div>
                        <div className="text-xs font-medium text-slate-700 mb-1">
                          Niche / geo
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {playbook.hashtags.niche.map((h, i) => (
                            <DashPill key={i} tone="violet">
                              {h.startsWith("#") ? h : `#${h}`}
                            </DashPill>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        copy(
                          [
                            ...(playbook.hashtags?.broad ?? []),
                            ...(playbook.hashtags?.niche ?? []),
                          ]
                            .map((h) => (h.startsWith("#") ? h : `#${h}`))
                            .join(" "),
                          "hashtags",
                        )
                      }
                      className="mt-3 text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
                    >
                      {copied === "hashtags" ? "✓ Copied all" : "Copy all hashtags"}
                    </button>
                  </DashCard>
                ) : null}

                {playbook.hooks && playbook.hooks.length > 0 ? (
                  <DashCard>
                    <h3 className="text-sm font-semibold mb-2">Video hooks</h3>
                    <div className="space-y-2">
                      {playbook.hooks.map((h, i) => (
                        <div
                          key={i}
                          className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-3 flex items-start justify-between gap-2"
                        >
                          <span className="whitespace-pre-wrap">{h}</span>
                          <button
                            type="button"
                            onClick={() => copy(h, `hook-${i}`)}
                            className="shrink-0 text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
                          >
                            {copied === `hook-${i}` ? "✓" : "Copy"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </DashCard>
                ) : null}

                {playbook.captions && playbook.captions.length > 0 ? (
                  <DashCard>
                    <h3 className="text-sm font-semibold mb-2">Caption variants</h3>
                    <div className="space-y-2">
                      {playbook.captions.map((c, i) => (
                        <div
                          key={i}
                          className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-3 flex items-start justify-between gap-2"
                        >
                          <span className="whitespace-pre-wrap">{c}</span>
                          <button
                            type="button"
                            onClick={() => copy(c, `cap-${i}`)}
                            className="shrink-0 text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
                          >
                            {copied === `cap-${i}` ? "✓" : "Copy"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </DashCard>
                ) : null}

                {playbook.visual_ideas && playbook.visual_ideas.length > 0 ? (
                  <DashCard>
                    <h3 className="text-sm font-semibold mb-2">Visual treatment ideas</h3>
                    <ul className="space-y-2 text-sm text-slate-700">
                      {playbook.visual_ideas.map((v, i) => (
                        <li
                          key={i}
                          className="flex items-start justify-between gap-2 bg-slate-50 border border-slate-200 rounded-md p-3"
                        >
                          <span className="whitespace-pre-wrap">{v}</span>
                          <a
                            href={`/content/images?prompt=${encodeURIComponent(v)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400 hover:bg-white"
                          >
                            Create image
                          </a>
                        </li>
                      ))}
                    </ul>
                  </DashCard>
                ) : null}

                {playbook.platform_tips && playbook.platform_tips.length > 0 ? (
                  <DashCard>
                    <h3 className="text-sm font-semibold mb-2 text-emerald-700">
                      Platform tips
                    </h3>
                    <ul className="space-y-1 text-sm text-slate-700 list-disc pl-5">
                      {playbook.platform_tips.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </DashCard>
                ) : null}

                {playbook.best_times ? (
                  <DashCard>
                    <h3 className="text-sm font-semibold mb-2">Best times to post</h3>
                    <p className="text-sm text-slate-700">{playbook.best_times}</p>
                  </DashCard>
                ) : null}
              </div>
            ) : (
              <DashCard>
                <p className="text-sm text-slate-500">
                  Enter a topic and pick a platform to get a full playbook —
                  hashtags, hooks, captions, visuals, and timing.
                </p>
              </DashCard>
            )}
          </div>
        ) : null}

        {/* Roadmap footer */}
        <DashCard className="border-dashed">
          <h3 className="text-sm font-semibold text-slate-900">Coming next</h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-600 space-y-1">
            <li>
              <span className="font-medium text-slate-700">
                What&apos;s actually working for us:
              </span>{" "}
              mine Metricool history to surface your top posts by clicks /
              likes / saves / new-follower lift, and the patterns they share.
            </li>
            <li>
              <span className="font-medium text-slate-700">
                Real-time platform trends:
              </span>{" "}
              daily scan of LinkedIn / Instagram / TikTok / Facebook for trending
              hashtags + viral posts in employment-law and adjacent niches.
            </li>
            <li>
              <span className="font-medium text-slate-700">HubSpot inspiration:</span>{" "}
              ingest HubSpot&apos;s marketing research + blog patterns and surface
              the tactics applicable to a law firm.
            </li>
            <li>
              <span className="font-medium text-slate-700">Velocity alerts:</span>{" "}
              when a topic or competitor post spikes, route it into the existing
              alerts inbox so we can react within 24h.
            </li>
          </ul>
        </DashCard>
      </main>
    </div>
  );
}
