/**
 * GET    /api/seo/keywords/targets             — list tracked target keywords
 * POST   /api/seo/keywords/targets             — body: { keyword, source? }
 * DELETE /api/seo/keywords/targets?keyword=…   — remove a tracked target
 *
 * Mirrors /api/seo/competitors. The source of truth is the Supabase
 * seo_target_keywords table; lib/seo-intelligence's getTargetKeywords()
 * reads from the same table.
 */

import { NextRequest, NextResponse } from "next/server";

import { addTarget, listTargets, removeTarget } from "@/lib/seo-targets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const targets = await listTargets();
    return NextResponse.json({ targets });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list targets" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const keyword = typeof obj.keyword === "string" ? obj.keyword : "";
  const source = obj.source === "suggested" ? "suggested" : "manual";

  const result = await addTarget(keyword, source);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Invalid keyword" }, { status: 400 });
  }
  const targets = await listTargets();
  return NextResponse.json({ ok: true, added: result.keyword, targets });
}

export async function DELETE(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("keyword") ?? "";
  const result = await removeTarget(keyword);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  const targets = await listTargets();
  return NextResponse.json({ ok: true, removed: result.keyword, targets });
}
