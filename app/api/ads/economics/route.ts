/**
 * GET /api/ads/economics  — list per-practice-area economics (avg case value +
 *     close rate) for the ROI calculator.
 * PUT /api/ads/economics  — upsert one practice area.
 *     Body: { practice_area, avg_case_value, close_rate, notes? }
 *
 * Best-effort GET: returns an empty list if the ad_economics table doesn't
 * exist yet (run supabase/ads_phase2_schema.sql).
 */

import { NextRequest, NextResponse } from "next/server";

import { listAdEconomics, upsertAdEconomics } from "@/lib/ads-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await listAdEconomics();
    return NextResponse.json({ rows });
  } catch (err) {
    console.warn("[ads/economics] list failed:", err);
    return NextResponse.json({ rows: [] });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const practice_area =
      typeof body?.practice_area === "string" && body.practice_area.trim()
        ? body.practice_area.trim()
        : "All";
    const avg_case_value = Number(body?.avg_case_value);
    const close_rate = Number(body?.close_rate);
    if (!Number.isFinite(avg_case_value) || avg_case_value < 0) {
      return NextResponse.json(
        { error: "avg_case_value must be a non-negative number" },
        { status: 400 },
      );
    }
    if (!Number.isFinite(close_rate) || close_rate < 0 || close_rate > 1) {
      return NextResponse.json(
        { error: "close_rate must be between 0 and 1" },
        { status: 400 },
      );
    }
    const row = await upsertAdEconomics({
      practice_area,
      avg_case_value,
      close_rate,
      notes: typeof body?.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save economics" },
      { status: 500 },
    );
  }
}
