/**
 * Per-post performance refresh (Phase 4 analytics).
 *
 * Pulls a live post's stats from Ayrshare and stores them on its social_posts
 * row (which is the per-platform "variation" in the current model). The refresh
 * cadence approximates the spec: capture shortly after publish, then again
 * around 7 and 30 days, then stop. Both the cron (service-role) and the manual
 * endpoint call refreshPostMetrics with a service-role client + explicit tenant.
 */

import { getSupabaseServer } from "./supabase-server";
import { getTenantConfig } from "./tenant-config";
import { getAyrshareApiKey, getAyrsharePostAnalytics } from "./ayrshare";

type Supa = NonNullable<ReturnType<typeof getSupabaseServer>>;

const DAY = 86_400_000;

/**
 * A live post is due for a refresh. The spec wants ~3 captures — shortly after
 * publish, then around 7 and 30 days — so we key off milestones the post has
 * crossed since its LAST capture, not a short repeating interval (which would
 * re-pull ~15× and burn Ayrshare analytics quota).
 */
export function dueForRefresh(liveAt: Date, updatedAt: Date | null, now: Date): boolean {
  const liveAge = now.getTime() - liveAt.getTime();
  if (liveAge < 0) return false; // not live yet
  if (liveAge > 35 * DAY) return false; // past the 30-day window — stop refreshing
  if (!updatedAt) return true; // first capture, shortly after publish
  // The post-age at the last capture — used to fire each milestone exactly once.
  const capturedAtAge = updatedAt.getTime() - liveAt.getTime();
  if (liveAge >= 7 * DAY && capturedAtAge < 7 * DAY) return true; // the ~7-day capture
  if (liveAge >= 30 * DAY && capturedAtAge < 30 * DAY) return true; // the ~30-day capture
  return false;
}

type PostRow = {
  id: string;
  platform: string;
  ayrshare_id: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  status: string | null;
  metrics_updated_at: string | null;
};

export type RefreshSummary = {
  ok: boolean;
  refreshed: number;
  failed: number;
  considered: number;
  error?: string;
};

/**
 * Refresh metrics for a tenant's live posts. With `onlyId`, refreshes just that
 * post (ignoring the cadence). Otherwise scans posts that went live in the last
 * ~35 days and refreshes the ones the cadence says are due.
 */
export async function refreshPostMetrics(
  supabase: Supa,
  tenantId: string,
  opts: { onlyId?: string; limit?: number } = {},
): Promise<RefreshSummary> {
  const apiKey = getAyrshareApiKey();
  if (!apiKey) return { ok: false, refreshed: 0, failed: 0, considered: 0, error: "Ayrshare not configured" };
  const profileKey = (await getTenantConfig(tenantId)).ayrshareProfileKey;
  const now = new Date();

  const cols = "id, platform, ayrshare_id, scheduled_at, published_at, status, metrics_updated_at";
  let query = supabase
    .from("social_posts")
    .select(cols)
    .eq("tenant_id", tenantId)
    .not("ayrshare_id", "is", null);

  if (opts.onlyId) {
    query = query.eq("id", opts.onlyId);
  } else {
    const windowStart = new Date(now.getTime() - 35 * DAY).toISOString();
    query = query
      .lte("scheduled_at", now.toISOString())
      .gte("scheduled_at", windowStart)
      .order("scheduled_at", { ascending: false })
      .limit(opts.limit ?? 50);
  }

  const { data, error } = await query;
  if (error) return { ok: false, refreshed: 0, failed: 0, considered: 0, error: error.message };

  const rows = (data ?? []) as PostRow[];
  const candidates = rows.filter((r) => {
    if (!r.ayrshare_id) return false;
    if (opts.onlyId) return true; // manual single refresh ignores the cadence
    const liveAt = r.scheduled_at ? new Date(r.scheduled_at) : null;
    if (!liveAt || Number.isNaN(liveAt.getTime())) return false;
    return dueForRefresh(liveAt, r.metrics_updated_at ? new Date(r.metrics_updated_at) : null, now);
  });

  let refreshed = 0;
  let failed = 0;
  for (const r of candidates) {
    const res = await getAyrsharePostAnalytics({
      apiKey,
      profileKey,
      id: r.ayrshare_id as string,
      platforms: [r.platform],
    });
    const metrics = res.perPlatform[r.platform];
    if (!res.ok || !metrics) {
      failed += 1;
      continue;
    }
    // Getting analytics back means the post is live — mark it published.
    const update: Record<string, unknown> = {
      metrics,
      metrics_updated_at: now.toISOString(),
    };
    if (r.status === "scheduled") {
      update.status = "published";
      update.published_at = r.published_at ?? r.scheduled_at ?? now.toISOString();
    }
    const { error: upErr } = await supabase.from("social_posts").update(update).eq("id", r.id);
    if (upErr) failed += 1;
    else refreshed += 1;
  }

  return { ok: true, refreshed, failed, considered: candidates.length };
}
