/**
 * POST /api/seo/keywords/refresh
 *
 * Refreshes ranking data for all tracked keywords by hitting Semrush once
 * for the firm's domain and matching tracked keywords against the result.
 * Preserves the previous rank in `previous_rank` so the UI can show movement.
 *
 * Replaces the SE Ranking version from
 *   artifacts/api-server/src/routes/keywords.ts (Replit).
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  getDomainKeywords,
  getKeywordDifficulty,
  type SemrushKeywordRow,
} from "@/lib/semrush";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = getSupabaseAdmin();

    const { data: items, error: loadErr } = await supabase
      .from("seo_keywords")
      .select("*")
      .order("created_at", { ascending: true });

    if (loadErr) {
      console.error("[seo/keywords/refresh] load error:", loadErr.message);
      return NextResponse.json(
        { error: "Failed to load tracked keywords" },
        { status: 500 },
      );
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ updated: 0, keywords: [] });
    }

    // Pull the firm's full domain_organic report once. 1000 lines covers
    // katzmelinger.com (currently ~3,595 organic keywords on the SEO Overview)
    // for the keywords likely to rank — adjust if the firm grows past this.
    let semrushRows: SemrushKeywordRow[];
    try {
      semrushRows = await getDomainKeywords(undefined, undefined, 1000, 0, "traffic", "desc");
    } catch (err: any) {
      console.error("[seo/keywords/refresh] Semrush failed:", err?.message);
      return NextResponse.json(
        { error: "Could not reach Semrush API" },
        { status: 502 },
      );
    }

    // Find which tracked keywords still need a difficulty score (Semrush
    // domain_organic doesn't include KD), and batch-fetch them.
    const keywordsNeedingKd: string[] = [];
    const matchByKeyword = new Map<string, SemrushKeywordRow | null>();

    for (const item of items) {
      const target = item.keyword.toLowerCase().trim();
      const exact = semrushRows.find(
        (r) => r.keyword.toLowerCase().trim() === target,
      );
      const partial =
        exact ??
        semrushRows.find(
          (r) =>
            r.keyword.toLowerCase().includes(target) ||
            target.includes(r.keyword.toLowerCase()),
        ) ??
        null;
      matchByKeyword.set(item.id, partial);

      if (partial && partial.difficulty === null) {
        keywordsNeedingKd.push(partial.keyword);
      }
    }

    const kdMap =
      keywordsNeedingKd.length > 0
        ? await getKeywordDifficulty(keywordsNeedingKd).catch(() => new Map())
        : new Map<string, number>();

    // Apply updates row by row. Could be batched with .upsert, but per-row
    // gives us cleaner error handling and the volume here is small (typically
    // <100 tracked keywords).
    let updated = 0;
    const now = new Date().toISOString();
    for (const item of items) {
      const match = matchByKeyword.get(item.id);
      if (!match) continue;

      const newRank = match.position;
      const difficulty =
        match.difficulty ??
        kdMap.get(match.keyword.toLowerCase().trim()) ??
        item.difficulty ?? // keep prior value if Semrush returned nothing new
        null;

      const { error: updateErr } = await supabase
        .from("seo_keywords")
        .update({
          previous_rank: item.current_rank,
          current_rank: newRank,
          search_volume: match.volume,
          difficulty,
          url: match.url,
          last_checked_at: now,
        })
        .eq("id", item.id);

      if (updateErr) {
        console.error(
          "[seo/keywords/refresh] update error for",
          item.keyword,
          updateErr.message,
        );
        continue;
      }
      updated++;
    }

    const { data: refreshed } = await supabase
      .from("seo_keywords")
      .select("*")
      .order("created_at", { ascending: true });

    return NextResponse.json({ updated, keywords: refreshed ?? [] });
  } catch (err: any) {
    console.error("[seo/keywords/refresh] Failed:", err?.message);
    return NextResponse.json(
      { error: "Failed to refresh keyword rankings" },
      { status: 500 },
    );
  }
}
