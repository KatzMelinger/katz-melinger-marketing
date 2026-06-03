/**
 * POST /api/seo/tracked-keywords/push-to-semrush
 *   One-time bulk push of every tracked keyword (seo_keywords) INTO the firm's
 *   Semrush Position Tracking campaign.
 *
 *   Body: { confirm: true }  — REQUIRED. This spends 100 Semrush API units per
 *   keyword (~19,900 for 199), so it won't run without an explicit confirm.
 *
 *   Use this once after the CSV import to seed the campaign. New single adds
 *   auto-push via POST /api/seo/tracked-keywords when SEMRUSH_PUSH_ENABLED=true.
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  pushKeywordsToCampaign,
  SEMRUSH_CAMPAIGN_ID,
} from "@/lib/semrush-position-tracking";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_PUSH = 2000; // backstop against an accidental huge spend

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
  if (body?.confirm !== true) {
    return NextResponse.json(
      {
        error:
          "Refusing to push without confirmation. POST { \"confirm\": true } — this spends 100 Semrush API units per keyword.",
      },
      { status: 400 },
    );
  }
  if (!process.env.SEMRUSH_API_KEY?.trim()) {
    return NextResponse.json({ error: "SEMRUSH_API_KEY not set" }, { status: 503 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("seo_keywords")
      .select("keyword")
      .limit(MAX_PUSH);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const keywords = (data ?? [])
      .map((r) => (typeof r.keyword === "string" ? r.keyword.trim() : ""))
      .filter(Boolean);

    if (keywords.length === 0) {
      return NextResponse.json({ ok: true, pushed: 0, attempted: 0, unitsSpent: 0 });
    }

    const result = await pushKeywordsToCampaign(keywords);
    return NextResponse.json(
      { ...result, campaignId: SEMRUSH_CAMPAIGN_ID },
      { status: result.ok ? 200 : 502 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Bulk push failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
