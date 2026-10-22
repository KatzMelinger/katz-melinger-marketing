/**
 * Weekly Radar discovery (Oct 6 spec, Task 16; lib/radar-discovery.ts).
 *
 * GET  — Vercel Cron, Mondays. Requires `Authorization: Bearer ${CRON_SECRET}`.
 * POST — "Discover now" on the Opportunities page (signed-in user).
 *
 * Each run is logged to pipeline_logs as step "discovery", which is where the
 * Opportunities page reads "Discovered <date>" from.
 */
import { NextRequest, NextResponse } from "next/server";

import { runRadarDiscovery } from "@/lib/radar-discovery";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import { listTenantIds } from "@/lib/tenant-db";
import { withJobRun } from "@/lib/job-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function runAndLog(tenantId: string) {
  const started = Date.now();
  try {
    const result = await runRadarDiscovery(tenantId);
    await getSupabaseAdmin()
      .from("pipeline_logs")
      .insert({
        tenant_id: tenantId,
        step_reached: "discovery",
        status: "success",
        counts: { candidates: result.candidates, added: result.added, tracked: result.tracked, trend_updated: result.trendUpdated, rising: result.rising },
        duration_ms: Date.now() - started,
      });
    return { tenantId, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await getSupabaseAdmin()
      .from("pipeline_logs")
      .insert({ tenant_id: tenantId, step_reached: "discovery", status: "failed", error_message: message, counts: {}, duration_ms: Date.now() - started });
    return { tenantId, error: message };
  }
}

async function runScheduled(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = [];
  for (const tenantId of await listTenantIds()) results.push(await runAndLog(tenantId));
  return NextResponse.json({ results });
}

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  const out = await runAndLog(await resolveTenantId());
  return NextResponse.json(out, { status: "error" in out ? 500 : 200 });
}

/** Oct 20 spec, Task A17: a scheduled run is recorded for System health and the watchdog. */
export async function GET(...args: Parameters<typeof runScheduled>) {
  return withJobRun("/api/seo/radar/discover", (args as unknown[])[0] as Request | undefined, () => runScheduled(...args));
}
