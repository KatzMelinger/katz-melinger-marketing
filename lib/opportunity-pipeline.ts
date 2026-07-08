/**
 * Opportunity → Brief pipeline (the "Auto-Opportunity Engine").
 *
 * Chains the pieces that already exist into one ranked, validated report:
 *   1. SOURCE   — pull keyword opportunities from DataForSEO (competitor gaps +
 *                 missing targets + long-tail suggestions).
 *   2. VALIDATE — for each, pull the real 12-month DataForSEO trend + volume and
 *                 compute a transparent "worth it?" score (demand + trend + gap).
 *   3. RESEARCH — for the top winners, build a Research Packet (legal-authority
 *                 match + People-Also-Ask + confidence + legal-review flag).
 *   4. BRIEF    — attach an SEO content brief (outline / target keywords) so a
 *                 winner is ready to draft.
 *
 * Steps 3–4 are expensive (connectors + Claude), so only the top `topN`
 * candidates are deep-processed; everything else returns as a scored radar.
 */

import { listCompetitors } from "./seo-competitors";
import {
  buildContentSeoBrief,
  getKeywordGapVsCompetitors,
  getTrackedKeywordPerformance,
} from "./seo-intelligence";
import { getKeywordTrend } from "./dataforseo";
import { generateResearchPacket } from "./research-packet";
import { getTenantConfig } from "./tenant-config";

export type OpportunitySource = "competitor_gap" | "missing_target" | "long_tail";

export type ScoredOpportunity = {
  keyword: string;
  source: OpportunitySource;
  searchVolume: number | null;
  trend: number[];
  trendDirection: "rising" | "stable" | "falling" | "unknown";
  opportunityScore: number | null; // competitor rank-gap score (0-100)
  competitorsBeatingUs?: number;
  worthScore: number; // 0-100, demand + trend + gap
  worthReasons: string[];
  // Deep fields (winners only):
  packetId?: string;
  sourceConfidence?: "low" | "medium" | "high";
  legalReviewRequired?: boolean;
  suggestedFaqs?: { question: string; answer_hint: string }[];
  suggestedAngles?: string[];
  brief?: {
    titleIdeas: string[];
    headings: string[];
    targetKeywords: string[];
  };
  deepError?: string;
};

export type OpportunityPipelineResult = {
  generatedAt: string;
  candidatesConsidered: number;
  scored: ScoredOpportunity[];
  winners: ScoredOpportunity[];
  notes: string[];
};

type Candidate = {
  keyword: string;
  source: OpportunitySource;
  searchVolume: number | null;
  opportunityScore: number | null;
  competitorsBeatingUs?: number;
};

