/**
 * /api/seo/tracked-keywords
 *   GET  — list all tracked keywords, ordered oldest first
 *   POST — add a new tracked keyword. Auto-populates current rank, volume,
 *          difficulty, and URL from DataForSEO at insert time.
 *
 * Note: this is at /api/seo/tracked-keywords (not /api/seo/keywords) because
 * the latter is already used by the SEO Overview page for competitor gap
 * analysis.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantDb } from "@/lib/tenant-db";
import { lookupKeywordRanking } from "@/lib/dataforseo";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_KEYWORD_LENGTH = 200;
const MAX_NOTES_LENGTH = 1000;

export async function GET() {
  try {
    const db = await getTenantDb();
    const { data, error } = await db
      .from("seo_keywords")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[seo/tracked-keywords GET] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to load keywords" }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (err: any) {
    console.error("[seo/tracked-keywords GET] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to load keywords" }, { status: 500 });
  }
}

type CreateKeywordBody = {
  keyword?: unknown;
  practiceArea?: unknown;
  notes?: unknown;
};

function validateBody(body: CreateKeywordBody): {
  ok: true;
  value: { keyword: string; practice_area: string | null; notes: string | null };
} | { ok: false; error: string } {
  const { keyword, practiceArea, notes } = body;

  if (typeof keyword !== "string" || keyword.trim().length === 0) {
    return { ok: false, error: "keyword is required" };
  }
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return { ok: false, error: `keyword must be under ${MAX_KEYWORD_LENGTH} characters` };
  }
  if (practiceArea !== undefined && practiceArea !== null && typeof practiceArea !== "string") {
    return { ok: false, error: "practiceArea must be a string" };
  }
  if (notes !== undefined && notes !== null) {
    if (typeof notes !== "string") return { ok: false, error: "notes must be a string" };
    if (notes.length > MAX_NOTES_LENGTH) {
      return { ok: false, error: `notes must be under ${MAX_NOTES_LENGTH} characters` };
    }
  }
  return {
    ok: true,
    value: {
      keyword: keyword.trim(),
      practice_area: typeof practiceArea === "string" ? practiceArea : null,
      notes: typeof notes === "string" ? notes : null,
    },
  };
}

export async function DELETE(req: NextRequest) {
  const keyword = req.nextUrl.searchParams.get("keyword")?.trim();
  if (!keyword) {
    return NextResponse.json({ error: "keyword query param required" }, { status: 400 });
  }
  try {
    const db = await getTenantDb();
    const { error } = await db
      .from("seo_keywords")
      .delete()
      .ilike("keyword", keyword);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, removed: keyword });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to remove keyword" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as CreateKeywordBody;
    const parsed = validateBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const ranking = await lookupKeywordRanking(parsed.value.keyword).catch(() => ({
      currentRank: null,
      searchVolume: null,
      difficulty: null,
      url: null,
    }));

    const db = await getTenantDb();
    const { data, error } = await db
      .insert("seo_keywords", {
        keyword: parsed.value.keyword,
        practice_area: parsed.value.practice_area,
        notes: parsed.value.notes,
        current_rank: ranking.currentRank,
        search_volume: ranking.searchVolume,
        difficulty: ranking.difficulty,
        url: ranking.url,
        last_checked_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "That keyword is already being tracked" },
          { status: 409 },
        );
      }
      console.error("[seo/tracked-keywords POST] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to add keyword" }, { status: 500 });
    }

    // Note: DataForSEO is read-only (no campaign-management API), so there is no
    // two-way position-tracking push. Rank tracking is pull-only — the daily
    // refresh cron reads ranks via ranked_keywords + a live-SERP fallback.

    return NextResponse.json(data, { status: 201 });
  } catch (err: any) {
    console.error("[seo/tracked-keywords POST] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to add keyword" }, { status: 500 });
  }
}
