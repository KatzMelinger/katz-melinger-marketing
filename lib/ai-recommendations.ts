/**
 * "What should we do next" recommendations from Claude.
 *
 * Pulls a snapshot of the firm's current state across SEO, AEO, and
 * cannibalization, packages it into a single prompt, and asks Claude for
 * prioritized actions. The output is structured JSON so the UI can render it
 * as a sortable to-do list rather than a wall of prose.
 *
 * Designed to be cheap to call (single Claude request) so the dashboard can
 * refresh recommendations whenever the user clicks "Generate."
 */

import { getTenantClient } from "./tenant-db";
import { getFirmContext } from "./firm-context";
import {
  KEYWORD_RESEARCH_MODEL,
  extractJSON,
  getAnthropic,
} from "./anthropic";

export type Recommendation = {
  title: string;
  rationale: string;
  category: "seo" | "aeo" | "content" | "technical" | "local" | "social";
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  evidence: string;
};

type SnapshotRow = {
  promptId: string;
  prompt: string;
  provider: string;
  selfMentioned: boolean;
  selfPosition: number | null;
  selfSentiment: string | null;
  competitorBrands: { name: string; position: number }[];
  citationDomains: string[];
};

async function loadLatestAEOSnapshot(): Promise<{
  runDate: string | null;
  rows: SnapshotRow[];
}> {
  const { supabase } = await getTenantClient();
  const { data: latest } = await supabase
    .from("aeo_runs")
    .select("id, completed_at")
    .eq("status", "done")
    .order("completed_at", { ascending: false })
    .limit(1);
  if (!latest || latest.length === 0) return { runDate: null, rows: [] };
  const runId = latest[0].id;

  const { data: responses } = await supabase
    .from("aeo_responses")
    .select(
      "prompt_id, provider, self_mentioned, self_position, self_sentiment, brand_mentions, citations",
    )
    .eq("run_id", runId);

  const promptIds = Array.from(new Set((responses ?? []).map((r) => r.prompt_id as string)));
  const promptMap = new Map<string, string>();
  if (promptIds.length > 0) {
    const { data: prompts } = await supabase
      .from("aeo_prompts")
      .select("id, prompt")
      .in("id", promptIds);
    for (const p of prompts ?? []) promptMap.set(p.id as string, p.prompt as string);
  }

  const rows: SnapshotRow[] = (responses ?? []).map((r) => {
    const mentions = Array.isArray(r.brand_mentions)
      ? (r.brand_mentions as { name: string; type: string; position: number }[])
      : [];
    const citations = Array.isArray(r.citations)
      ? (r.citations as { domain: string }[])
      : [];
    return {
      promptId: r.prompt_id as string,
      prompt: promptMap.get(r.prompt_id as string) ?? "(unknown)",
      provider: r.provider as string,
      selfMentioned: !!r.self_mentioned,
      selfPosition: (r.self_position as number | null) ?? null,
      selfSentiment: (r.self_sentiment as string | null) ?? null,
      competitorBrands: mentions
        .filter((m) => m.type === "competitor")
        .map((m) => ({ name: m.name, position: m.position })),
      citationDomains: Array.from(new Set(citations.map((c) => c.domain).filter(Boolean))),
    };
  });

  return { runDate: latest[0].completed_at as string, rows };
}

async function loadSEOContext() {
  const { supabase } = await getTenantClient();
  const { data: keywords } = await supabase
    .from("seo_keywords")
    .select("keyword, current_rank, previous_rank, search_volume, url, last_checked_at")
    .order("search_volume", { ascending: false, nullsFirst: false })
    .limit(50);
  const { data: cannib } = await supabase
    .from("cannibalization_snapshots")
    .select("issues, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  return {
    keywords: keywords ?? [],
    cannibalization:
      cannib && cannib.length > 0
        ? (cannib[0].issues as { keyword: string; severity: string; urls: { url: string; position: number }[] }[])
        : [],
  };
}

export async function generateRecommendations(
  opts: { suppressTitles?: string[] } = {},
): Promise<{
  recommendations: Recommendation[];
  generatedAt: string;
  evidence: { aeoRows: number; keywords: number; cannibalization: number };
}> {
  const [firm, aeo, seo] = await Promise.all([
    getFirmContext(),
    loadLatestAEOSnapshot(),
    loadSEOContext(),
  ]);

  const suppress = (opts.suppressTitles ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 200);

  const aeoSummary = aeo.rows.length === 0
    ? "(no AEO run yet)"
    : aeo.rows
        .slice(0, 40)
        .map(
          (r) =>
            `- "${r.prompt}" via ${r.provider}: ` +
            `${r.selfMentioned ? `mentioned (pos ${r.selfPosition}, ${r.selfSentiment ?? "—"})` : "NOT mentioned"}` +
            (r.competitorBrands.length > 0
              ? ` | competitors: ${r.competitorBrands.map((c) => `${c.name} (#${c.position})`).join(", ")}`
              : "") +
            (r.citationDomains.length > 0
              ? ` | sources: ${r.citationDomains.slice(0, 5).join(", ")}`
              : ""),
        )
        .join("\n");

  const keywordSummary = seo.keywords.length === 0
    ? "(no tracked keywords)"
    : seo.keywords
        .slice(0, 30)
        .map(
          (k) =>
            `- "${k.keyword}": rank ${k.current_rank ?? "—"} (was ${k.previous_rank ?? "—"}), vol ${k.search_volume ?? 0}`,
        )
        .join("\n");

  const cannibSummary =
    seo.cannibalization.length === 0
      ? "(no cannibalization detected)"
      : seo.cannibalization
          .slice(0, 15)
          .map(
            (i) =>
              `- "${i.keyword}" [${i.severity}]: ${i.urls.map((u) => `${u.url} (#${u.position})`).join(" | ")}`,
          )
          .join("\n");

  const systemPrompt = `You are a marketing strategist for a law firm. You receive a snapshot of the firm's current SEO and AI-search performance and produce a prioritized list of actions. Be specific, name pages, name competitors, name prompts. Avoid platitudes. Optimize for actionability.`;

  const suppressBlock =
    suppress.length > 0
      ? `\n\nThe user has already completed OR rejected these recommendations. Do NOT suggest them again, and do NOT suggest near-duplicates. Pick fresh actions:\n${suppress
          .map((t) => `- ${t}`)
          .join("\n")}`
      : "";

  const userPrompt = `Firm context:
${firm}

Latest AEO sweep (${aeo.runDate ?? "no runs yet"}):
${aeoSummary}

Top tracked keywords:
${keywordSummary}

Cannibalization issues:
${cannibSummary}${suppressBlock}

Produce 6–12 recommendations. Each must point at concrete evidence above. Return JSON only:

{
  "recommendations": [
    {
      "title": "Action sentence (under 90 chars)",
      "rationale": "Why this matters now (1–2 sentences)",
      "category": "seo|aeo|content|technical|local|social",
      "effort": "low|medium|high",
      "impact": "low|medium|high",
      "evidence": "Quote a specific row above (prompt, keyword, URL) so the reader can verify"
    }
  ]
}`;

  const response = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "";
  const parsed = extractJSON<{ recommendations: Recommendation[] }>(text);

  return {
    recommendations: parsed.recommendations ?? [],
    generatedAt: new Date().toISOString(),
    evidence: {
      aeoRows: aeo.rows.length,
      keywords: seo.keywords.length,
      cannibalization: seo.cannibalization.length,
    },
  };
}
