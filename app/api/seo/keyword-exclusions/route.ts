/**
 * GET    /api/seo/keyword-exclusions            — list Diana's custom exclusion terms
 * POST   /api/seo/keyword-exclusions            — body: { term, reason? }  (adds + applies now)
 * DELETE /api/seo/keyword-exclusions?term=…      — remove a term (+ restores rows it excluded)
 */

import { NextRequest, NextResponse } from "next/server";

import {
  addKeywordExclusion,
  listKeywordExclusions,
  removeKeywordExclusion,
} from "@/lib/keyword-exclusions";

export const dynamic = "force-dynamic";

export async function GET() {
  const exclusions = await listKeywordExclusions();
  return NextResponse.json({ exclusions });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const term = typeof obj.term === "string" ? obj.term : "";
  const reason = typeof obj.reason === "string" ? obj.reason : undefined;

  const result = await addKeywordExclusion(term, reason);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Invalid term" }, { status: 400 });
  }
  const exclusions = await listKeywordExclusions();
  return NextResponse.json({
    ok: true,
    added: result.term,
    excludedCount: result.excludedCount ?? 0,
    exclusions,
  });
}

export async function DELETE(request: NextRequest) {
  const term = request.nextUrl.searchParams.get("term") ?? "";
  const result = await removeKeywordExclusion(term);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  const exclusions = await listKeywordExclusions();
  return NextResponse.json({
    ok: true,
    removed: result.term,
    restoredCount: result.restoredCount ?? 0,
    exclusions,
  });
}
