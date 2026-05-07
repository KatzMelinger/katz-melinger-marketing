/**
 * POST /api/keyword-research/discover
 *
 * AI-powered keyword discovery. Takes an optional seed keyword, practice area,
 * and intent filter; returns 20+ keyword suggestions with volume/difficulty
 * estimates, quick wins, high-value targets, content gaps, and a summary.
 *
 * Ports the Express handler from
 *   artifacts/api-server/src/routes/keyword-research.ts (Replit)
 * to a Next.js App Router route handler. Differences from original:
 *   - Anthropic SDK initialized via shared lib/anthropic.ts
 *   - Firm context loaded from Supabase (lib/firm-context.ts) instead of Drizzle
 *   - Logging via console.error instead of pino (matches MarketOS convention)
 *   - Model snapshot is the real Sonnet 4.5 ID, not the placeholder "4-6"
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAnthropic,
  KEYWORD_RESEARCH_MODEL,
  extractJSON,
} from "@/lib/anthropic";
import {
  getFirmContext,
  PRACTICE_AREAS,
  VALID_INTENTS,
} from "@/lib/firm-context";

export const runtime = "nodejs";
export const maxDuration = 60; // capped to 10s on Vercel Hobby

const MAX_SEED_LENGTH = 200;
const MAX_COUNT = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { seedKeyword, practiceArea, intent, count: rawCount } = body || {};

    // ----- input validation ------------------------------------------------
    if (
      seedKeyword !== undefined &&
      seedKeyword !== "" &&
      (typeof seedKeyword !== "string" || seedKeyword.length > MAX_SEED_LENGTH)
    ) {
      return NextResponse.json(
        { error: `seedKeyword must be a string under ${MAX_SEED_LENGTH} characters` },
        { status: 400 },
      );
    }
    if (practiceArea && !PRACTICE_AREAS.includes(practiceArea)) {
      return NextResponse.json(
        { error: `Invalid practiceArea. Valid: ${PRACTICE_AREAS.join(", ")}` },
        { status: 400 },
      );
    }
    if (intent && !VALID_INTENTS.includes(intent)) {
      return NextResponse.json(
        { error: `Invalid intent. Valid: ${VALID_INTENTS.join(", ")}` },
        { status: 400 },
      );
    }

    const count = Math.min(Math.max(parseInt(rawCount, 10) || 20, 1), MAX_COUNT);

    // ----- prompt setup ----------------------------------------------------
    const firmContext = await getFirmContext();

    const focusArea =
      practiceArea && practiceArea !== "All"
        ? `Focus specifically on: ${practiceArea}.`
        : `Cover a mix of practice areas.`;

    const intentDescriptions: Record<string, string> = {
      informational: "people searching for information/answers",
      commercial: "people comparing options or researching solutions",
      transactional: "people ready to hire a lawyer or take action",
      navigational: "people looking for a specific firm or website",
    };

    const intentFilter =
      intent && intent !== "all"
        ? `Focus on ${intent} intent keywords (${intentDescriptions[intent]}).`
        : "";

    const seedContext = seedKeyword
      ? `Use "${seedKeyword}" as a seed keyword to discover related, long-tail, and semantic variations.`
      : "Suggest keywords the firm should target based on their practice areas and target market.";

    // ----- AI call ---------------------------------------------------------
    const anthropic = getAnthropic();

    // Use streaming so the connection stays warm — without this, requests over
    // ~30 seconds get killed by Vercel's function timeout. We collect chunks
    // into a string and parse JSON only after the stream completes.
    const stream = await anthropic.messages.stream({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 6000,
      system: `You are an expert SEO keyword strategist specializing in law firm marketing. You deeply understand search intent, keyword difficulty estimation, and content gap analysis for legal services in the New York and New Jersey market.\n\n${firmContext}`,
      messages: [
        {
          role: "user",
          content: `Discover ${count} high-value keyword opportunities for katzmelinger.com.

${seedContext}
${focusArea}
${intentFilter}

For each keyword, provide:
- The exact keyword phrase people would search
- Estimated monthly search volume (be realistic for legal keywords in NY/NJ market)
- Estimated keyword difficulty (0-100 scale)
- Search intent classification: informational, commercial, transactional, or navigational
- A relevance score (0-100) indicating how well this keyword fits the firm
- A brief content suggestion for how to target this keyword
- The practice area it relates to

Also provide:
- 5 "quick win" keywords (lower difficulty, decent volume, high relevance)
- 3 "high value targets" (competitive but worth pursuing long-term)
- Content gap analysis: topics the firm should cover but likely doesn't

Respond in JSON format:
{
  "keywords": [
    {
      "keyword": "exact keyword phrase",
      "volume": <estimated monthly volume>,
      "difficulty": <0-100>,
      "intent": "informational|commercial|transactional|navigational",
      "relevance": <0-100>,
      "contentSuggestion": "brief content approach",
      "practiceArea": "related practice area",
      "opportunity": "why this keyword is valuable"
    }
  ],
  "quickWins": [
    {
      "keyword": "...",
      "volume": <number>,
      "difficulty": <0-100>,
      "reason": "why this is a quick win"
    }
  ],
  "highValueTargets": [
    {
      "keyword": "...",
      "volume": <number>,
      "difficulty": <0-100>,
      "strategy": "long-term approach to rank"
    }
  ],
  "contentGaps": [
    {
      "topic": "...",
      "suggestedKeywords": ["..."],
      "contentFormat": "blog|guide|faq|landing-page|video",
      "priority": "high|medium|low"
    }
  ],
  "summary": "Brief overview of the keyword landscape and top recommendations"
}`,
        },
      ],
    });

    // Drain the stream into a single string. The streaming helper exposes a
    // .finalMessage() that resolves once the stream is done.
    const finalMessage = await stream.finalMessage();
    const text =
      finalMessage.content[0]?.type === "text"
        ? finalMessage.content[0].text
        : "";

    try {
      const parsed = extractJSON(text);
      return NextResponse.json(parsed);
    } catch (parseErr: any) {
      console.error("[keyword-research/discover] Failed to parse AI response:", {
        error: parseErr.message,
        textLength: text.length,
        textStart: text.slice(0, 300),
      });
      return NextResponse.json(
        { error: "AI returned an invalid response. Please try again." },
        { status: 502 },
      );
    }
  } catch (err: any) {
    console.error("[keyword-research/discover] Failed:", err?.message);
    return NextResponse.json(
      { error: "Failed to generate keyword suggestions" },
      { status: 500 },
    );
  }
} 