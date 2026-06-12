/**
 * GET    /api/seo/citations          — canonical NAP + tracked citations
 * POST   /api/seo/citations          — body: CitationInput (add/upsert by source)
 * PATCH  /api/seo/citations          — body: { id, ...patch }
 * DELETE /api/seo/citations?id=…       — remove a row
 *
 * AI NAP audit lives at /api/seo/citations/audit.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  addCitation,
  getCanonicalNap,
  listCitations,
  removeCitation,
  updateCitation,
  type CitationInput,
} from "@/lib/seo-citations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [canonical, citations] = await Promise.all([getCanonicalNap(), listCitations()]);
    return NextResponse.json({ canonical, citations });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list citations" },
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
  const input = (body && typeof body === "object" ? body : {}) as CitationInput;
  const result = await addCitation(input);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, row: result.row });
}

export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { id: _omit, ...patch } = obj;
  const result = await updateCitation(id, patch as Partial<CitationInput>);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, row: result.row });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const result = await removeCitation(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
