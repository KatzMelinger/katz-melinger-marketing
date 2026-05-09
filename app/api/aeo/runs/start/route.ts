/**
 * POST /api/aeo/runs/start
 *
 * Body: { providers?: string[], promptIds?: string[] }
 *
 * Creates an aeo_runs row and kicks the sweep off in the background. Returns
 * { runId } so the caller can poll /api/aeo/runs/[id] for status.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { startRun, executeRun } from "@/lib/aeo-runner";
import type { AEOProviderId } from "@/lib/aeo-providers";

export const runtime = "nodejs";
export const maxDuration = 300;

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
