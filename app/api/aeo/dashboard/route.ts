/**
 * GET /api/aeo/dashboard
 *
 * Aggregates the latest AEO run into the metrics the dashboard needs:
 *   - prompt coverage % (% of prompts where the firm appeared in any provider)
 *   - share of voice per provider (firm vs competitor brand mentions)
 *   - top citation domains
 *   - per-prompt detail rows
 *   - sentiment distribution
 *
 * One round-trip; everything is computed in-memory from the responses table.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { ALL_PROVIDERS, getAvailableProviders } from "@/lib/aeo-providers";

export const runtime = "nodejs";

type ResponseRow = {
  id: string;
  prompt_id: string;
  provider: string;
  model: string | null;
  response_text: string | null;
  citations: { url: string; domain: string; title?: string }[];
  brand_mentions: { name: string; type: "self" | "competitor"; position: number; sentiment: string | null }[];
  self_mentioned: boolean;
  self_position: number | null;
  self_sentiment: string | null;
  authority_sources: string[];
  latency_ms: number | null;
  error: string | null;
};

export async function GET() {
  const supabase = getSupabaseAdmin();

  // Latest done run.
  const { data: latest } = await supabase
    .from("aeo_runs")
    .select("id, status, completed_at, providers, prompt_count, response_count, failure_count")
    .eq("status", "done")
    .order("completed_at", { ascending: false })
    .limit(1);

  // Whether *any* run is in flight (for the UI's polling banner).
  const { data: active } = await supabase
    .from("aeo_runs")
    .select("id, status, started_at")
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1);

  const providerStatus = ALL_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    available: p.isAvailable(),
    defaultModel: p.defaultModel,
  }));

  if (!latest || latest.length === 0) {
    return NextResponse.json({
      runId: null,
      runDate: null,
      providerStatus,
      activeRunId: active?.[0]?.id ?? null,
      promptCoverage: { total: 0, covered: 0, pct: 0 },
      providerCoverage: [],
      shareOfVoice: [],
      topCitationDomains: [],
      authoritySources: [],
      promptDetail: [],
      sentimentDistribution: { positive: 0, neutral: 0, negative: 0, mixed: 0, none: 0 },
    });
  }

  const runId = latest[0].id;

  const { data: responses, error: rErr } = await supabase
    .from("aeo_responses")
    .select(
      "id, prompt_id, provider, model, response_text, citations, brand_mentions, self_mentioned, self_position, self_sentiment, authority_sources, latency_ms, error",
    )
    .eq("run_id", runId);
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const rows = (responses ?? []) as ResponseRow[];

  const { data: prompts } = await supabase
    .from("aeo_prompts")
    .select("id, prompt, category, intent, geography");
  const promptMap = new Map<string, { prompt: string; category: string | null; intent: string | null; geography: string | null }>();
  for (const p of prompts ?? []) {
    promptMap.set(p.id as string, {
      prompt: p.prompt as string,
      category: (p.category as string | null) ?? null,
      intent: (p.intent as string | null) ?? null,
      geography: (p.geography as string | null) ?? null,
    });
  }

  // Prompt coverage — across ALL prompts the run targeted, did we appear anywhere?
  const promptIds = Array.from(new Set(rows.map((r) => r.prompt_id)));
  const totalPrompts = promptIds.length;
  const coveredPrompts = promptIds.filter((pid) =>
    rows.some((r) => r.prompt_id === pid && r.self_mentioned),
  ).length;
  const promptCoverage = {
    total: totalPrompts,
    covered: coveredPrompts,
    pct: totalPrompts > 0 ? Math.round((coveredPrompts / totalPrompts) * 100) : 0,
  };

  // Coverage per provider.
  const providerCoverage = Array.from(new Set(rows.map((r) => r.provider))).map((provider) => {
    const subset = rows.filter((r) => r.provider === provider);
    const covered = subset.filter((r) => r.self_mentioned).length;
    return {
      provider,
      total: subset.length,
      covered,
      pct: subset.length > 0 ? Math.round((covered / subset.length) * 100) : 0,
    };
  });

  // Share of voice — counts of brand mentions (self + competitors), per provider.
  const sovMap = new Map<string, Map<string, { count: number; type: "self" | "competitor" }>>();
  for (const r of rows) {
    const inner = sovMap.get(r.provider) ?? new Map();
    for (const m of r.brand_mentions ?? []) {
      const cur = inner.get(m.name) ?? { count: 0, type: m.type };
      cur.count += 1;
      inner.set(m.name, cur);
    }
    sovMap.set(r.provider, inner);
  }
  const shareOfVoice = Array.from(sovMap.entries()).map(([provider, inner]) => {
    const totals = Array.from(inner.entries())
      .map(([name, v]) => ({ name, count: v.count, type: v.type }))
      .sort((a, b) => b.count - a.count);
    const grand = totals.reduce((sum, t) => sum + t.count, 0);
    return {
      provider,
      total: grand,
      brands: totals.map((t) => ({
        ...t,
        sharePct: grand > 0 ? Math.round((t.count / grand) * 100) : 0,
      })),
    };
  });

  // Top citation domains, weighted by frequency.
  const domainCount = new Map<string, number>();
  for (const r of rows) {
    for (const c of r.citations ?? []) {
      if (!c.domain) continue;
      domainCount.set(c.domain, (domainCount.get(c.domain) ?? 0) + 1);
    }
  }
  const topCitationDomains = Array.from(domainCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([domain, count]) => ({ domain, count }));

  // Authority sources we benefit from (any time we're mentioned, what sources are present).
  const authMap = new Map<string, number>();
  for (const r of rows) {
    if (!r.self_mentioned) continue;
    for (const d of r.authority_sources ?? []) {
      authMap.set(d, (authMap.get(d) ?? 0) + 1);
    }
  }
  const authoritySources = Array.from(authMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => ({ domain, count }));

  // Sentiment distribution among self-mention sentences.
  const sentimentDistribution = { positive: 0, neutral: 0, negative: 0, mixed: 0, none: 0 };
  for (const r of rows) {
    if (!r.self_mentioned) continue;
    const k = (r.self_sentiment as keyof typeof sentimentDistribution) ?? "none";
    sentimentDistribution[k in sentimentDistribution ? k : "none"] += 1;
  }

  // Per-prompt detail — one row per prompt with each provider's outcome.
  const promptDetail = promptIds.map((pid) => {
    const meta = promptMap.get(pid);
    const cells = rows
      .filter((r) => r.prompt_id === pid)
      .map((r) => ({
        provider: r.provider,
        model: r.model,
        selfMentioned: r.self_mentioned,
        selfPosition: r.self_position,
        selfSentiment: r.self_sentiment,
        competitors: (r.brand_mentions ?? [])
          .filter((m) => m.type === "competitor")
          .map((m) => ({ name: m.name, position: m.position })),
        citationCount: (r.citations ?? []).length,
        latencyMs: r.latency_ms,
        error: r.error,
        responsePreview: (r.response_text ?? "").slice(0, 320),
      }));
    return {
      promptId: pid,
      prompt: meta?.prompt ?? "(unknown)",
      category: meta?.category ?? null,
      intent: meta?.intent ?? null,
      geography: meta?.geography ?? null,
      cells,
    };
  });

  return NextResponse.json({
    runId,
    runDate: latest[0].completed_at,
    providersUsed: latest[0].providers,
    providerStatus,
    activeRunId: active?.[0]?.id ?? null,
    enabledProviders: getAvailableProviders().map((p) => p.id),
    promptCoverage,
    providerCoverage,
    shareOfVoice,
    topCitationDomains,
    authoritySources,
    promptDetail,
    sentimentDistribution,
  });
}
