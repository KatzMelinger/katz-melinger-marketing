/**
 * GET /api/social/best-time  — Screen 4 (Best Time to Post)
 *
 * Metricool's native best-time endpoint isn't exposed on this account's API, so
 * we compute the engagement heatmap ourselves from post history: each post's
 * publish timestamp (converted to America/New_York) is bucketed into a
 * weekday × hour grid, scored by the average engagement of posts in that slot.
 *
 * Window defaults to 180 days for more signal. At low posting volume many cells
 * will be empty — the response includes per-cell `count` so the UI can show
 * confidence and we never present a slot backed by a single post as gospel.
 */

import { NextResponse } from "next/server";

import { getPosts } from "@/lib/metricool";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NETWORKS = ["instagram", "facebook", "linkedin", "tiktok"] as const;
const TZ = "America/New_York";

// Below this many placed posts, a channel's own heatmap is too sparse to trust,
// so we backfill empty slots with industry-benchmark best-times (day 0=Sun..6=Sat,
// hour 24h, score relative). These are clearly flagged in the response/UI.
const MIN_REAL_POSTS = 10;
const BENCHMARKS: Record<string, Array<{ day: number; hour: number; score: number }>> = {
  instagram: [
    { day: 2, hour: 11, score: 10 }, { day: 3, hour: 13, score: 9 }, { day: 4, hour: 11, score: 8 },
    { day: 3, hour: 11, score: 8 }, { day: 5, hour: 10, score: 6 }, { day: 1, hour: 12, score: 5 },
  ],
  facebook: [
    { day: 3, hour: 11, score: 10 }, { day: 2, hour: 10, score: 9 }, { day: 4, hour: 13, score: 8 },
    { day: 1, hour: 9, score: 6 }, { day: 5, hour: 12, score: 6 },
  ],
  linkedin: [
    { day: 2, hour: 9, score: 10 }, { day: 3, hour: 10, score: 10 }, { day: 4, hour: 8, score: 9 },
    { day: 2, hour: 12, score: 7 }, { day: 3, hour: 17, score: 6 },
  ],
  tiktok: [
    { day: 4, hour: 19, score: 10 }, { day: 4, hour: 12, score: 9 }, { day: 2, hour: 9, score: 8 },
    { day: 5, hour: 17, score: 7 }, { day: 3, hour: 11, score: 6 },
  ],
};

type RawPost = {
  publishedAt?: { dateTime?: string; timezone?: string };
  created?: { dateTime?: string; timezone?: string };
  engagement?: number;
  likes?: number;
  comments?: number;
  shares?: number;
};

/** Convert a wall-clock dateTime in `srcTz` to weekday(0-6, Sun=0)+hour in NY. */
function nyParts(dateTime?: string, srcTz?: string): { day: number; hour: number } | null {
  if (!dateTime) return null;
  const naiveUtc = new Date(dateTime.endsWith("Z") ? dateTime : `${dateTime}Z`);
  if (Number.isNaN(naiveUtc.getTime())) return null;
  const tz = srcTz || "UTC";
  // Offset of srcTz at this instant: compare the same instant rendered in tz vs UTC.
  const inTz = new Date(naiveUtc.toLocaleString("en-US", { timeZone: tz }));
  const inUtc = new Date(naiveUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = inTz.getTime() - inUtc.getTime();
  const instant = new Date(naiveUtc.getTime() - offset);
  // Now read weekday + hour in NY.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  let hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  if (!(wd in dayMap)) return null;
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0;
  return { day: dayMap[wd], hour };
}

function engagementOf(p: RawPost): number {
  if (typeof p.engagement === "number" && p.engagement > 0) return p.engagement;
  return (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0);
}

function range(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().split(".")[0], to: to.toISOString().split(".")[0] };
}

export async function GET(request: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  const windowDays = Math.min(
    365,
    Math.max(30, Number(new URL(request.url).searchParams.get("days")) || 180),
  );
  const r = range(windowDays);

  try {
    const networks = await Promise.all(
      NETWORKS.map(async (key) => {
        let posts: RawPost[] = [];
        try {
          const res = (await getPosts(key, r)) as { data?: RawPost[] };
          posts = res?.data ?? [];
        } catch {
          posts = [];
        }
        // cell key "day-hour" → { sum, count }
        const acc = new Map<string, { sum: number; count: number }>();
        let placed = 0;
        for (const p of posts) {
          const when = nyParts(
            p.publishedAt?.dateTime ?? p.created?.dateTime,
            p.publishedAt?.timezone ?? p.created?.timezone,
          );
          if (!when) continue;
          placed += 1;
          const k = `${when.day}-${when.hour}`;
          const cur = acc.get(k) ?? { sum: 0, count: 0 };
          cur.sum += engagementOf(p);
          cur.count += 1;
          acc.set(k, cur);
        }
        const realCells = [...acc.entries()].map(([k, v]) => {
          const [day, hour] = k.split("-").map(Number);
          return { day, hour, count: v.count, avgEngagement: Math.round(v.sum / v.count), benchmark: false };
        });

        // Sparse channel → backfill empty slots with benchmarks, and recommend
        // the strongest benchmark slots as the top picks.
        let cells = realCells;
        let top = [...realCells].sort((a, b) => b.avgEngagement - a.avgEngagement).slice(0, 2);
        let benchmarked = false;
        if (placed < MIN_REAL_POSTS) {
          benchmarked = true;
          const have = new Set(realCells.map((c) => `${c.day}-${c.hour}`));
          const bench = (BENCHMARKS[key] ?? [])
            .filter((b) => !have.has(`${b.day}-${b.hour}`))
            .map((b) => ({ day: b.day, hour: b.hour, count: 0, avgEngagement: b.score, benchmark: true }));
          cells = [...realCells, ...bench];
          top = [...(BENCHMARKS[key] ?? [])]
            .sort((a, b) => b.score - a.score)
            .slice(0, 2)
            .map((b) => ({ day: b.day, hour: b.hour, count: 0, avgEngagement: b.score, benchmark: true }));
        }
        return { key, totalPosts: posts.length, placed, cells, top, benchmarked };
      }),
    );

    return NextResponse.json({ connected: true, windowDays, timezone: TZ, networks });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ connected: false, error: message, networks: [] });
  }
}
