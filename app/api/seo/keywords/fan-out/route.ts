/**
 * POST /api/seo/keywords/fan-out
 *   body: { keyword: string, count?: number (default 12) }
 *
 * "Content fan-out": given a target keyword, produce long-tail prompt
 * variations in the style of how people actually query LLMs. Where
 * traditional SEO targets short keywords, AI search targets the way
 * users write to ChatGPT/Claude/Perplexity — full questions, comparison
 * requests, scenario-specific asks.
 *
 * Example for "wrongful termination lawyer ny":
 *   - "What's the strongest evidence for a wrongful termination case in NY?"
 *   - "Best wrongful termination attorneys in NYC for at-will employees fired after FMLA"
 *   - "Compare wrongful termination lawyers NYC vs class action firms"
 *   - "How much does a wrongful termination lawyer cost in New York and what's the success rate?"
 *
 * Each variation is tagged with the funnel stage (TOFU / MOFU / BOFU)
 * so the user can prioritize which to create content for.
 */

import { NextRequest, NextResponse } from "next/server";

import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type FanOutPrompt = {
  prompt: string;
  intent: "informational" | "commercial" | "transactional" | "comparison";
  funnel: "tofu" | "mofu" | "bofu";
  rationale: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
  const rawCount = Number(body?.count ?? 12);
  const count = Math.min(Math.max(Number.isFinite(rawCount) ? rawCount : 12, 5), 20);

  if (!keyword) {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }

  const firm = await getFirmContext();

  const system = `You are an AI search strategist for a plaintiff-side employment law firm. ${firm} Your job is to translate short SEO keywords into the long-tail prompts buyers actually type into ChatGPT, Claude, Perplexity, and Gemini when researching a legal matter. These prompts are how AI search engines decide what content to surface and cite.`;

  const user = `Target keyword: "${keyword}"

Generate ${count} long-tail prompt variations that real buyers would type into an AI search engine when researching this topic. Cover the full funnel:

- TOFU (informational): "What is...", "How does...", "When can I...", "Is it legal to..."
- MOFU (commercial): "Best ... for ...", "How to choose a ...", "What should I look for in...", "Compare ... vs ..."
- BOFU (transactional / decision): "How much does ... cost in NY", "What's the success rate of...", "Should I hire a lawyer for...", "What evidence do I need for..."
- Comparison: "Class action vs individual lawsuit for...", "Mediation vs litigation for..."

Constraints:
- Each prompt must be a full natural-language sentence (not a keyword phrase)
- Each must be specific enough that a generic answer wouldn't satisfy it
- Mix scenario specifics: industry (restaurant, healthcare, finance), employee status (at-will, FMLA, salaried, hourly), damages tier (under $50K, over $100K, etc.)
- At least 4 should be NY/NYC-specific (state law, statute, deadline, court)
- Avoid generic "best lawyer near me" formulations

Return JSON only:
{
  "prompts": [
    {
      "prompt": "the long-tail LLM prompt",
      "intent": "informational" | "commercial" | "transactional" | "comparison",
      "funnel": "tofu" | "mofu" | "bofu",
      "rationale": "one sentence on what content angle would win this prompt"
    }
  ]
}`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<{ prompts?: unknown[] }>(text);
    const prompts: FanOutPrompt[] = Array.isArray(parsed.prompts)
      ? (parsed.prompts.filter((p) => p && typeof p === "object") as FanOutPrompt[])
      : [];
    return NextResponse.json({ keyword, prompts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate fan-out prompts";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
