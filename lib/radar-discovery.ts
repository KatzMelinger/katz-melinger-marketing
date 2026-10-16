/**
 * Weekly discovery of keywords the firm does not track yet, with trend
 * (Oct 6 spec, Task 16). Runs every Monday (/api/seo/radar/discover).
 *
 * Sources:
 *   (a) DataForSEO keyword ideas for each practice area's seed list
 *   (b) Search Console queries with 20+ impressions in 28 days that no page
 *       clearly targets (no title or H1 covers the query)
 *   (c) the Competitor Gaps table (confirmed gaps)
 *   (d) the law change list in Brand settings ("lawChanges")
 *
 * Every term gets real volume, difficulty and a trend from DataForSEO; terms
 * the firm cannot act on are dropped (lib/radar-rules.ts); the Task 15
 * overlap check marks a term an existing page covers as "Update existing
 * page" with its URL. Kept terms join the Radar (source "emerging") and the
 * Keyword Tracker (status "emerging"), so ranking is measured from day one.
 * Nothing is drafted: Diana creates the brief from the Radar, and the draft
 * inherits the keyword.
 *
 * Trend is also refreshed on every existing Radar row, so the Trend column
 * and the Rising filter cover the whole list.
 */
import { getKeywordIdeas, getKeywordMetrics, type KeywordMetrics } from "./dataforseo";
import { gscQueries } from "./gsc-queries";
import { coverage, intentTokens, keywordProblem } from "./keyword-guard";
import { competitorTokensFromDomains, KM_BRAND_TOKENS, scoreKeyword } from "./keyword-filter";
import { listExclusionTerms } from "./keyword-exclusions";
import { loadExistingTargets } from "./keyword-selection-data";
import type { KMContentType, KMSearchIntent } from "./km-content-system";
import { scoreOpportunity } from "./opportunity-scoring";
import { getPillars } from "./pillars-store";
import { computeTrend, parseLawChanges, radarExclusion, RADAR_SEEDS } from "./radar-rules";
import { listCompetitors } from "./seo-competitors";
import { inferIntentWithConfidence, inferPillar, inferPracticeArea } from "./strategy-engine";
import { getSupabaseAdmin } from "./supabase-server";

/** Most new terms one run adds to the Radar and the Tracker. */
const MAX_NEW = 60;
const MIN_VOLUME = 20;

function contentTypeFromIntent(intent: KMSearchIntent): KMContentType {
  if (intent === "commercial") return "practice_page";
  if (intent === "proof") return "case_result";
  return "blog_post";
}

export type DiscoveryResult = {
  candidates: number;
  dropped: Record<string, number>;
  added: number;
  tracked: number;
  trendUpdated: number;
  rising: number;
  bySource: Record<string, number>;
  gsc: string;
};

