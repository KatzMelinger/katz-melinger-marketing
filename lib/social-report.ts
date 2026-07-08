/**
 * Monthly social report — assembly + snapshotting.
 *
 * The live Metricool dashboards are snapshot-only (no history), so month-over-
 * month deltas need frozen monthly figures. This module:
 *   - computes a month's per-platform totals from Metricool (computeMonthMetrics)
 *   - persists them to social_metrics_snapshots (snapshotMonth) — the monthly cron
 *   - assembles a report for a month + its prior month, computing deltas
 *     (buildMonthlyReport), reading snapshots when present and falling back to a
 *     live Metricool query for any month not yet snapshotted (e.g. the current,
 *     in-progress month) so the feature works before the first cron run.
 *
 * `clicks` (profile visits / page views) is intentionally null throughout —
 * Metricool's post analytics don't expose it, so the report labels it
 * "not available" rather than inventing a number.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getMonthlyMetrics, type MonthlyPlatformMetrics } from "@/lib/metricool";
import { logger } from "@/lib/logger";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Bare per-platform figures, shared by the snapshot and live code paths. */
type PlatformFigures = {
  impressions: number;
  reach: number;
  engagement: number;
  clicks: number | null;
  netNewFollowers: number | null;
  totalFollowers: number | null;
  posts: number;
};

export type ReportMetric = { value: number | null; deltaPct: number | null };

export type ReportPlatform = {
  network: string;
  key: string;
  impressions: ReportMetric;
  reach: ReportMetric;
  engagement: ReportMetric;
  clicks: ReportMetric;
  netNewFollowers: ReportMetric;
  totalFollowers: number | null;
  posts: number;
};

export type MonthlyReport = {
  connected: boolean;
  error?: string;
  month: string; // "YYYY-MM"
  monthLabel: string; // "June 2026"
  priorMonth: string;
  priorMonthLabel: string;
  source: "snapshot" | "live" | "mixed" | "none";
  platforms: ReportPlatform[];
  kpis: {
    combinedImpressions: number;
    netNewFollowers: number;
    standout: { label: string; deltaPct: number } | null;
  };
};

// ---- month helpers ---------------------------------------------------------

/** "YYYY-MM" → Metricool from/to strings covering that whole calendar month. */
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59)); // day 0 of next month = last day
  return { from: from.toISOString().split(".")[0], to: to.toISOString().split(".")[0] };
}

