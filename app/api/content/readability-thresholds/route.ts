/**
 * GET    /api/content/readability-thresholds  — resolved tenant thresholds
 * PUT    /api/content/readability-thresholds  — save a partial { metric: {green,amber} } patch
 * DELETE /api/content/readability-thresholds  — reset to code defaults
 *
 * Powers two consumers: the Content Studio readability panel (which recomputes
 * flagged ranges client-side from the same bands the server scored with) and the
 * "Readability standards" editor under Brand voice & directions.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  getThresholdsDetail,
  saveThresholds,
  resetThresholds,
} from "@/lib/readability/thresholds-store";
import { type ReadabilityMetric, DEFAULT_THRESHOLDS } from "@/lib/readability/config";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { thresholds, base, register } = await getThresholdsDetail();
    // `base` is the brand-voice-derived starting point; `register` says which
    // voice profile drove it (formal | accessible | neutral).
    return NextResponse.json({ thresholds, base, register });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load thresholds";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const METRIC_KEYS = Object.keys(DEFAULT_THRESHOLDS) as ReadabilityMetric[];

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = (body?.thresholds ?? body) as Record<string, unknown>;

  // Accept only known metrics and numeric green/amber — ignore everything else
  // (direction is code-owned and never taken from the client).
  const patch: Partial<Record<ReadabilityMetric, { green?: number; amber?: number }>> = {};
  for (const key of METRIC_KEYS) {
    const v = raw?.[key] as { green?: unknown; amber?: unknown } | undefined;
    if (!v || typeof v !== "object") continue;
    const entry: { green?: number; amber?: number } = {};
    if (typeof v.green === "number" && Number.isFinite(v.green)) entry.green = v.green;
    if (typeof v.amber === "number" && Number.isFinite(v.amber)) entry.amber = v.amber;
    if ("green" in entry || "amber" in entry) patch[key] = entry;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid threshold values provided" }, { status: 400 });
  }

  try {
    const thresholds = await saveThresholds(patch);
    return NextResponse.json({ thresholds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save thresholds";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const thresholds = await resetThresholds();
    return NextResponse.json({ thresholds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reset thresholds";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
