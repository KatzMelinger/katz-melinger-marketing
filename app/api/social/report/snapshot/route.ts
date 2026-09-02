/**
 * Monthly social-metrics snapshot — freezes a month's per-platform figures into
 * social_metrics_snapshots so the Monthly Report can trend month-over-month
 * stably (the live Metricool dashboards keep no history).
 *
 * GET  /api/social/report/snapshot — Vercel Cron (Bearer CRON_SECRET). Snapshots
 *      the month that just ended (the prior calendar month), so scheduling it on
 *      the 1st captures the previous month in full.
 * POST /api/social/report/snapshot — manual trigger for the current tenant.
 *      Body: { "month": "YYYY-MM" } (optional; defaults to the prior month).
 */

import { NextRequest, NextResponse } from "next/server";

import { writeAlert } from "@/lib/alerts-engine";
import { refreshLinkedInAudience } from "@/lib/linkedin-audience-refresh";
import { refreshInstagramAudience } from "@/lib/meta-audience-refresh";
import { RENEWAL_STEPS } from "@/lib/linkedin-health";
import { currentMonthKey, priorMonthKey, snapshotMonth } from "@/lib/social-report";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { DEFAULT_TENANT_ID, resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MONTH_RE = /^\d{4}-\d{2}$/;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}


/**
 * Refresh the LinkedIn demographics alongside the snapshot, and NEVER let that
 * fail the snapshot.
 *
 * The month's metrics are the point of this job; the demographics are an
 * addition. An expired token in late October must not take the monthly report
 * down with it — but it also must not pass silently, because a LinkedIn section
 * that quietly stops updating shows last month's audience under this month's
 * heading and looks entirely normal.
 *
 * So it fails soft and alerts loudly: the outcome is reported in the response
 * and a credential problem writes to the same alerts inbox the daily health
 * check uses, deduped against it so one dead token is one alert and not two.
 */
async function refreshAudience(
  supabase: Parameters<typeof refreshLinkedInAudience>[0],
  tenantId: string,
): Promise<Record<string, unknown>> {
  try {
    const res = await refreshLinkedInAudience(supabase, tenantId);
    if (res.ok && res.skipped) return { linkedin: "skipped", reason: res.reason };
    if (res.ok) return { linkedin: "refreshed", followers: res.followers };

    await writeAlert(
      {
        type: "integration_credential",
        severity: "high",
        source: "social",
        title: "The monthly report ran without fresh LinkedIn demographics",
        body:
          `The snapshot completed, but LinkedIn could not be read (${res.step}): ${res.reason}` +
          "\n\nThe LinkedIn section is showing the figures from the last successful run." +
          `\n\nIf the token has expired:\n${RENEWAL_STEPS}`,
        payload: { integration: "linkedin", state: "refresh_failed", step: res.step },
        dedupeKey: "linkedin-token-expired",
      },
      tenantId,
    );
    return { linkedin: "failed", step: res.step, reason: res.reason };
  } catch (e) {
    // A throw here is a bug in the refresh, not a reason to lose the snapshot.
    return { linkedin: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The Instagram half, on the same terms: never fail the snapshot, never fail
 * silently.
 *
 * Its own try/catch rather than a shared one, so a broken LinkedIn refresh
 * cannot cost the report its Instagram figures or the reverse. The two
 * platforms fail independently and should recover independently.
 *
 * The Meta token is a System User token and does not expire, so a failure here
 * is a revoked assignment or a lost asset — not a renewal anyone forgot. The
 * alert says so rather than sending someone to regenerate a token that was
 * never the problem.
 */
async function refreshInstagram(
  supabase: Parameters<typeof refreshInstagramAudience>[0],
  tenantId: string,
): Promise<Record<string, unknown>> {
  try {
    const res = await refreshInstagramAudience(supabase, tenantId);
    if (res.ok && res.skipped) return { instagram: "skipped", instagramReason: res.reason };
    if (res.ok) return { instagram: "refreshed", instagramFollowers: res.account.followers };

    await writeAlert(
      {
        type: "integration_credential",
        severity: "high",
        source: "social",
        title: "The monthly report ran without fresh Instagram demographics",
        body:
          `The snapshot completed, but Meta could not be read (${res.step}): ${res.reason}` +
          "\n\nThe Instagram section is showing the figures from the last successful run." +
          "\n\nThe Meta token is a Business Manager System User token and does not expire, " +
          "so this is usually an asset assignment that was removed, the system user being " +
          "deleted, or the Instagram account being unlinked from the Facebook Page. Check " +
          "business.facebook.com > Business Settings > System users before regenerating anything.",
        payload: { integration: "instagram", state: "refresh_failed", step: res.step },
        dedupeKey: "meta-token-broken",
      },
      tenantId,
    );
    return { instagram: "failed", instagramStep: res.step, instagramReason: res.reason };
  } catch (e) {
    return { instagram: "failed", instagramReason: e instanceof Error ? e.message : String(e) };
  }
}
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  const period = priorMonthKey(currentMonthKey());
  try {
    const result = await snapshotMonth(supabase, DEFAULT_TENANT_ID, period);
    // Sequential, not Promise.all: both write the same social_insights row, and
    // concurrent read-modify-write on one JSON column loses whichever finishes
    // first.
    const audience = await refreshAudience(supabase, DEFAULT_TENANT_ID);
    const instagram = await refreshInstagram(supabase, DEFAULT_TENANT_ID);
    return NextResponse.json({ ...result, ...audience, ...instagram });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }

  let month = priorMonthKey(currentMonthKey());
  try {
    const body = (await req.json()) as { month?: unknown };
    if (typeof body.month === "string" && MONTH_RE.test(body.month)) month = body.month;
  } catch {
    // no/invalid body → default to prior month
  }

  try {
    const tenantId = await resolveTenantId();
    const result = await snapshotMonth(supabase, tenantId, month);
    const audience = await refreshAudience(supabase, tenantId);
    const instagram = await refreshInstagram(supabase, tenantId);
    return NextResponse.json({ ...result, ...audience, ...instagram });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