export async function runRadarDiscovery(tenantId: string): Promise<DiscoveryResult> {
  const sb = getSupabaseAdmin();
  const dropped: Record<string, number> = {};
  const drop = (why: string) => (dropped[why] = (dropped[why] ?? 0) + 1);
  const from = new Map<string, Set<string>>();
  const add = (kw: string, src: string) => {
    const k = kw.toLowerCase().trim().replace(/\s+/g, " ");
    if (!k) return;
    if (!from.has(k)) from.set(k, new Set());
    from.get(k)!.add(src);
  };

  // (a) Keyword ideas, one call per practice area.
  const ideas: KeywordMetrics[] = [];
  for (const seeds of Object.values(RADAR_SEEDS)) {
    const got = await getKeywordIdeas(seeds, 300).catch(() => []);
    for (const g of got) {
      ideas.push(g);
      add(g.keyword, "keyword ideas");
    }
  }

  // (b) Search Console queries no page clearly targets.
  const [gsc, pages] = await Promise.all([
    gscQueries(tenantId, { days: 28, withPage: false }),
    sb.from("site_pages").select("title, h1").eq("tenant_id", tenantId).limit(3000),
  ]);
  const pageTokens = (pages.data ?? []).map((p) => intentTokens(`${p.title ?? ""} ${p.h1 ?? ""}`));
  if (gsc.ok) {
    for (const r of gsc.rows) {
      if (r.impressions < 20) continue;
      const t = intentTokens(r.query);
      if (t.size === 0 || pageTokens.some((p) => coverage(t, p) >= 0.99)) continue;
      add(r.query, "search console");
    }
  }

  // (c) Competitor gaps.
  const gaps = await sb.from("competitor_gaps").select("keyword").eq("tenant_id", tenantId).eq("confirmed_gap", true).limit(500);
  for (const g of gaps.data ?? []) add(String(g.keyword), "competitor gaps");

  // (d) Law changes in Brand settings.
  const lc = await sb.from("brand_voice_settings").select("value").eq("tenant_id", tenantId).eq("key", "lawChanges").maybeSingle();
  for (const l of parseLawChanges(lc.data?.value as string | undefined)) add(l.term, "law change");

  // Filter, then real numbers for what is left.
  const [competitors, customExclusions, pillars] = await Promise.all([
    listCompetitors(tenantId),
    listExclusionTerms(tenantId),
    getPillars(tenantId),
  ]);
  const ctx = { brandTokens: KM_BRAND_TOKENS, competitorTokens: competitorTokensFromDomains(competitors), customExclusions };
  const kept: string[] = [];
  for (const k of from.keys()) {
    const why = keywordProblem(k) ?? radarExclusion(k);
    if (why) {
      drop(why);
      continue;
    }
    const q = scoreKeyword(k, { searchVolume: null }, ctx);
    if (q.excluded) {
      drop(q.excludeReason ?? "Excluded");
      continue;
    }
    kept.push(k);
  }
  const metrics = new Map(ideas.map((m) => [m.keyword, m]));
  const missing = kept.filter((k) => !metrics.has(k));
  for (const [k, m] of await getKeywordMetrics(missing).catch(() => new Map<string, KeywordMetrics>())) metrics.set(k, m);

  // Existing Radar rows: refresh their trend; never re-add them.
  const { data: existingRows } = await sb.from("seo_opportunities").select("id, keyword, metrics").eq("tenant_id", tenantId);
  const existing = new Map((existingRows ?? []).map((r) => [String(r.keyword).toLowerCase(), r]));
  const existingMetrics = await getKeywordMetrics([...existing.keys()].filter((k) => !metrics.has(k))).catch(
    () => new Map<string, KeywordMetrics>(),
  );
  let trendUpdated = 0;
  for (const [k, row] of existing) {
    const m = metrics.get(k) ?? existingMetrics.get(k);
    if (!m || m.monthly.length < 6) continue;
    const t = computeTrend(m.monthly);
    const next = { ...((row.metrics as Record<string, unknown>) ?? {}), ...trendFields(t, m) };
    const { error } = await sb.from("seo_opportunities").update({ metrics: next }).eq("id", row.id);
    if (!error) trendUpdated++;
  }

  // New terms: real volume, not covered by a draft or the tracker already.
  const targets = await loadExistingTargets(tenantId);
  const fresh = kept
    .filter((k) => !existing.has(k))
    .map((k) => ({ k, m: metrics.get(k) }))
    .filter((x): x is { k: string; m: KeywordMetrics } => !!x.m && (x.m.volume ?? 0) >= MIN_VOLUME)
    .map((x) => ({ ...x, t: computeTrend(x.m.monthly) }))
    .sort((a, b) => Number(b.t.rising) - Number(a.t.rising) || (b.m.volume ?? 0) - (a.m.volume ?? 0));

  const rows: Record<string, unknown>[] = [];
  const toTrack: string[] = [];
  const bySource: Record<string, number> = {};
  const now = new Date().toISOString();
  for (const { k, m, t } of fresh) {
    if (rows.length >= MAX_NEW) break;
    const tok = intentTokens(k);
    const sameKeyword = targets.find(
      (x) => x.kind !== "page" && coverage(tok, intentTokens(x.text)) >= 0.99 && coverage(intentTokens(x.text), tok) >= 0.99,
    );
    if (sameKeyword) {
      drop(sameKeyword.kind === "draft" ? "Already a draft's keyword" : sameKeyword.kind === "tracker" ? "Already tracked" : "Already ranks top 20");
      continue;
    }
    const page = targets.find((x) => x.kind === "page" && coverage(tok, intentTokens(x.text)) >= 0.99);
    const clusterInput = { clusterName: k, primaryKeyword: k, volume: m.volume, currentRank: null };
    const practiceArea = inferPracticeArea(clusterInput);
    const { intent, labeledByDefault } = inferIntentWithConfidence(clusterInput);
    const q = scoreKeyword(k, { searchVolume: m.volume }, ctx);
    const actionLabel = page ? "update" : "create";
    const sources = [...(from.get(k) ?? [])];
    for (const s of sources) bySource[s] = (bySource[s] ?? 0) + 1;
    rows.push({
      tenant_id: tenantId,
      keyword: k,
      source: "emerging",
      search_volume: m.volume,
      keyword_difficulty: m.difficulty,
      relevance_score: q.relevanceScore,
      excluded: false,
      flags: q.flags,
      intent,
      labeled_by_default: labeledByDefault,
      practice_area: practiceArea,
      pillar_id: inferPillar(clusterInput, practiceArea, pillars),
      recommended_content_type: contentTypeFromIntent(intent),
      existing_url: page?.url ?? null,
      action_label: actionLabel,
      opportunity_score: Math.round(
        scoreOpportunity({ searchVolume: m.volume, ourPosition: null, competitorPosition: null, competitorsBeatingUs: 0, actionLabel }),
      ),
      priority_label: t.rising ? "high" : "medium",
      status: "new",
      metrics: {
        searchVolume: m.volume,
        source: "emerging",
        discoveredFrom: sources,
        ...trendFields(t, m),
        ...(page ? { updateExistingPage: page.url } : {}),
      },
      last_synced_at: now,
      updated_at: now,
    });
    if (!targets.some((x) => x.kind === "tracker" && x.text.toLowerCase() === k)) toTrack.push(k);
  }

  if (rows.length) {
    const { error } = await sb.from("seo_opportunities").upsert(rows, { onConflict: "tenant_id,keyword", ignoreDuplicates: true });
    if (error) throw new Error(`Radar insert: ${error.message}`);
  }

  // The Keyword Tracker, as "Emerging". Before supabase/radar_emerging_task16.sql
  // adds the status column, the note carries it.
  let tracked = 0;
  for (const k of toTrack) {
    const m = metrics.get(k);
    const row = {
      tenant_id: tenantId,
      keyword: k,
      practice_area: null,
      search_volume: m?.volume ?? null,
      difficulty: m?.difficulty != null ? Math.round(m.difficulty) : null,
      notes: `Emerging: found by the Radar on ${now.slice(0, 10)}`,
      status: "emerging",
    };
    let { error } = await sb.from("seo_keywords").insert(row);
    if (error && /status/.test(error.message)) {
      const { status: _s, ...rest } = row;
      void _s;
      ({ error } = await sb.from("seo_keywords").insert(rest));
    }
    if (!error) tracked++;
  }

  return {
    candidates: from.size,
    dropped,
    added: rows.length,
    tracked,
    trendUpdated,
    rising: rows.filter((r) => (r.metrics as { rising?: boolean }).rising).length,
    bySource,
    gsc: gsc.ok ? `${gsc.rows.length} queries` : gsc.error,
  };
}

function trendFields(t: ReturnType<typeof computeTrend>, m: KeywordMetrics) {
  return {
    trend3m: t.trend3m,
    trendYoy: t.trendYoy,
    rising: t.rising,
    monthly: m.monthly,
    volumeSource: "dataforseo",
    fetchedAt: m.fetchedAt,
    trendCheckedAt: new Date().toISOString(),
  };
}
