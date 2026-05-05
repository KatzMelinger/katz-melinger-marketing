/**
 * POST /api/keyword-research/competitor-gaps
 *
 * Identifies keyword gaps and competitive opportunities. Optionally takes a
 * list of competitor domains; otherwise analyzes against typical NY/NJ
 * employment-law competitors.
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

const MAX_COMPETITORS = 10;
const MAX_COMPETITOR_LENGTH = 100;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { competitors } = body || {};

    let competitorList: string[] = [];
    if (competitors !== undefined && competitors !== null) {
      if (!Array.isArray(competitors)) {
        return NextResponse.json(
          { error: "competitors must be an array of strings" },
          { status: 400 },
        );
      }
      competitorList = competitors
        .filter((c: any) => typeof c === "string" && c.trim().length > 0)
        .map((c: string) => c.trim().slice(0, MAX_COMPETITOR_LENGTH))
        .slice(0, MAX_COMPETITORS);
    }

    const firmContext = await getFirmContext();

    const competitorContext =
      competitorList.length > 0
        ? `Analyze gaps against these specific competitors: ${competitorList.join(", ")}.`
        : `Analyze gaps against typical competing employment law firms in NYC/NJ.`;

    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 8192,
      system: `You are an expert SEO competitor analysis specialist for law firms.\n\n${firmContext}`,
      messages: [
        {
          role: "user",
          content: `Identify keyword gaps and competitive opportunities for katzmelinger.com.

${competitorContext}

Find:
1. Keywords competitors likely rank for that katzmelinger.com probably doesn't
2. Underserved topics in employment law that no one covers well
3. Emerging search trends in employment law
4. Local SEO opportunities specific to NY/NJ

Respond in JSON format:
{
  "competitorKeywords": [
    {"keyword": "...", "volume": <num>, "difficulty": <0-100>, "competitorAdvantage": "why competitors rank", "ourOpportunity": "how to compete"}
  ],
  "underservedTopics": [
    {"topic": "...", "keywords": ["..."], "estimatedTotalVolume": <num>, "contentApproach": "..."}
  ],
  "emergingTrends": [
    {"trend": "...", "relatedKeywords": ["..."], "growthPotential": "high|medium", "timing": "act now|next quarter|long-term"}
  ],
  "localOpportunities": [
    {"keyword": "...", "volume": <num>, "difficulty": <0-100>, "location": "specific area", "tactic": "how to win locally"}
  ],
  "actionPlan": "Prioritized 30-day action plan for keyword strategy"
}`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    try {
      const parsed = extractJSON(text);
      return NextResponse.json(parsed);
    } catch (parseErr: any) {
      console.error("[keyword-research/competitor-gaps] Failed to parse AI response:", {
        error: parseErr.message,
        textLength: text.length,
      });
      return NextResponse.json(
        { error: "AI returned an invalid response. Please try again." },
        { status: 502 },
      );
    }
  } catch (err: any) {
    console.error("[keyword-research/competitor-gaps] Failed:", err?.message);
    return NextResponse.json(
      { error: "Failed to analyze competitor gaps" },
      { status: 500 },
    );
  }
}
