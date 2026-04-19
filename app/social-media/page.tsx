"use client";

/**
 * Social Media Studio — Metricool API (`https://api.metricool.com/v1`).
 * Server: `METRICOOL_ACCESS_TOKEN` (Bearer), optional `METRICOOL_API_KEY`, optional `METRICOOL_BLOG_ID`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
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

const BG = "#0f1729";
const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";

/** Background refresh interval (Metricool may rate-limit; keep moderate). */
const AUTO_REFRESH_MS = 60_000;

/** Practical limits for composer UI (Metricool posts inherit network rules). */
export const PLATFORM_LIMITS = {
  facebook: 5000,
  linkedin: 3000,
  twitter: 280,
} as const;

export type SocialPlatformKey = keyof typeof PLATFORM_LIMITS;

type TabId = "dashboard" | "schedule" | "analytics" | "tools";

/** Scheduled or draft post row normalized from Metricool `/posts`. */
export interface ScheduledPost {
  id: string;
  date: string;
  time: string;
  platforms: SocialPlatformKey[];
  content: string;
  status: "scheduled" | "draft";
}

export interface EngagementTotals {
  likes: number;
  shares: number;
  comments: number;
  reach: number;
  impressions: number;
}

export interface TrendPoint {
  week: string;
  reach: number;
  impressions: number;
  engagementRate: number;
}

export interface TopPost {
  id: string;
  platform: string;
  excerpt: string;
  engagementRate: number;
  likes: number;
  period: "week" | "month";
}

export interface HashtagRow {
  tag: string;
  posts: number;
  avgEngagement: number;
}

export interface BestTimeRow {
  platform: string;
  slots: string[];
}

export interface ContentTypeRow {
  type: "text" | "image" | "video";
  posts: number;
  avgEngagementRate: number;
}

export interface FollowerPoint {
  date: string;
  followers: number;
}

export interface DashboardKpis {
  scheduledThisWeek: number;
  blendedEngagementRate: number;
  reach7d: number;
  followerDelta30d: number;
}

export interface CalendarViewModel {
  year: number;
  month: number;
  label: string;
}

/** Payload from GET `/api/social-media/metricool` (normalized server-side). */
export interface SocialMediaDashboard {
  scheduled: ScheduledPost[];
  queue: ScheduledPost[];
  engagement: EngagementTotals;
  trend: TrendPoint[];
  bestPosts: TopPost[];
  hashtags: HashtagRow[];
  bestTimes: BestTimeRow[];
  contentTypes: ContentTypeRow[];
  followerGrowth: FollowerPoint[];
  dashboardKpis: DashboardKpis;
  calendarView: CalendarViewModel;
  warnings?: string[];
}

export interface MetricoolApiErrorJson {
  error?: string;
  connected?: boolean;
  retryAfter?: string | null;
  details?: unknown;
}

async function loadSocialMediaDashboard(): Promise<SocialMediaDashboard> {
  const res = await fetch("/api/social-media/metricool", { cache: "no-store" });
  const json = (await res.json()) as MetricoolApiErrorJson & Partial<SocialMediaDashboard>;

  if (res.status === 429) {
    const msg =
      json.error ??
      "Metricool rate limit reached. Wait and try again (see Retry-After if provided).";
    throw new Error(msg);
  }

  if (!res.ok) {
    const msg =
      typeof json.error === "string"
        ? json.error
        : `Metricool request failed (${res.status})`;
    throw new Error(msg);
  }

  const cal = json.calendarView;
  if (
    !cal ||
    typeof cal.year !== "number" ||
    typeof cal.month !== "number" ||
    typeof cal.label !== "string"
  ) {
    const now = new Date();
    json.calendarView = {
      year: now.getFullYear(),
      month: now.getMonth(),
      label: now.toLocaleString(undefined, { month: "long", year: "numeric" }),
    };
  }

  return json as SocialMediaDashboard;
}

