/**
 * POST /api/content/intelligence/topic-fit
 *   body: { topic: string, context?: string }
 *
 * Judges whether a topic (e.g. a marketing alert) is worth turning into
 * content, channel by channel — SEO, AEO (AI answer engines), and Social —
 * and proposes specific content pieces. Powers the "Analyze" button on the
 * marketing alerts inbox.
 *
 * Returns a per-channel recommendation (recommended + 0-100 score +
 * rationale + suitable formats) plus a short list of suggested content with
 * titles, so the user can go straight from "is this worth it?" to "make it".
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirmContext } from "@/lib/firm-context";
import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  const context = typeof body?.context === "string" ? body.context.trim() : "";

  if (!topic) {
    return NextResponse.json({ error: "topic required" }, { status: 400 });
  }

  const firm = await getFirmContext();

  const system = `You are a marketing strategist for a plaintiff-side employment law firm in New York City. ${firm}

Judge whether a given topic is worth producing content for, separately for three channels:
- SEO: organic Google ranking via blog posts, guides, FAQ, and practice/landing pages. Good when there is real, recurring search demand and the firm can rank.
- AEO: being cited by AI answer engines (ChatGPT, Claude, Perplexity, Google AI Overviews). Good for clear, factual, question-shaped legal topics that people ask assistants about.
- Social: LinkedIn, Instagram, Facebook, X. Good when the topic is timely, emotionally resonant, or newsworthy enough to earn engagement.

Be honest — if a channel is a poor fit, say so and score it low. Never fabricate; recommend speaking with an attorney rather than asserting legal outcomes.`;

  const user = `Topic: ${topic}
${context ? `Context: ${context}\n` : ""}
Assess this topic for the firm's content marketing.

For EACH channel (SEO, AEO, Social), provide:
- recommended: true/false (is it worth producing content for this channel?)
- score: 0-100 suitability score
- rationale: 1-2 sentences explaining the score
- formats: array of recommended content formats for that channel (e.g. "Blog post", "FAQ", "Landing page", "Guide", "LinkedIn post", "Short video"). Empty array if not recommended.

Then provide up to 4 specific suggested content pieces (only for channels worth pursuing). If the topic is a poor fit across the board, return an empty suggestedContent array.

Return JSON only:
{
  "verdict": "one-sentence overall recommendation",
  "channels": [
    { "channel": "SEO", "recommended": true, "score": 0, "rationale": "...", "formats": ["..."] },
    { "channel": "AEO", "recommended": true, "score": 0, "rationale": "...", "formats": ["..."] },
    { "channel": "Social", "recommended": true, "score": 0, "rationale": "...", "formats": ["..."] }
  ],
  "suggestedContent": [
    { "title": "specific content title", "format": "Blog post|FAQ|Landing page|Guide|LinkedIn post|...", "channel": "SEO|AEO|Social", "why": "one sentence" }
  ]
}`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<{
      verdict?: string;
      channels?: unknown[];
      suggestedContent?: unknown[];
    }>(text);
    return NextResponse.json({
      topic,
      verdict: typeof parsed.verdict === "string" ? parsed.verdict : "",
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      suggestedContent: Array.isArray(parsed.suggestedContent) ? parsed.suggestedContent : [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to analyze topic";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
