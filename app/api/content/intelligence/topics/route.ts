/**
 * POST /api/content/intelligence/topics
 *   body: { practiceArea?: string, count?: number (default 6) }
 *
 * Returns AI-suggested article topic ideas with headlines, summaries,
 * content types, and "why now" relevance notes. Different from keyword
 * research (which finds search terms) — this finds content angles.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirmContext } from "@/lib/firm-context";
import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;

const PRACTICE_AREAS = [
  "Employment Discrimination",
  "FMLA",
  "Wage & Hour Claims",
  "Wrongful Termination",
  "Sexual Harassment at Work",
  "Severance Negotiations",
  "Commercial Collections",
  "Judgment Enforcement",
];

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const practiceArea = (body?.practiceArea as string | undefined) ?? "All";
  const rawCount = Number(body?.count ?? 6);
  const count = Math.min(Math.max(Number.isFinite(rawCount) ? rawCount : 6, 3), 15);

  const firm = await getFirmContext();
  const focus =
    practiceArea && practiceArea !== "All"
      ? `Focus specifically on the practice area: ${practiceArea}.`
      : `Cover a mix across these practice areas: ${PRACTICE_AREAS.join(", ")}.`;

  const system = `You are a content strategist for a plaintiff-side employment law firm. ${firm} Suggest article topic angles that are specific, timely, and likely to attract qualified clients — not generic legal explainers.`;

  const user = `Suggest ${count} article topic ideas for the firm's blog and content marketing. ${focus}

Each idea should have:
- A compelling, click-worthy headline (under 80 chars)
- A 1-2 sentence summary of what the article would cover
- The primary practice area it relates to
- A content type: blog_post | thought_leadership | case_study | faq | guide
- A "why now" sentence explaining why this topic is timely or strategically valuable

Return JSON only:
{
  "topics": [
    {
      "headline": "...",
      "summary": "...",
      "practiceArea": "...",
      "contentType": "blog_post|thought_leadership|case_study|faq|guide",
      "relevance": "why this is timely or valuable now"
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
    const parsed = extractJSON<{ topics?: unknown[] }>(text);
    const topics = Array.isArray(parsed.topics) ? parsed.topics : [];
    return NextResponse.json({ topics });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate topics";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
