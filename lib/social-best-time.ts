/**
 * Per-network recommended posting slots + a timezone helper, shared by the
 * best-time API (app/api/social/best-time) and the social composer's
 * "Apply best time" action.
 *
 * Phase 1 (this file): a static, industry-benchmark table per network. When a
 * channel has enough real post history the API blends in its own heatmap; the
 * composer uses these static picks directly for a one-click "best time".
 * Phase 2 (later) will derive these from the firm's own analytics.
 *
 * Slots are expressed in America/New_York wall-clock (day: 0=Sun..6=Sat, hour:
 * 0-23). Higher score = stronger slot.
 */

export const BEST_TIME_TZ = "America/New_York";

export type BenchmarkSlot = { day: number; hour: number; score: number };

// Keyed by the composer's NetworkKey values (and Ayrshare platform ids). The
// first four mirror the original BENCHMARKS in the best-time route; gmb + the
// extra networks are added so every composable network has a suggestion.
export const BEST_TIME_BENCHMARKS: Record<string, BenchmarkSlot[]> = {
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
  // Google Business posts skew to weekday business mornings.
  gmb: [
    { day: 2, hour: 10, score: 10 }, { day: 3, hour: 10, score: 9 }, { day: 4, hour: 9, score: 8 },
    { day: 1, hour: 11, score: 6 },
  ],
  threads: [
    { day: 2, hour: 12, score: 9 }, { day: 3, hour: 11, score: 8 }, { day: 4, hour: 13, score: 7 },
  ],
  pinterest: [
    { day: 6, hour: 20, score: 10 }, { day: 5, hour: 15, score: 8 }, { day: 0, hour: 14, score: 7 },
  ],
  youtube: [
    { day: 4, hour: 15, score: 9 }, { day: 5, hour: 15, score: 9 }, { day: 6, hour: 10, score: 8 },
  ],
};

/** The single strongest recommended slot for a network, or null if unknown. */
export function bestSlot(network: string): { day: number; hour: number } | null {
  const arr = BEST_TIME_BENCHMARKS[network];
  if (!arr?.length) return null;
  const top = [...arr].sort((a, b) => b.score - a.score)[0];
  return { day: top.day, hour: top.hour };
}

/**
 * Interpret a `yyyy-mm-dd` date + `HH:mm` time as America/New_York wall-clock
 * and return the correct UTC instant. JS's `new Date("2026-07-20T09:00")` parses
 * offset-less strings as BROWSER-local, which is wrong for any non-ET machine;
 * this pins the intended zone to NY regardless of where the browser runs.
 * Mirrors the offset technique in app/api/social/best-time/route.ts.
 */
export function nyWallClockToUtc(date: string, time: string): Date {
  const naiveUtc = new Date(`${date}T${(time || "00:00").slice(0, 5)}:00Z`);
  if (Number.isNaN(naiveUtc.getTime())) return new Date(NaN);
  // NY's offset from UTC at this instant (negative — NY is behind UTC).
  const inTz = new Date(naiveUtc.toLocaleString("en-US", { timeZone: BEST_TIME_TZ }));
  const inUtc = new Date(naiveUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = inTz.getTime() - inUtc.getTime();
  // The NY wall-clock corresponds to (naiveUtc - offset) in real UTC.
  return new Date(naiveUtc.getTime() - offset);
}