function platformLabel(p: SocialPlatformKey): string {
  if (p === "facebook") return "Facebook";
  if (p === "linkedin") return "LinkedIn";
  return "X (Twitter)";
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function postsOnDate(isoDate: string, posts: ScheduledPost[]): ScheduledPost[] {
  return posts.filter((p) => p.date === isoDate);
}

/** Month grid — week starts Sunday */
function buildCalendarCells(
  year: number,
  monthIndex: number,
): { day: number | null; iso: string | null }[] {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: { day: number | null; iso: string | null }[] = [];
  for (let i = 0; i < startPad; i++) cells.push({ day: null, iso: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, iso });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, iso: null });
  return cells;
}

const LEGAL_HASHTAG_SUGGESTIONS = [
  "#EmploymentLaw",
  "#WageAndHour",
  "#FLSA",
  "#NYLaborLaw",
  "#WorkplaceRights",
  "#LaborLawyer",
];

export default function SocialMediaPage() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SocialMediaDashboard | null>(null);
  const [lastLoad, setLastLoad] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postFeedback, setPostFeedback] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [composerPlatform, setComposerPlatform] = useState<SocialPlatformKey>("linkedin");
  const [composerText, setComposerText] = useState("");
  const [toolsText, setToolsText] = useState(
    "New York employers: review your meal break policies before Q3 audits.",
  );
  const [toolsPlatforms, setToolsPlatforms] = useState<Record<SocialPlatformKey, boolean>>({
    facebook: true,
    linkedin: true,
    twitter: true,
  });

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (silent) setIsRefreshing(true);
    else {
      setLoading(true);
      setError(null);
      setWarnings(null);
    }
    try {
      const payload = await loadSocialMediaDashboard();
      setData(payload);
      setWarnings(payload.warnings ?? null);
      setLastLoad(new Date().toISOString());
      if (silent) setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load social data");
      if (!silent) setData(null);
    } finally {
      if (silent) setIsRefreshing(false);
      else setLoading(false);
    }
  }, []);

  const submitPost = useCallback(
    async (text: string, networks: SocialPlatformKey[], publishMode: "schedule" | "draft") => {
      const trimmed = text.trim();
      if (!trimmed || networks.length === 0) {
        setPostFeedback({
          type: "err",
          text: "Add post text and select at least one network.",
        });
        return;
      }
      setPostSubmitting(true);
      setPostFeedback(null);
      try {
        const res = await fetch("/api/social-media/metricool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: trimmed,
            networks,
            publishMode,
          }),
        });
        const json = (await res.json()) as MetricoolApiErrorJson & {
          success?: boolean;
        };

        if (res.status === 429) {
          setPostFeedback({
            type: "err",
            text:
              json.error ??
              "Metricool rate limit. Wait before posting again.",
          });
          return;
        }

        if (!res.ok) {
          setPostFeedback({
            type: "err",
            text:
              typeof json.error === "string"
                ? json.error
                : `Post failed (${res.status})`,
          });
          return;
        }

        setPostFeedback({ type: "ok", text: "Post submitted to Metricool." });
        await load();
      } catch (e) {
        setPostFeedback({
          type: "err",
          text: e instanceof Error ? e.message : "Request failed",
        });
      } finally {
        setPostSubmitting(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const calendarCells = useMemo(() => {
    if (!data?.calendarView) return [];
    return buildCalendarCells(data.calendarView.year, data.calendarView.month);
  }, [data?.calendarView]);
  const allScheduled = useMemo(() => {
    if (!data) return [];
    return [...data.scheduled, ...data.queue];
  }, [data]);

  const engagementBars = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Likes", value: data.engagement.likes },
      { name: "Shares", value: data.engagement.shares },
      { name: "Comments", value: data.engagement.comments },
    ];
  }, [data]);

  const trendChartData = useMemo(() => {
    if (!data?.trend?.length) {
      return [
        {
          week: "—",
          reach: 0,
          impressions: 0,
          engagementRate: 0,
        },
      ];
    }
    return data.trend;
  }, [data?.trend]);

  const charCount = composerText.length;
  const limit = PLATFORM_LIMITS[composerPlatform];
  const toolsCharCounts = useMemo(() => {
    const t = toolsText;
    return {
      facebook: Math.min(t.length, PLATFORM_LIMITS.facebook),
      linkedin: Math.min(t.length, PLATFORM_LIMITS.linkedin),
      twitter: Math.min(t.length, PLATFORM_LIMITS.twitter),
    };
  }, [toolsText]);

  const tabBtn = (id: TabId, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
        tab === id
          ? "bg-[#1a2540] text-white ring-1 ring-[#185FA5]/50"
          : "text-slate-400 hover:bg-[#1a2540]/60 hover:text-white"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: BG, fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Social Media</h1>
            <p className="mt-1 text-sm text-slate-400">
              Live data via Metricool API (server route). Configure tokens in environment.
              Auto-refresh every {Math.round(AUTO_REFRESH_MS / 1000)}s.
            </p>
            {lastLoad ? (
              <p className="mt-1 text-xs text-slate-500">
                Last loaded: {new Date(lastLoad).toLocaleString()}
                {isRefreshing ? (
                  <span className="ml-2 text-sky-400" aria-live="polite">
                    Updating…
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || isRefreshing}
            className="self-start rounded-md border border-[#2a3f5f] bg-[#0f1729] px-4 py-2 text-sm text-slate-200 hover:bg-[#1a2540] disabled:opacity-50"
          >
            {loading || isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-[#2a3f5f] pb-3">
          {tabBtn("dashboard", "Dashboard")}
          {tabBtn("schedule", "Schedule")}
          {tabBtn("analytics", "Analytics")}
          {tabBtn("tools", "Tools")}
        </div>

        {error ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100"
            style={{ backgroundColor: CARD }}
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {warnings && warnings.length > 0 ? (
          <div
            className="rounded-lg border border-sky-900/50 bg-sky-950/30 p-4 text-sm text-sky-100"
            role="status"
          >
            <p className="font-medium text-sky-200">Partial data / API notes</p>
            <ul className="mt-2 list-inside list-disc text-sky-100/90">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {loading && !data ? (
          <div
            className="rounded-xl border p-10 text-center text-slate-400"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <p aria-live="polite">Loading social media workspace…</p>
          </div>
        ) : null}

        {data && tab === "dashboard" ? (
          <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Scheduled this week",
                  value: data.dashboardKpis.scheduledThisWeek.toString(),
                  sub: "Across all networks",
                  bg: ACCENT,
                },
                {
                  label: "Blended engagement",
                  value: fmtPct(data.dashboardKpis.blendedEngagementRate),
                  sub: "Last 28 days",
                  bg: "#166534",
                },
                {
                  label: "Reach (7d)",
                  value: data.dashboardKpis.reach7d.toLocaleString(),
                  sub: "Organic + paid",
                  bg: "#7c3aed",
                },
                {
                  label: "Follower growth (30d)",
                  value: `+${data.dashboardKpis.followerDelta30d.toLocaleString()}`,
                  sub: "All platforms",
                  bg: "#b45309",
                },
              ].map((c) => (
                <article
                  key={c.label}
                  className="rounded-xl border border-white/5 p-5"
                  style={{ backgroundColor: c.bg }}
                >
                  <p className="text-sm text-white/90">{c.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</p>
                  <p className="mt-1 text-xs text-white/85">{c.sub}</p>
                </article>
              ))}
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Upcoming queue</h2>
                <ul className="space-y-3">
                  {data.scheduled.length === 0 ? (
                    <li className="text-sm text-slate-500">No scheduled posts in Metricool yet.</li>
                  ) : null}
                  {data.scheduled.slice(0, 4).map((p) => (
                    <li
                      key={p.id}
                      className="rounded-lg border border-[#2a3f5f]/80 bg-[#0f1729]/40 p-3 text-sm"
                    >
                      <div className="flex flex-wrap gap-2">
                        {p.platforms.map((pl) => (
                          <span
                            key={pl}
                            className="rounded bg-[#1a2540] px-2 py-0.5 text-xs text-slate-300"
                          >
                            {platformLabel(pl)}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-slate-200">{p.content}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {p.date} · {p.time}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>

              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Engagement snapshot</h2>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-slate-500">Likes</dt>
                    <dd className="text-lg font-semibold tabular-nums text-white">
                      {data.engagement.likes.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Comments</dt>
                    <dd className="text-lg font-semibold tabular-nums text-white">
                      {data.engagement.comments.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Shares</dt>
                    <dd className="text-lg font-semibold tabular-nums text-white">
                      {data.engagement.shares.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Impressions</dt>
                    <dd className="text-lg font-semibold tabular-nums text-white">
                      {data.engagement.impressions.toLocaleString()}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => setTab("analytics")}
                  className="mt-4 text-sm text-[#185FA5] hover:underline"
                >
                  Open full analytics →
                </button>
              </section>
            </div>
          </div>
        ) : null}

        {data && tab === "schedule" ? (
          <div className="space-y-6">
            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-2 text-lg font-semibold">
                Calendar — {data.calendarView.label}
              </h2>
              <p className="mb-4 text-xs text-slate-500">
                Scheduled and draft posts from Metricool `/posts` (mapped to this month).
              </p>
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="py-2 font-medium">
                    {d}
                  </div>
                ))}
                {calendarCells.map((cell, i) => {
                  if (cell.day === null || !cell.iso) {
                    return <div key={`empty-${i}`} className="min-h-[72px] rounded bg-[#0f1729]/30" />;
                  }
                  const dayPosts = postsOnDate(cell.iso, allScheduled);
                  return (
                    <div
                      key={cell.iso}
                      className="min-h-[72px] rounded border border-[#2a3f5f]/50 bg-[#0f1729]/50 p-1"
                    >
                      <div className="text-left text-sm font-medium text-slate-300">
                        {cell.day}
                      </div>
                      {dayPosts.length ? (
                        <div className="mt-1 space-y-0.5">
                          {dayPosts.slice(0, 2).map((p) => (
                            <div
                              key={p.id}
                              className="truncate rounded bg-[#185FA5]/25 px-1 py-0.5 text-[10px] text-slate-200"
                              title={p.content}
                            >
                              {p.platforms.map((pl) => platformLabel(pl)[0]).join("·")}
                            </div>
                          ))}
                          {dayPosts.length > 2 ? (
                            <p className="text-[10px] text-slate-500">
                              +{dayPosts.length - 2} more
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Post queue</h2>
                <ul className="space-y-3">
                  {data.queue.length === 0 ? (
                    <li className="text-sm text-slate-500">No drafts in queue.</li>
                  ) : null}
                  {data.queue.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-lg border border-dashed border-[#2a3f5f] p-3 text-sm"
                    >
                      <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs text-amber-100">
                        {p.status}
                      </span>
                      <p className="mt-2 text-slate-200">{p.content}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {p.date} {p.time}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>

              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-2 text-lg font-semibold">Quick composer</h2>
                <p className="mb-4 text-xs text-slate-500">
                  Facebook, LinkedIn, X — character limits shown for scheduling drafts.
                </p>
                <label className="block text-sm font-medium text-slate-300">Platform</label>
                <select
                  value={composerPlatform}
                  onChange={(e) =>
                    setComposerPlatform(e.target.value as SocialPlatformKey)
                  }
                  className="mt-1 w-full rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white"
                >
                  {(Object.keys(PLATFORM_LIMITS) as SocialPlatformKey[]).map((k) => (
                    <option key={k} value={k}>
                      {platformLabel(k)} (max {PLATFORM_LIMITS[k].toLocaleString()} chars)
                    </option>
                  ))}
                </select>
                <label className="mt-4 block text-sm font-medium text-slate-300">
                  Post body
                </label>
                <textarea
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  rows={6}
                  placeholder="Write your post…"
                  className="mt-1 w-full rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white"
                />
                <div className="mt-2 flex justify-between text-xs">
                  <span
                    className={
                      charCount > limit ? "text-rose-400" : "text-slate-500"
                    }
                  >
                    {charCount.toLocaleString()} / {limit.toLocaleString()}
                  </span>
                  <span className="text-slate-600">
                    {composerPlatform === "twitter"
                      ? "Short links count toward limit on X."
                      : "Formatting may reduce available characters when published."}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={postSubmitting || !composerText.trim()}
                  onClick={() =>
                    void submitPost(composerText, [composerPlatform], "schedule")
                  }
                  className="mt-4 rounded-md px-4 py-2 text-sm font-medium text-white ring-1 ring-[#185FA5]/50 disabled:opacity-50"
                  style={{ backgroundColor: ACCENT }}
                >
                  {postSubmitting ? "Sending…" : "Schedule via Metricool"}
                </button>
              </section>
            </div>
          </div>
        ) : null}

        {data && tab === "analytics" ? (
          <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <article
                className="rounded-xl border p-5"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <p className="text-sm text-slate-400">Total engagement</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                  {(
                    data.engagement.likes +
                    data.engagement.shares +
                    data.engagement.comments
                  ).toLocaleString()}
                </p>
                <p className="text-xs text-slate-500">Likes + shares + comments</p>
              </article>
              <article
                className="rounded-xl border p-5"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <p className="text-sm text-slate-400">Reach</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                  {data.engagement.reach.toLocaleString()}
                </p>
              </article>
              <article
                className="rounded-xl border p-5"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <p className="text-sm text-slate-400">Impressions</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                  {data.engagement.impressions.toLocaleString()}
                </p>
              </article>
              <article
                className="rounded-xl border p-5"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <p className="text-sm text-slate-400">Blended engagement rate</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-300">
                  {fmtPct(data.dashboardKpis.blendedEngagementRate)}
                </p>
              </article>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Reach & impressions trend</h2>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChartData}>
                      <CartesianGrid stroke="#2a3f5f" strokeDasharray="3 3" />
                      <XAxis dataKey="week" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: CARD,
                          border: `1px solid ${BORDER}`,
                          color: "#fff",
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="reach"
                        stroke={ACCENT}
                        name="Reach"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="impressions"
                        stroke="#1D9E75"
                        name="Impressions"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Engagement breakdown</h2>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={engagementBars}>
                      <CartesianGrid stroke="#2a3f5f" strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: CARD,
                          border: `1px solid ${BORDER}`,
                          color: "#fff",
                        }}
                      />
                      <Bar dataKey="value" fill={ACCENT} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">Best performing posts</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#2a3f5f] text-slate-400">
                      <th className="pb-3 pr-4 font-medium">Platform</th>
                      <th className="pb-3 pr-4 font-medium">Excerpt</th>
                      <th className="pb-3 pr-4 font-medium">Eng. rate</th>
                      <th className="pb-3 pr-4 font-medium">Likes</th>
                      <th className="pb-3 font-medium">Window</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-200">
                    {data.bestPosts.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-4 text-slate-500">
                          No post-level analytics returned yet.
                        </td>
                      </tr>
                    ) : null}
                    {data.bestPosts.map((p) => (
                      <tr key={p.id} className="border-b border-[#2a3f5f]/50">
                        <td className="py-2 pr-4">{p.platform}</td>
                        <td className="max-w-md py-2 pr-4 text-slate-300">{p.excerpt}</td>
                        <td className="py-2 pr-4 tabular-nums text-emerald-300">
                          {fmtPct(p.engagementRate)}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{p.likes}</td>
                        <td className="py-2 text-slate-500 capitalize">{p.period}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Follower growth</h2>
                {data.followerGrowth.length === 0 ? (
                  <p className="text-sm text-slate-500">No follower history in the summary payload.</p>
                ) : (
                  <div className="h-[240px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.followerGrowth}>
                        <CartesianGrid stroke="#2a3f5f" strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
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
                          dataKey="followers"
                          stroke="#A855F7"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>

              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Content type performance</h2>
                {data.contentTypes.length === 0 ? (
                  <p className="text-sm text-slate-500">No content-type breakdown from Metricool.</p>
                ) : null}
                <ul className="space-y-3">
                  {data.contentTypes.map((c) => (
                    <li
                      key={c.type}
                      className="flex items-center justify-between rounded-lg border border-[#2a3f5f]/60 px-3 py-2 text-sm"
                    >
                      <span className="capitalize text-slate-200">{c.type}</span>
                      <span className="text-slate-500">{c.posts} posts</span>
                      <span className="tabular-nums text-emerald-300">
                        {fmtPct(c.avgEngagementRate)} avg
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Hashtag performance</h2>
                {data.hashtags.length === 0 ? (
                  <p className="text-sm text-slate-500">No hashtag data in analytics summary.</p>
                ) : null}
                <ul className="space-y-2 text-sm">
                  {data.hashtags.map((h) => (
                    <li
                      key={h.tag}
                      className="flex justify-between rounded border border-[#2a3f5f]/50 px-3 py-2"
                    >
                      <span className="font-medium text-[#185FA5]">{h.tag}</span>
                      <span className="text-slate-400">{h.posts} uses</span>
                      <span className="tabular-nums text-slate-200">
                        {fmtPct(h.avgEngagement)} avg ER
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Best times to post</h2>
                {data.bestTimes.length === 0 ? (
                  <p className="text-sm text-slate-500">No optimal time slots in the summary response.</p>
                ) : null}
                <ul className="space-y-3 text-sm text-slate-300">
                  {data.bestTimes.map((b) => (
                    <li key={b.platform}>
                      <p className="font-medium text-white">{b.platform}</p>
                      <ul className="mt-1 list-inside list-disc text-slate-400">
                        {b.slots.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        ) : null}

        {data && tab === "tools" ? (
          <div className="space-y-6">
            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-2 text-lg font-semibold">Multi-platform composer</h2>
              <p className="mb-4 text-xs text-slate-500">
                Select networks, attach creative, then preview before publishing via Metricool.
              </p>
              <div className="mb-4 flex flex-wrap gap-3">
                {(Object.keys(PLATFORM_LIMITS) as SocialPlatformKey[]).map((k) => (
                  <label
                    key={k}
                    className="flex cursor-pointer items-center gap-2 text-sm text-slate-300"
                  >
                    <input
                      type="checkbox"
                      checked={toolsPlatforms[k]}
                      onChange={(e) =>
                        setToolsPlatforms((prev) => ({
                          ...prev,
                          [k]: e.target.checked,
                        }))
                      }
                      className="rounded border-[#2a3f5f] bg-[#0f1729] text-[#185FA5]"
                    />
                    {platformLabel(k)}
                  </label>
                ))}
              </div>
              <textarea
                value={toolsText}
                onChange={(e) => setToolsText(e.target.value)}
                rows={5}
                className="w-full rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white"
              />
              <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                <span>
                  Facebook: {toolsCharCounts.facebook}/{PLATFORM_LIMITS.facebook}
                </span>
                <span>
                  LinkedIn: {toolsCharCounts.linkedin}/{PLATFORM_LIMITS.linkedin}
                </span>
                <span>
                  X: {toolsCharCounts.twitter}/{PLATFORM_LIMITS.twitter}
                </span>
              </div>
            </section>

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">Media</h2>
              <p className="mb-3 text-xs text-slate-500">
                Image upload & crop — wire to storage + Metricool after backend is ready.
              </p>
              <input
                type="file"
                accept="image/*"
                disabled
                className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-md file:border-0 file:bg-[#1a2540] file:px-3 file:py-2 file:text-slate-200"
              />
            </section>

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">Hashtag suggestions (legal)</h2>
              <div className="flex flex-wrap gap-2">
                {LEGAL_HASHTAG_SUGGESTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setToolsText((prev) =>
                        prev.includes(tag) ? prev : `${prev.trim()} ${tag}`.trim(),
                      )
                    }
                    className="rounded-full border border-[#2a3f5f] bg-[#0f1729] px-3 py-1 text-xs text-[#185FA5] hover:bg-[#1a2540]"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </section>

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">Preview by platform</h2>
              <div className="grid gap-4 md:grid-cols-3">
                {toolsPlatforms.facebook ? (
                  <div className="rounded-lg border border-[#2a3f5f] bg-[#0f1729] p-3">
                    <p className="text-xs font-semibold text-slate-400">Facebook</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">
                      {toolsText.slice(0, PLATFORM_LIMITS.facebook)}
                    </p>
                    <p className="mt-2 text-[10px] text-slate-600">
                      {Math.min(toolsText.length, PLATFORM_LIMITS.facebook)}/
                      {PLATFORM_LIMITS.facebook} chars
                    </p>
                  </div>
                ) : null}
                {toolsPlatforms.linkedin ? (
                  <div className="rounded-lg border border-[#2a3f5f] bg-[#0f1729] p-3">
                    <p className="text-xs font-semibold text-slate-400">LinkedIn</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">
                      {toolsText.slice(0, PLATFORM_LIMITS.linkedin)}
                    </p>
                    <p className="mt-2 text-[10px] text-slate-600">
                      {Math.min(toolsText.length, PLATFORM_LIMITS.linkedin)}/
                      {PLATFORM_LIMITS.linkedin} chars
                    </p>
                  </div>
                ) : null}
                {toolsPlatforms.twitter ? (
                  <div className="rounded-lg border border-[#2a3f5f] bg-[#0f1729] p-3">
                    <p className="text-xs font-semibold text-slate-400">X (Twitter)</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">
                      {toolsText.slice(0, PLATFORM_LIMITS.twitter)}
                    </p>
                    <p className="mt-2 text-[10px] text-slate-600">
                      {Math.min(toolsText.length, PLATFORM_LIMITS.twitter)}/
                      {PLATFORM_LIMITS.twitter} chars
                    </p>
                  </div>
                ) : null}
              </div>
              {!toolsPlatforms.facebook &&
              !toolsPlatforms.linkedin &&
              !toolsPlatforms.twitter ? (
                <p className="text-sm text-slate-500">Select at least one platform above.</p>
              ) : null}
              {postFeedback ? (
                <div
                  className={`mt-4 rounded-lg border p-3 text-sm ${
                    postFeedback.type === "ok"
                      ? "border-emerald-900/50 bg-emerald-950/30 text-emerald-100"
                      : "border-red-900/50 bg-red-950/40 text-red-100"
                  }`}
                  role={postFeedback.type === "ok" ? "status" : "alert"}
                >
                  {postFeedback.text}
                </div>
              ) : null}
              <button
                type="button"
                disabled={
                  postSubmitting ||
                  !toolsText.trim() ||
                  (!toolsPlatforms.facebook &&
                    !toolsPlatforms.linkedin &&
                    !toolsPlatforms.twitter)
                }
                onClick={() =>
                  void submitPost(
                    toolsText,
                    (Object.keys(toolsPlatforms) as SocialPlatformKey[]).filter(
                      (k) => toolsPlatforms[k],
                    ),
                    "schedule",
                  )
                }
                className="mt-6 rounded-md px-4 py-2 text-sm font-medium text-white ring-1 ring-[#185FA5]/50 disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {postSubmitting ? "Publishing…" : "Publish via Metricool"}
              </button>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
