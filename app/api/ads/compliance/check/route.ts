/**
 * POST /api/ads/compliance/check
 *
 * Body: { copy: string, platform?, jurisdiction?, practiceArea?, format?, creativeId? }
 *
 * Runs Claude against NY/NJ attorney advertising rules and returns a scored
 * compliance result. Records the check (and optionally updates the creative's
 * compliance_score) for history.
 */

import { NextRequest, NextResponse } from "next/server";

import { checkAdCompliance } from "@/lib/ads-compliance";
import {
  recordComplianceCheck,
  updateAdCreative,
} from "@/lib/ads-store";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const copy = typeof body?.copy === "string" ? body.copy.trim() : "";
    if (!copy) {
      return NextResponse.json(
        { error: "copy is required" },
        { status: 400 },
      );
    }

    const result = await checkAdCompliance({
      copy,
      platform: typeof body?.platform === "string" ? body.platform : undefined,
      jurisdiction: typeof body?.jurisdiction === "string" ? body.jurisdiction : undefined,
      practiceArea: typeof body?.practiceArea === "string" ? body.practiceArea : undefined,
      format: typeof body?.format === "string" ? body.format : undefined,
    });

    const creativeId = typeof body?.creativeId === "string" ? body.creativeId : null;

    // Best-effort persistence — don't fail the request if Supabase is unreachable.
    try {
      await recordComplianceCheck({
        ad_copy: copy,
        platform: typeof body?.platform === "string" ? body.platform : null,
        jurisdiction: typeof body?.jurisdiction === "string" ? body.jurisdiction : "NY,NJ",
        creative_id: creativeId,
        result,
      });
      if (creativeId && typeof result.score === "number") {
        await updateAdCreative(creativeId, {
          compliance_score: result.score,
          compliance_checked_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn("[ads/compliance/check] Persistence failed:", err);
    }

    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Compliance check failed";
    console.error("[ads/compliance/check] Failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