/** "YYYY-MM" → the previous month "YYYY-MM". */
export function priorMonthKey(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Current calendar month "YYYY-MM" (server local time). */
export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" → "June 2026". */
export function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "YYYY-MM" → "YYYY-MM-01" (the period_month DB value). */
function periodMonthDate(period: string): string {
  return `${period}-01`;
}

// ---- metric plumbing -------------------------------------------------------

function toFigures(m: MonthlyPlatformMetrics): PlatformFigures {
  return {
    impressions: m.impressions,
    reach: m.reach,
    engagement: m.engagement,
    clicks: m.clicks,
    netNewFollowers: m.netNewFollowers,
    totalFollowers: m.totalFollowers,
    posts: m.posts,
  };
}

/** Percent change cur vs prev, rounded. Null when it can't be computed. */
function deltaPct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

function metric(cur: number | null, prev: number | null): ReportMetric {
  return { value: cur, deltaPct: deltaPct(cur, prev) };
}

/** Compute one month's per-platform metrics live from Metricool. */
export async function computeMonthMetrics(period: string): Promise<MonthlyPlatformMetrics[]> {
  const { from, to } = monthRange(period);
  return getMonthlyMetrics(from, to);
}

/**
 * Read a month's snapshot rows for a tenant, as key→figures. Returns null when
 * no rows exist for that month (caller then falls back to a live compute).
 */
async function readSnapshot(
  supabase: SupabaseClient,
  tenantId: string,
  period: string,
): Promise<Map<string, PlatformFigures> | null> {
  const { data, error } = await supabase
    .from("social_metrics_snapshots")
    .select("platform, impressions, reach, engagement, clicks, net_new_followers, total_followers, posts")
    .eq("tenant_id", tenantId)
    .eq("period_month", periodMonthDate(period));
  if (error) {
    logger.warn({ error: error.message, period }, "social report: snapshot read failed");
    return null;
  }
  if (!data || data.length === 0) return null;
  const map = new Map<string, PlatformFigures>();
  for (const r of data) {
    map.set(r.platform, {
      impressions: r.impressions ?? 0,
      reach: r.reach ?? 0,
      engagement: r.engagement ?? 0,
      clicks: r.clicks,
      netNewFollowers: r.net_new_followers,
      totalFollowers: r.total_followers,
      posts: r.posts ?? 0,
    });
  }
  return map;
}

/** Snapshot rows or, if none, a live Metricool compute — with which source it was. */
async function figuresForMonth(
  supabase: SupabaseClient | null,
  tenantId: string,
  period: string,
): Promise<{ map: Map<string, PlatformFigures>; source: "snapshot" | "live" }> {
  if (supabase) {
    const snap = await readSnapshot(supabase, tenantId, period);
    if (snap) return { map: snap, source: "snapshot" };
  }
  const live = await computeMonthMetrics(period);
  const map = new Map<string, PlatformFigures>();
  for (const m of live) map.set(m.key, toFigures(m));
  return { map, source: "live" };
}

/**
 * Compute a month's metrics and upsert them into social_metrics_snapshots.
 * Returns a small summary for the cron/manual-trigger response.
 */
export async function snapshotMonth(
  supabase: SupabaseClient,
  tenantId: string,
  period: string,
): Promise<{ period: string; platforms: number }> {
  const metrics = await computeMonthMetrics(period);
  const rows = metrics.map((m) => ({
    tenant_id: tenantId,
    platform: m.key,
    period_month: periodMonthDate(period),
    impressions: m.impressions,
    reach: m.reach,
    engagement: m.engagement,
    clicks: m.clicks,
    net_new_followers: m.netNewFollowers,
    total_followers: m.totalFollowers,
    posts: m.posts,
    captured_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("social_metrics_snapshots")
    .upsert(rows, { onConflict: "tenant_id,platform,period_month" });
  if (error) throw new Error(error.message);

  return { period, platforms: rows.length };
}

/**
 * Assemble the full month report: current month + prior month, with deltas.
 * `supabase` may be null (service client unavailable) — then both months are
 * computed live and no snapshots are consulted.
 */
export async function buildMonthlyReport(
  supabase: SupabaseClient | null,
  tenantId: string,
  period: string,
): Promise<MonthlyReport> {
  const prior = priorMonthKey(period);
  const base: Omit<MonthlyReport, "platforms" | "kpis" | "source"> = {
    connected: true,
    month: period,
    monthLabel: monthLabel(period),
    priorMonth: prior,
    priorMonthLabel: monthLabel(prior),
  };

  let cur: { map: Map<string, PlatformFigures>; source: "snapshot" | "live" };
  let prev: { map: Map<string, PlatformFigures>; source: "snapshot" | "live" };
  try {
    [cur, prev] = await Promise.all([
      figuresForMonth(supabase, tenantId, period),
      figuresForMonth(supabase, tenantId, prior),
    ]);
  } catch (e) {
    return {
      ...base,
      connected: false,
      error: e instanceof Error ? e.message : String(e),
      source: "none",
      platforms: [],
      kpis: { combinedImpressions: 0, netNewFollowers: 0, standout: null },
    };
  }

  // Preserve platform order from the current month's data; fall back to prior.
  const keys = cur.map.size > 0 ? [...cur.map.keys()] : [...prev.map.keys()];
  const NAMES: Record<string, string> = {
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    tiktok: "TikTok",
  };

  const platforms: ReportPlatform[] = keys.map((key) => {
    const c = cur.map.get(key);
    const p = prev.map.get(key);
    return {
      network: NAMES[key] ?? key,
      key,
      impressions: metric(c?.impressions ?? null, p?.impressions ?? null),
      reach: metric(c?.reach ?? null, p?.reach ?? null),
      engagement: metric(c?.engagement ?? null, p?.engagement ?? null),
      clicks: metric(c?.clicks ?? null, p?.clicks ?? null),
      netNewFollowers: metric(c?.netNewFollowers ?? null, p?.netNewFollowers ?? null),
      totalFollowers: c?.totalFollowers ?? null,
      posts: c?.posts ?? 0,
    };
  });

  const combinedImpressions = platforms.reduce((s, pl) => s + (pl.impressions.value ?? 0), 0);
  const netNewFollowers = platforms.reduce((s, pl) => s + (pl.netNewFollowers.value ?? 0), 0);

  // Standout = platform with the biggest follower-growth delta this month.
  let standout: { label: string; deltaPct: number } | null = null;
  for (const pl of platforms) {
    const d = pl.netNewFollowers.deltaPct;
    if (d != null && (standout == null || d > standout.deltaPct)) {
      standout = { label: `${pl.network} follower growth`, deltaPct: d };
    }
  }

  const source: MonthlyReport["source"] =
    cur.source === prev.source ? cur.source : "mixed";

  return {
    ...base,
    source,
    platforms,
    kpis: { combinedImpressions, netNewFollowers, standout },
  };
}
