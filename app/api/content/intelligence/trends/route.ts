/**
 * POST /api/content/intelligence/trends
 *   body: {
 *     practiceArea?: string,
 *     monthsBack?: number   // recency window; default 6, clamped to [1, 24]
 *   }
 *
 * Returns AI's read on what's *currently* trending or newsworthy in NY/NJ
 * employment law that the firm could write about. Each trend gets:
 *   - urgency tag (hot / warm / evergreen) for editorial pacing
 *   - sourceDate: when the underlying event/ruling/news happened (ISO date)
 *
 * Recency guard: we pass today's date into the prompt, demand a sourceDate on
 * every item, and drop anything older than the monthsBack window. This is
 * because Claude's training cutoff means it will otherwise happily surface
 * 2023-2024 events as "trending now" — exactly what we don't want.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirmContext } from "@/lib/firm-context";
import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;

const PRACTICE_AREAS = [
  "Employment Discrimination",
  "FMLA",
  "Wage & Hour Claims",
  "Wrongful Termination",
  "Sexual Harassment at Work",
  "Severance Negotiations",
  "Commercial Collections",
  "Judgment Enforcement",
];

const DEFAULT_MONTHS_BACK = 6;
const MIN_MONTHS_BACK = 1;
const MAX_MONTHS_BACK = 24;

type IncomingTrend = {
  topic?: unknown;
  whyTrending?: unknown;
  suggestedAngle?: unknown;
  urgency?: unknown;
  platforms?: unknown;
  sourceDate?: unknown;
};

type CleanTrend = {
  topic: string;
  whyTrending: string;
  suggestedAngle: string;
  urgency: "hot" | "warm" | "evergreen";
  platforms: string[];
  sourceDate: string | null;
};

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clampMonthsBack(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MONTHS_BACK;
  return Math.min(Math.max(Math.round(n), MIN_MONTHS_BACK), MAX_MONTHS_BACK);
}

function cutoffISO(monthsBack: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsBack);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parse a sourceDate — accept ISO yyyy-mm-dd, full ISO, or a month-precision
 * string like "2026-03". Returns null if we can't parse it; callers treat
 * null as "unknown" and may filter those out.
 */
function parseSourceDate(value: unknown): Date | null {
  const s = asString(value);
  if (!s) return null;
  // Month-only: pin to the 1st so it's comparable.
  if (/^\d{4}-\d{2}$/.test(s)) {
    const d = new Date(`${s}-01T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const practiceArea = (body?.practiceArea as string | undefined) ?? "All";
  const monthsBack = clampMonthsBack(body?.monthsBack);
  const today = todayISO();
  const cutoff = cutoffISO(monthsBack);

  const firm = await getFirmContext();
  const focus =
    practiceArea && practiceArea !== "All"
      ? `Focus on ${practiceArea} specifically.`
      : `Cover trends across these practice areas: ${PRACTICE_AREAS.join(", ")}.`;

  const system = `You are a trend analyst for a NY/NJ plaintiff-side employment law firm. ${firm}

Today's date is ${today}. You MUST only surface events, rulings, legislation, news stories, or cultural moments that occurred on or after ${cutoff} (the last ${monthsBack} months). Do NOT include 2023 or 2024 items unless they fall inside that window. If you do not have confident knowledge of recent events inside the window, return an empty list rather than reaching back further. Surface concrete current events, recent court rulings, new legislation, and viral workplace stories — not vague evergreen advice.`;

  const user = `Identify current trending topics, recent legal developments, and newsworthy events in NY/NJ employment law that the firm could create content about. ${focus}

Recency requirement: every item's sourceDate MUST be on or after ${cutoff}. If you are uncertain whether something fits the window, omit it.

For each, provide:
- topic: the event or theme
- whyTrending: what's making it hot right now (cite a specific ruling, law, news event, or cultural moment if you can)
- suggestedAngle: the firm's angle — what's their take or what would they teach?
- urgency: "hot" (publish this week), "warm" (this month), or "evergreen" (anytime)
- platforms: array of formats best suited (e.g. ["blog", "linkedin", "twitter", "podcast"])
- sourceDate: ISO date (yyyy-mm-dd) of the underlying event, ruling, or news story. Use month precision (yyyy-mm) only if you genuinely don't know the day. Never invent a date.

Return JSON only:
{
  "trends": [
    {
      "topic": "...",
      "whyTrending": "...",
      "suggestedAngle": "...",
      "urgency": "hot|warm|evergreen",
      "platforms": ["..."],
      "sourceDate": "YYYY-MM-DD"
    }
  ]
}`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<{ trends?: IncomingTrend[] }>(text);
    const raw = Array.isArray(parsed.trends) ? parsed.trends : [];

    const cutoffDate = new Date(`${cutoff}T00:00:00Z`);

    const trends: CleanTrend[] = [];
    let droppedStale = 0;
    let droppedMissingDate = 0;

    for (const t of raw) {
      const topic = asString(t.topic);
      if (!topic) continue;
      const urgencyRaw = asString(t.urgency).toLowerCase();
      const urgency: CleanTrend["urgency"] =
        urgencyRaw === "hot" || urgencyRaw === "warm" || urgencyRaw === "evergreen"
          ? urgencyRaw
          : "warm";
      const platforms = Array.isArray(t.platforms)
        ? t.platforms.map(asString).filter(Boolean)
        : [];
      const parsedDate = parseSourceDate(t.sourceDate);

      // Drop items with no date OR dates older than the window.
      if (!parsedDate) {
        droppedMissingDate += 1;
        continue;
      }
      if (parsedDate < cutoffDate) {
        droppedStale += 1;
        continue;
      }

      trends.push({
        topic,
        whyTrending: asString(t.whyTrending),
        suggestedAngle: asString(t.suggestedAngle),
        urgency,
        platforms,
        sourceDate: parsedDate.toISOString().slice(0, 10),
      });
    }

    return NextResponse.json({
      trends,
      meta: {
        today,
        cutoff,
        monthsBack,
        droppedStale,
        droppedMissingDate,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to track trends";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
