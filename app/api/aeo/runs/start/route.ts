/**
 * POST /api/aeo/runs/start
 *   Body: { providers?: string[], promptIds?: string[] }
 *   Manual/UI trigger. Creates an aeo_runs row and kicks the sweep off in the
 *   background. Returns { runId } so the caller can poll /api/aeo/runs/[id].
 *
 * GET /api/aeo/runs/start
 *   Weekly Vercel Cron trigger (requires Authorization: Bearer ${CRON_SECRET}).
 *   Runs the AEO sweep — which auto-evaluates AEO alerts (lost/gained AI
 *   mentions, sentiment, new citations) on completion — and re-checks rank-drop
 *   alerts. This is what keeps Marketing Alerts updating on its own.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { startRun, executeRun } from "@/lib/aeo-runner";
import { evaluateRankAlerts } from "@/lib/alerts-engine";
import { listTenantIds } from "@/lib/tenant-db";
import type { AEOProviderId } from "@/lib/aeo-providers";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Vercel injects `Authorization: Bearer ${CRON_SECRET}` on scheduled
 * invocations when CRON_SECRET is set. Reject anything else so the GET cron
 * endpoint can't be abused to spend API budget.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rank-drop alerts: quick, reads the keyword table refreshed by the daily cron.
  const rank = await evaluateRankAlerts().catch(() => ({ written: 0 }));

  // AEO sweep per tenant (cron has no session → process every active firm).
  const runIds: string[] = [];
  let sweepError: string | undefined;
  for (const tenantId of await listTenantIds()) {
    try {
      const runId = await startRun({ triggeredBy: "cron" }, tenantId);
      after(executeRun(runId));
      runIds.push(runId);
    } catch (e) {
      sweepError = e instanceof Error ? e.message : "sweep failed";
    }
  }

  return NextResponse.json({
    ok: true,
    runIds,
    rankAlertsWritten: rank.written,
    ...(sweepError ? { sweepError } : {}),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const providers = Array.isArray(body?.providers)
      ? (body.providers as AEOProviderId[])
      : undefined;
    const promptIds = Array.isArray(body?.promptIds)
      ? (body.promptIds as string[])
      : undefined;

    const runId = await startRun({ providers, promptIds, triggeredBy: "manual" });
    after(executeRun(runId));
    return NextResponse.json({ runId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
