/**
 * GET /api/seo/briefs/secondary?keyword=...
 *
 * Suggests secondary keywords for the brief wizard's Step 3, sourced for free
 * from our own seo_opportunities pool: keywords that share a significant word
 * with the primary, returned with their volume / KD / intent (the SEMrush-style
 * "secondary keywords" table). No extra LLM or SEMrush calls.
 */

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "what", "are", "how", "your", "you", "lawyer",
  "attorney", "a", "an", "of", "in", "to", "is", "it", "on", "or", "at", "ny",
  "nyc", "new", "york", "nj",
]);

function significantWords(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

export async function GET(req: NextRequest) {
  try {
    const keyword = (req.nextUrl.searchParams.get("keyword") ?? "").trim().toLowerCase();
    if (!keyword) return NextResponse.json({ suggestions: [] });

    const words = significantWords(keyword);
    if (words.length === 0) return NextResponse.json({ suggestions: [] });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("seo_opportunities")
      .select("keyword, search_volume, keyword_difficulty, intent")
      .eq("excluded", false)
      .limit(1000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const suggestions = (data ?? [])
      .filter((r) => {
        const k = (r.keyword as string).toLowerCase();
        if (k === keyword) return false;
        const kw = significantWords(k);
        return kw.some((w) => words.includes(w));
      })
      .map((r) => ({
        keyword: r.keyword as string,
        volume: (r.search_volume as number | null) ?? null,
        kd: (r.keyword_difficulty as number | null) ?? null,
        intent: (r.intent as string | null) ?? null,
      }))
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 15);

    return NextResponse.json({ suggestions });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
