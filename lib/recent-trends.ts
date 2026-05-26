"use client";

/**
 * Recent-trend-run log — kept in localStorage so the Content Studio "Trending"
 * tab and the Social Ops Hub "Trends" page can show a user's recent AI trend
 * runs and let them re-open one without re-spending an API call.
 *
 * Each run stores the practice area filter + the full result set + a timestamp.
 * We keep payloads small (10 runs max, ~50KB total) which is well within the
 * 5MB localStorage budget.
 *
 * Modeled on lib/recent-searches.ts (same storage / event pattern) so the UI
 * primitives feel consistent.
 */

export type TrendRow = {
  topic: string;
  whyTrending: string;
  suggestedAngle: string;
  urgency: "hot" | "warm" | "evergreen";
  platforms: string[];
  /** ISO date (yyyy-mm-dd) of the underlying event. May be null on older saved runs. */
  sourceDate?: string | null;
};

export type TrendRun = {
  /** Unique id so React keys are stable and clicks resolve to one run. */
  id: string;
  /** Practice area filter used for this run ("All" or one of the slugs). */
  practiceArea: string;
  /** Recency window in months (default 6 when not stored on older runs). */
  monthsBack?: number;
  /** Trend rows as returned by /api/content/intelligence/trends. */
  trends: TrendRow[];
  /** ISO timestamp of when the run completed. */
  createdAt: string;
};

const STORAGE_KEY = "km_recent_trend_runs";
const MAX_RUNS = 10;
const CHANGE_EVENT = "km:recent-trend-runs";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readAll(): TrendRun[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrendRun[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is TrendRun =>
        !!r &&
        typeof r === "object" &&
        typeof r.id === "string" &&
        typeof r.practiceArea === "string" &&
        Array.isArray(r.trends) &&
        typeof r.createdAt === "string",
    );
  } catch {
    return [];
  }
}

function writeAll(runs: TrendRun[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(runs.slice(0, MAX_RUNS)),
    );
  } catch {
    /* quota exceeded / storage disabled — non-fatal */
  }
}

function emitChange(): void {
  if (!isBrowser()) return;
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

function makeId(): string {
  // crypto.randomUUID isn't on every browser; fall back gracefully.
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Persist a finished trend run. Empty result sets are skipped so the history
 * doesn't fill with junk from failed fetches.
 */
export function saveTrendRun(args: {
  practiceArea: string;
  monthsBack?: number;
  trends: TrendRow[];
}): TrendRun | null {
  if (!args.trends || args.trends.length === 0) return null;
  const run: TrendRun = {
    id: makeId(),
    practiceArea: args.practiceArea || "All",
    monthsBack: args.monthsBack,
    trends: args.trends,
    createdAt: new Date().toISOString(),
  };
  const existing = readAll();
  writeAll([run, ...existing]);
  emitChange();
  return run;
}

export function listTrendRuns(limit = MAX_RUNS): TrendRun[] {
  return readAll().slice(0, limit);
}

export function getTrendRun(id: string): TrendRun | null {
  return readAll().find((r) => r.id === id) ?? null;
}

export function clearTrendRuns(): void {
  writeAll([]);
  emitChange();
}

export function deleteTrendRun(id: string): void {
  const next = readAll().filter((r) => r.id !== id);
  writeAll(next);
  emitChange();
}

export const TREND_RUNS_CHANGE_EVENT = CHANGE_EVENT;
