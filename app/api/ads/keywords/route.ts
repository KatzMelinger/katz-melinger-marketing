/**
 * GET  /api/ads/keywords  — list all negative keywords
 * POST /api/ads/keywords  — add one
 */

import { NextRequest, NextResponse } from "next/server";

import {
  createNegativeKeyword,
  listNegativeKeywords,
  type NegativeKeywordMatchType,
} from "@/lib/ads-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const keywords = await listNegativeKeywords();
    return NextResponse.json({ keywords });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list keywords" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
    if (!keyword) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }
    const match_type = (typeof body?.match_type === "string"
      ? body.match_type
      : "phrase") as NegativeKeywordMatchType;
    const created = await createNegativeKeyword({
      keyword,
      match_type,
      reason: typeof body?.reason === "string" ? body.reason : null,
      source: typeof body?.source === "string" ? body.source : "manual",
    });
    return NextResponse.json({ keyword: created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create keyword";
    // Unique violation surfaces as a duplicate
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json({ error: "That keyword is already in the list" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
