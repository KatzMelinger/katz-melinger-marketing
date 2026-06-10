/**
 * GET /api/ads/audit/history — list past audits (most recent first).
 *
 * Best-effort: returns an empty list if the ad_audits table doesn't exist yet
 * (run supabase/ads_phase2_schema.sql to enable persistence).
 */

import { NextResponse } from "next/server";

import { listAdAudits } from "@/lib/ads-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const audits = await listAdAudits();
    return NextResponse.json({ audits });
  } catch (err) {
    console.warn("[ads/audit/history] list failed:", err);
    // Degrade gracefully — the audit feature still works without history.
    return NextResponse.json({ audits: [] });
  }
}
