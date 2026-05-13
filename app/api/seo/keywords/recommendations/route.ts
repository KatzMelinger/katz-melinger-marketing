/**
 * POST /api/seo/keywords/recommendations
 *   body: { keyword: string, count?: number (default 5) }
 *
 * Returns AI-generated content topic ideas scoped to a specific target
 * keyword. Different from /api/content/intelligence/topics (which is
 * practice-area-scoped). Each idea is an article angle the firm could
 * publish to win or improve rankings for the keyword — with a suggested
 * outline so the editor can decide before hitting Create.
 */

import { NextRequest, NextResponse } from "next/server";

import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type TopicIdea = {
  headline: string;
  summary: string;
  contentType: "blog_post" | "thought_leadership" | "case_study" | "faq" | "guide";
  practiceArea: string;
  whyItHelps: string;
  suggestedHeadings: string[];
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
  const rawCount = Number(body?.count ?? 5);
  const count = Math.min(Math.max(Number.isFinite(rawCount) ? rawCount : 5, 3), 8);

  if (!keyword) {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }

  const firm = await getFirmContext();

  const system = `You are an SEO content strategist for a plaintiff-side employment law firm. ${firm} You suggest article angles that are specific, factually grounded, and likely to rank for the target keyword in Google's organic results — not generic explainers. Every idea must be something the firm can credibly publish.`;

  const user = `The firm wants to rank in Google for the keyword: "${keyword}"

Suggest ${count} distinct content ideas that would help the firm rank for (or move up the rankings on) this keyword. Each idea should be a real article the firm could publish in 1-2 weeks.

For each idea, provide:
- "headline": click-worthy title under 80 chars that targets the keyword naturally
- "summary": 1-2 sentences on what the article covers and who it's for
- "contentType": one of blog_post, thought_leadership, case_study, faq, guide
- "practiceArea": which firm practice area this fits (Employment Discrimination, FMLA, Wage & Hour Claims, Wrongful Termination, Sexual Harassment at Work, Severance Negotiations, Commercial Collections, Judgment Enforcement, or General)
- "whyItHelps": 1 sentence explaining why this content matches search intent for "${keyword}" and could realistically rank
- "suggestedHeadings": array of 4-6 H2/H3 outline headings the article should cover

Vary the angles — don't return five variations of the same article. Cover a mix of:
- pillar/overview content
- specific scenario walkthroughs ("what to do if...")
- legal-rights explainers with NY-specific statutes / deadlines
- comparison or decision-tree content
- FAQ-style content optimized for People Also Ask

Return JSON only:
{
  "ideas": [
    {
      "headline": "...",
      "summary": "...",
      "contentType": "blog_post",
      "practiceArea": "...",
      "whyItHelps": "...",
      "suggestedHeadings": ["...", "..."]
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
    const parsed = extractJSON<{ ideas?: unknown[] }>(text);
    const ideas: TopicIdea[] = Array.isArray(parsed.ideas)
      ? (parsed.ideas.filter((i) => i && typeof i === "object") as TopicIdea[])
      : [];
    return NextResponse.json({ keyword, ideas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate recommendations";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
