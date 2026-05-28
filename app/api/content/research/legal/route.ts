/**
 * Legal Authority Library CRUD.
 *   GET    /api/content/research/legal?practiceArea=&search=
 *   POST   /api/content/research/legal        (create or update; include id to update)
 *   DELETE /api/content/research/legal?id=
 */

import { NextRequest, NextResponse } from "next/server";

import {
  deleteLegalSource,
  listLegalSources,
  upsertLegalSource,
} from "@/lib/research-libraries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  try {
    const sources = await listLegalSources({
      practiceArea: url.searchParams.get("practiceArea") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    });
    return NextResponse.json({ sources });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const urlVal = typeof body.url === "string" ? body.url.trim() : "";
  if (!name || !urlVal) {
    return NextResponse.json(
      { error: "name and url required" },
      { status: 400 },
    );
  }
  try {
    const source = await upsertLegalSource({
      id: typeof body.id === "string" ? body.id : undefined,
      name,
      url: urlVal,
      source_type: body.source_type as never,
      practice_area:
        typeof body.practice_area === "string" ? body.practice_area : null,
      jurisdiction:
        typeof body.jurisdiction === "string" ? body.jurisdiction : null,
      authority_level: body.authority_level as never,
      topics: Array.isArray(body.topics)
        ? (body.topics as string[]).filter((t) => typeof t === "string")
        : [],
      notes: typeof body.notes === "string" ? body.notes : null,
      review_status: body.review_status as never,
      last_verified_at:
        typeof body.last_verified_at === "string"
          ? body.last_verified_at
          : null,
    });
    return NextResponse.json({ source });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteLegalSource(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
