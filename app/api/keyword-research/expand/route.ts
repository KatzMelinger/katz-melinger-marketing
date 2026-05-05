/**
 /**
 * POST /api/keyword-research/expand
 *
 * Takes a single seed keyword and expands it into a full cluster: long-tail
 * variations, question keywords, local NYC/NJ variations, semantic/LSI keywords,
 * competitor keywords, and a content strategy (pillar page + supporting articles).
 *
 * Ports the Express handler from
 *   artifacts/api-server/src/routes/keyword-research.ts (Replit).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAnthropic,
  KEYWORD_RESEARCH_MODEL,
  extractJSON,
} from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_KEYWORD_LENGTH = 200;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { keyword } = body || {};

    if (!keyword || typeof keyword !== "string") {
      return NextResponse.json(
        { error: "keyword is required and must be a string" },
        { status: 400 },
      );
    }
    if (keyword.length > MAX_KEYWORD_LENGTH) {
      return NextResponse.json(
        { error: `keyword must be under ${MAX_KEYWORD_LENGTH} characters` },
        { status: 400 },
      );
    }

    const firmContext = await getFirmContext();

    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 8192,
      system: `You are an expert SEO keyword strategist for law firm marketing in NYC/NJ.\n\n${firmContext}`,
      messages: [
        {
          role: "user",
          content: `Expand the keyword "${keyword}" into a comprehensive keyword cluster for katzmelinger.com.

Generate:
1. Long-tail variations (more specific phrases people search)
2. Question-based keywords (what, how, when, can, etc.)
3. Local variations (with NYC, New York, NJ, New Jersey, Manhattan, Brooklyn, etc.)
4. Related/semantic keywords (LSI keywords)
5. Competitor keywords (what competing firms might rank for)

For each keyword, estimate volume and difficulty.

Respond in JSON format:
{
  "seedKeyword": "${keyword}",
  "longTail": [{"keyword": "...", "volume": <num>, "difficulty": <0-100>}],
  "questions": [{"keyword": "...", "volume": <num>, "difficulty": <0-100>}],
  "local": [{"keyword": "...", "volume": <num>, "difficulty": <0-100>}],
  "semantic": [{"keyword": "...", "volume": <num>, "difficulty": <0-100>}],
  "competitor": [{"keyword": "...", "volume": <num>, "difficulty": <0-100>}],
  "contentStrategy": {
    "pillarPage": "suggested pillar content to create",
    "supportingArticles": ["list of supporting blog posts"],
    "internalLinkingPlan": "how to interlink these pieces"
  }
}`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    try {
      const parsed = extractJSON(text);
      return NextResponse.json(parsed);
    } catch (parseErr: any) {
      console.error("[keyword-research/expand] Failed to parse AI response:", {
        error: parseErr.message,
        textLength: text.length,
      });
      return NextResponse.json(
        { error: "AI returned an invalid response. Please try again." },
        { status: 502 },
      );
    }
  } catch (err: any) {
    console.error("[keyword-research/expand] Failed:", err?.message);
    return NextResponse.json(
      { error: "Failed to expand keyword" },
      { status: 500 },
    );
  }
}
