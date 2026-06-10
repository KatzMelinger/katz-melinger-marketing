/**
 * GET  /api/agent/run
 *   (Vercel Cron trigger — requires Authorization: Bearer ${CRON_SECRET})
 *   Runs the autonomous content agent for EVERY active tenant.
 *
 * POST /api/agent/run
 *   (UI / manual trigger — runs the caller's tenant only)
 *   body: { practiceArea?, maxItems?, minWorthScore?, minComplianceScore?, dryRun? }
 *
 * The agent runs research → draft → analyze → compliance-gate → queue, stopping
 * at the human approval gate. It NEVER publishes. See lib/agent/content-agent.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveTenantId } from "@/lib/tenant-context";
import { listTenantIds } from "@/lib/tenant-db";
import { runContentAgent } from "@/lib/agent/content-agent";

export const runtime = "nodejs";
// Research + draft + analyze + compliance per item is Claude-heavy; give the
// multi-tenant cron loop room. Vercel caps this per plan tier.
export const maxDuration = 300;

/**
 * Vercel Cron auth — Vercel injects `Authorization: Bearer ${CRON_SECRET}` on
 * scheduled invocations. Reject anything else so the run URL can't be abused.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantIds = await listTenantIds();
  const results = [];
  for (const tenantId of tenantIds) {
    // One tenant's failure must not abort the rest of the fleet.
    try {
      results.push(await runContentAgent({ tenantId, trigger: "cron" }));
    } catch (err) {
      results.push({
        tenantId,
        error: err instanceof Error ? err.message : "run failed",
      });
    }
  }
  return NextResponse.json({ tenants: results.length, results });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = await resolveTenantId();

  const result = await runContentAgent({
    tenantId,
    trigger: "manual",
    practiceArea:
      typeof body?.practiceArea === "string" ? body.practiceArea : null,
    maxItems:
      typeof body?.maxItems === "number" ? body.maxItems : undefined,
    minWorthScore:
      typeof body?.minWorthScore === "number" ? body.minWorthScore : undefined,
    minComplianceScore:
      typeof body?.minComplianceScore === "number"
        ? body.minComplianceScore
        : undefined,
    dryRun: body?.dryRun === true,
  });

  return NextResponse.json(result);
}
