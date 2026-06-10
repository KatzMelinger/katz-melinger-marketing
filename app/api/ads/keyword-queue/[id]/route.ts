/**
 * PATCH /api/ads/keyword-queue/[id]  — approve or reject a queued suggestion.
 * Body: { decision: "approved" | "rejected" }
 *
 * On approval the keyword is copied into the live negative_keywords list.
 */

import { NextRequest, NextResponse } from "next/server";

import { decideKeywordSuggestion } from "@/lib/ads-store";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const decision = body?.decision;
    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json(
        { error: "decision must be 'approved' or 'rejected'" },
        { status: 400 },
      );
    }
    const item = await decideKeywordSuggestion(id, decision);
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update queue item" },
      { status: 500 },
    );
  }
}