function scoreWorth(o: {
  searchVolume: number | null;
  trendDirection: ScoredOpportunity["trendDirection"];
  opportunityScore: number | null;
  source: OpportunitySource;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Demand (search volume) — up to 45 pts, log-scaled.
  const vol = o.searchVolume ?? 0;
  const volPts = vol > 0 ? Math.min(45, Math.round(Math.log10(vol + 1) * 15)) : 0;
  score += volPts;
  reasons.push(vol > 0 ? `Search volume ~${vol}/mo (+${volPts})` : "No volume data (+0)");

  // Trend direction — up to 25 pts.
  const trendPts =
    o.trendDirection === "rising"
      ? 25
      : o.trendDirection === "stable"
        ? 14
        : o.trendDirection === "falling"
          ? 4
          : 8;
  score += trendPts;
  reasons.push(`Trend ${o.trendDirection} (+${trendPts})`);

  // Competitive opportunity / source — up to 30 pts.
  let gapPts: number;
  if (o.opportunityScore != null) {
    gapPts = Math.round((o.opportunityScore / 100) * 30);
    reasons.push(`Competitor gap score ${o.opportunityScore} (+${gapPts})`);
  } else {
    gapPts = o.source === "missing_target" ? 18 : 10;
    reasons.push(`${o.source.replace(/_/g, " ")} (+${gapPts})`);
  }
  score += gapPts;

  return { score: Math.min(100, score), reasons };
}

export async function runOpportunityPipeline(args: {
  practiceArea?: string | null;
  competitor?: string | null;
  maxCandidates?: number; // how many to score (default 20)
  topN?: number; // how many winners to deep-process (default 3)
  deep?: boolean; // run research packet + brief on winners (default true)
} = {}): Promise<OpportunityPipelineResult> {
  const notes: string[] = [];
  const maxCandidates = Math.min(Math.max(args.maxCandidates ?? 20, 1), 40);
  const topN = Math.min(Math.max(args.topN ?? 3, 1), 8);
  const deep = args.deep !== false;
  const practiceArea = args.practiceArea ?? null;

  // Resolve the tenant's own SEO domain (per-tenant, not the global
  // katzmelinger.com constant) so the pipeline is correct under multi-tenancy.
  const { tenantId, seoDomain } = await getTenantConfig();

  // 1. SOURCE -----------------------------------------------------------------
  const competitors = args.competitor
    ? [args.competitor]
    : await listCompetitors(tenantId).catch(() => []);

  const [gaps, tracked] = await Promise.all([
    competitors.length > 0
      ? getKeywordGapVsCompetitors(competitors, seoDomain).catch(() => [])
      : Promise.resolve([]),
    getTrackedKeywordPerformance(seoDomain, tenantId).catch(() => ({
      tracked: [],
      missingTargets: [] as string[],
      trendingKeywords: [],
      longTailSuggestions: [] as { keyword: string; searchVolume: number }[],
    })),
  ]);

  if (competitors.length === 0) {
    notes.push("No tracked competitors — gap analysis skipped. Add competitors for richer opportunities.");
  }

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const add = (c: Candidate) => {
    const key = c.keyword.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push({ ...c, keyword: c.keyword.trim() });
  };
  for (const g of gaps) {
    add({
      keyword: g.keyword,
      source: "competitor_gap",
      searchVolume: g.searchVolume ?? null,
      opportunityScore: g.opportunityScore ?? null,
      competitorsBeatingUs: (g as { competitorsBeatingUs?: number }).competitorsBeatingUs,
    });
  }
  for (const lt of tracked.longTailSuggestions ?? []) {
    add({ keyword: lt.keyword, source: "long_tail", searchVolume: lt.searchVolume ?? null, opportunityScore: null });
  }
  for (const mt of tracked.missingTargets ?? []) {
    add({ keyword: mt, source: "missing_target", searchVolume: null, opportunityScore: null });
  }

  const shortlist = candidates.slice(0, maxCandidates);

  // 2. VALIDATE (real trend) + score -----------------------------------------
  const scored: ScoredOpportunity[] = await Promise.all(
    shortlist.map(async (c) => {
      const t = await getKeywordTrend(c.keyword).catch(() => ({
        searchVolume: null,
        trend: [] as number[],
        direction: "unknown" as const,
      }));
      const searchVolume = c.searchVolume ?? t.searchVolume ?? null;
      const { score, reasons } = scoreWorth({
        searchVolume,
        trendDirection: t.direction,
        opportunityScore: c.opportunityScore,
        source: c.source,
      });
      return {
        keyword: c.keyword,
        source: c.source,
        searchVolume,
        trend: t.trend,
        trendDirection: t.direction,
        opportunityScore: c.opportunityScore,
        competitorsBeatingUs: c.competitorsBeatingUs,
        worthScore: score,
        worthReasons: reasons,
      };
    }),
  );

  scored.sort((a, b) => b.worthScore - a.worthScore);

  // 3 + 4. RESEARCH + BRIEF for the top winners ------------------------------
  const winners = scored.slice(0, topN);
  if (deep) {
    for (const w of winners) {
      try {
        const packet = await generateResearchPacket({
          topic: w.keyword,
          practiceArea,
          primaryKeyword: w.keyword,
          captureToLibrary: true,
        });
        w.packetId = packet.id;
        w.sourceConfidence = packet.source_confidence;
        w.legalReviewRequired = packet.legal_review_required;
        w.suggestedFaqs = packet.suggested_faqs?.slice(0, 8);
        w.suggestedAngles = packet.suggested_angles;

        const brief = await buildContentSeoBrief({
          topic: w.keyword,
          practiceArea: practiceArea ?? undefined,
          competitorDomains: competitors,
        });
        w.brief = {
          titleIdeas: brief.titleIdeas,
          headings: brief.headings,
          targetKeywords: brief.targetKeywords,
        };
      } catch (e) {
        w.deepError = e instanceof Error ? e.message : "deep processing failed";
      }
    }
  } else {
    notes.push("deep=false — research packets + briefs were skipped (scored radar only).");
  }

  return {
    generatedAt: new Date().toISOString(),
    candidatesConsidered: shortlist.length,
    scored,
    winners,
    notes,
  };
}
