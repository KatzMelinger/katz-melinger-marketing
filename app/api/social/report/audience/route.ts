/**
 * GET/POST /api/social/report/audience — curated Monthly-Report demographics.
 *
 * These are the Instagram + LinkedIn audience breakdowns (Sections 5-6) that the
 * Metricool API doesn't expose, entered/maintained in-app. Stored in
 * social_insights.report_audience, separate from the Trends & Performance
 * `audience` column so the two editors don't overwrite each other.
 */

import { NextResponse } from "next/server";

import { EMPTY_AUDIENCE, sanitizeAudience } from "@/lib/social-audience";
import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  try {
    const db = await getTenantDb();
    const { data } = await db
      .from("social_insights")
      .select("report_audience")
      .maybeSingle();
    return NextResponse.json({ audience: sanitizeAudience(data?.report_audience) });
  } catch {
    return NextResponse.json({ audience: EMPTY_AUDIENCE });
  }
}

export async function POST(request: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const audience = sanitizeAudience((raw as { audience?: unknown })?.audience ?? raw);

  try {
    const db = await getTenantDb();
    const { error } = await db.upsert(
      "social_insights",
      { report_audience: audience },
      { onConflict: "tenant_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, audience });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save failed" }, { status: 500 });
  }
}
