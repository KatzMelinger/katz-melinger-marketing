/**
 * People Ask & Trends Library CRUD.
 *   GET    /api/content/research/people-ask?practiceArea=&sourceType=&search=
 *   POST   /api/content/research/people-ask    (create or update; include id to update)
 *   DELETE /api/content/research/people-ask?id=
 */

import { NextRequest, NextResponse } from "next/server";

import {
  deletePeopleAskSource,
  listPeopleAskSources,
  upsertPeopleAskSource,
  type PeopleAskSourceType,
} from "@/lib/research-libraries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  try {
    const sources = await listPeopleAskSources({
      practiceArea: url.searchParams.get("practiceArea") ?? undefined,
      sourceType:
        (url.searchParams.get("sourceType") as PeopleAskSourceType | null) ??
        undefined,
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
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  try {
    const source = await upsertPeopleAskSource({
      id: typeof body.id === "string" ? body.id : undefined,
      content,
      source_type: body.source_type as never,
      practice_area:
        typeof body.practice_area === "string" ? body.practice_area : null,
      topic_tags: Array.isArray(body.topic_tags)
        ? (body.topic_tags as string[]).filter((t) => typeof t === "string")
        : [],
      jurisdiction:
        typeof body.jurisdiction === "string" ? body.jurisdiction : null,
      use_case: typeof body.use_case === "string" ? body.use_case : null,
      trend_signal:
        typeof body.trend_signal === "string" ? body.trend_signal : null,
      source_url:
        typeof body.source_url === "string" ? body.source_url : null,
      review_status: body.review_status as never,
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
    await deletePeopleAskSource(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
