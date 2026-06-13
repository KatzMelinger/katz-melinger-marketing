/**
 * POST /api/seo/opportunities/import  (multipart/form-data)
 *
 * Imports a named SEMrush keyword list (a "missed"/gap export the marketing
 * team builds inside SEMrush) into the persistent seo_opportunities spine.
 *
 * Form fields:
 *   file          the CSV export (required)
 *   listName      the list label, e.g. "gap retaliation" (required)
 *   practiceArea  optional override ("employment" | "collections"); inferred
 *                 per-keyword when omitted
 *
 * Each row is normalized, run through the SAME relevance filter + classifier +
 * content-overlap dedupe as the SEMrush /sync job, then upserted (idempotent on
 * `keyword`) with source = 'imported' and the given `list_name`. Statuses the
 * user already acted on (dismissed/brief/in_production/published) are preserved.
 *
 * This is the manual-but-structured counterpart to /sync: /sync pulls live
 * competitor gaps from a fixed domain set, while this lets a human bring in any
 * curated list and keep it tagged.
 */

import { NextResponse } from "next/server";

import { parseCsv, pickColumn, parseNumber } from "@/lib/csv";
import { detectContentOverlap } from "@/lib/content-overlap";
import type { KMContentType, KMPracticeArea, KMSearchIntent } from "@/lib/km-content-system";
import {
  competitorTokensFromDomains,
  KM_BRAND_TOKENS,
  scoreKeyword,
} from "@/lib/keyword-filter";
import { listCompetitors } from "@/lib/seo-competitors";
import { inferIntent, inferPillar, inferPracticeArea } from "@/lib/strategy-engine";
import { getPillars } from "@/lib/pillars-store";
import { getTenantDb } from "@/lib/tenant-db";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ROWS = 1000;
const LOCKED_STATUSES = new Set(["dismissed", "brief", "in_production", "published"]);

const KEYWORD_COLS = ["keyword", "keywords", "phrase", "query"];
const VOLUME_COLS = ["search volume", "volume", "search vol.", "sv"];
const KD_COLS = ["keyword difficulty", "difficulty", "kd", "kd %", "kd%"];
const CPC_COLS = ["cpc", "cpc (usd)", "cpc usd"];
const COMPETITOR_COLS = ["competitor", "competitor url", "competitor domain", "domain", "url"];
const POSITION_COLS = ["competitor position", "position", "pos", "rank"];

function contentTypeFromIntent(intent: KMSearchIntent): KMContentType {
  if (intent === "commercial") return "practice_page";
  if (intent === "proof") return "case_result";
  return "blog_post";
}

