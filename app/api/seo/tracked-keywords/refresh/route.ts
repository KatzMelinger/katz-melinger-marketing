/**
 * POST /api/seo/tracked-keywords/refresh
 *   (UI trigger — Refresh button on /keyword-research and the
 *   `refresh_tracked_keywords` agent tool)
 *
 * GET /api/seo/tracked-keywords/refresh
 *   (Vercel Cron trigger — requires Authorization: Bearer ${CRON_SECRET})
 *
 * Refreshes ranking data for all tracked keywords by hitting Semrush once
 * for the firm's domain and matching tracked keywords against the result.
 * Preserves the previous rank in `previous_rank` so the UI can show movement.
 *
 * Replaces the SE Ranking version from
 *   artifacts/api-server/src/routes/keywords.ts (Replit).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  getDomainKeywords,
  getKeywordDifficulty,
  getPhraseMetrics,
  type SemrushKeywordRow,
} from "@/lib/semrush";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Vercel Cron auth — Vercel injects `Authorization: Bearer ${CRON_SECRET}` on
 * scheduled invocations when CRON_SECRET is set as an env var. Reject anything
 * else so the cron URL can't be abused as a public refresh button.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return await refreshTrackedKeywords();
}

export async function POST() {
  return await refreshTrackedKeywords();
}

async function refreshTrackedKeywords() {
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

    // For each tracked keyword try to match it against the firm's organic
    // report. If we have no match we still want volume + difficulty in the UI
    // — pull those via phrase_these / phrase_kdi for the unmatched set.
    const matchByKeyword = new Map<string, SemrushKeywordRow | null>();
    const unmatchedPhrases: string[] = [];
    const phrasesNeedingKd: string[] = [];

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
        phrasesNeedingKd.push(partial.keyword);
      }
      if (!partial) {
        unmatchedPhrases.push(item.keyword);
        phrasesNeedingKd.push(item.keyword);
      }
    }

    const [kdMap, metricsMap] = await Promise.all([
      phrasesNeedingKd.length > 0
        ? getKeywordDifficulty(phrasesNeedingKd).catch(
            () => new Map<string, number>(),
          )
        : Promise.resolve(new Map<string, number>()),
      unmatchedPhrases.length > 0
        ? getPhraseMetrics(unmatchedPhrases).catch(
            () =>
              new Map<string, { volume: number; cpc: number; competition: number }>(),
          )
        : Promise.resolve(
            new Map<string, { volume: number; cpc: number; competition: number }>(),
          ),
    ]);

    // Apply updates row by row. Could be batched with .upsert, but per-row
    // gives us cleaner error handling and the volume here is small (typically
    // <100 tracked keywords).
    let updated = 0;
    const now = new Date().toISOString();
    for (const item of items) {
      const match = matchByKeyword.get(item.id);
      const target = item.keyword.toLowerCase().trim();

      let newRank: number | null;
      let searchVolume: number | null;
      let difficulty: number | null;
      let url: string | null;

      if (match) {
        newRank = match.position;
        searchVolume = match.volume;
        difficulty =
          match.difficulty ??
          kdMap.get(match.keyword.toLowerCase().trim()) ??
          item.difficulty ??
          null;
        url = match.url;
      } else {
        // Not ranked — surface what we can from phrase-level Semrush data.
        const metrics = metricsMap.get(target);
        newRank = null;
        searchVolume = metrics ? metrics.volume : item.search_volume ?? null;
        difficulty = kdMap.get(target) ?? item.difficulty ?? null;
        url = null;
      }

      const { error: updateErr } = await supabase
        .from("seo_keywords")
        .update({
          previous_rank: item.current_rank,
          current_rank: newRank,
          search_volume: searchVolume,
          difficulty,
          url,
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