const normalize = (k: string) => k.trim().toLowerCase();

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A CSV file is required" }, { status: 400 });
  }

  const listName = String(form.get("listName") ?? "").trim();
  if (!listName) {
    return NextResponse.json({ error: "A list name is required" }, { status: 400 });
  }

  const areaOverrideRaw = String(form.get("practiceArea") ?? "").trim();
  const areaOverride: KMPracticeArea | null =
    areaOverrideRaw === "employment" || areaOverrideRaw === "collections"
      ? areaOverrideRaw
      : null;

  let text: string;
  try {
    text = await file.text();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file" }, { status: 400 });
  }

  const table = parseCsv(text);
  if (table.rows.length === 0) {
    return NextResponse.json({ error: "No rows found in the file" }, { status: 400 });
  }
  if (!table.headers.some((h) => KEYWORD_COLS.includes(h))) {
    return NextResponse.json(
      {
        error:
          "Could not find a Keyword column. Export from SEMrush with a 'Keyword' column (Keyword Gap, Organic Research, or Position Tracking).",
      },
      { status: 400 },
    );
  }

  // Build deduped candidates from the file.
  type Candidate = {
    keyword: string;
    searchVolume: number | null;
    keywordDifficulty: number | null;
    cpc: number | null;
    competitor: string | null;
    competitorPosition: number | null;
  };
  const byKeyword = new Map<string, Candidate>();
  for (const row of table.rows) {
    const keyword = normalize(pickColumn(row, KEYWORD_COLS));
    if (!keyword || byKeyword.has(keyword)) continue;
    byKeyword.set(keyword, {
      keyword,
      searchVolume: parseNumber(pickColumn(row, VOLUME_COLS)),
      keywordDifficulty: parseNumber(pickColumn(row, KD_COLS)),
      cpc: parseNumber(pickColumn(row, CPC_COLS)),
      competitor: pickColumn(row, COMPETITOR_COLS) || null,
      competitorPosition: parseNumber(pickColumn(row, POSITION_COLS)),
    });
    if (byKeyword.size >= MAX_ROWS) break;
  }

  const candidates = Array.from(byKeyword.values());
  if (candidates.length === 0) {
    return NextResponse.json({ error: "No usable keywords in the file" }, { status: 400 });
  }

  try {
    const competitors = await listCompetitors().catch(() => [] as string[]);
    const ctx = {
      brandTokens: KM_BRAND_TOKENS,
      competitorTokens: competitorTokensFromDomains(competitors),
    };

    const db = await getTenantDb();
    const keys = candidates.map((c) => c.keyword);

    // Preserve user-acted statuses (same rule as /sync). RLS-scoped to tenant.
    const { data: existingRows } = await db
      .from("seo_opportunities")
      .select("keyword, status")
      .in("keyword", keys);
    const existingStatus = new Map(
      (existingRows ?? []).map((r) => [r.keyword as string, r.status as string]),
    );

    // Dedupe against existing site pages — map covered keywords to their page.
    const overlap = await detectContentOverlap(keys).catch(() => null);
    const coveredByKeyword = new Map<string, string>();
    for (const m of overlap?.matches ?? []) {
      const top = m.pages[0];
      if (top) coveredByKeyword.set(m.term.trim().toLowerCase(), top.url);
    }

    const now = new Date().toISOString();
    // Live, DB-driven pillar list so the grouper routes to current pillars.
    const pillars = await getPillars();
    const rows = candidates.map((c) => {
      const quality = scoreKeyword(c.keyword, { searchVolume: c.searchVolume }, ctx);
      const prior = existingStatus.get(c.keyword);
      const status = prior && LOCKED_STATUSES.has(prior) ? prior : "new";

      const clusterInput = {
        clusterName: c.keyword,
        primaryKeyword: c.keyword,
        volume: c.searchVolume,
        currentRank: null,
      };
      const practiceArea = areaOverride ?? inferPracticeArea(clusterInput);
      const intent = inferIntent(clusterInput);
      const pillarId = inferPillar(clusterInput, practiceArea, pillars);

      return {
        keyword: c.keyword,
        source: "imported",
        list_name: listName,
        import_source: "semrush_csv",
        competitor: c.competitor,
        search_volume: c.searchVolume,
        keyword_difficulty: c.keywordDifficulty,
        cpc: c.cpc,
        competitor_position: c.competitorPosition,
        relevance_score: quality.relevanceScore,
        excluded: quality.excluded,
        exclude_reason: quality.excludeReason ?? null,
        flags: quality.flags,
        intent,
        practice_area: practiceArea,
        pillar_id: pillarId,
        recommended_content_type: contentTypeFromIntent(intent),
        existing_url: coveredByKeyword.get(c.keyword) ?? null,
        status,
        metrics: {
          searchVolume: c.searchVolume,
          keywordDifficulty: c.keywordDifficulty,
          cpc: c.cpc,
          competitorPosition: c.competitorPosition,
          competitor: c.competitor,
          listName,
        },
        last_synced_at: now,
        updated_at: now,
      };
    });

    // upsert stamps tenant_id on every row; conflict key includes tenant_id.
    const { error } = await db.upsert("seo_opportunities", rows, {
      onConflict: "tenant_id,keyword",
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const excluded = rows.filter((r) => r.excluded).length;
    return NextResponse.json({
      imported: rows.length,
      excluded,
      kept: rows.length - excluded,
      listName,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 },
    );
  }
}
