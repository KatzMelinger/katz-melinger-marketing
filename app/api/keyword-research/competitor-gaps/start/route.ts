/**
 * POST /api/keyword-research/competitor-gaps/start
 *
 * Kicks off a competitor-gaps job in the background. See discover/start for
 * the full pattern explanation.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createJob, runAnthropicJob } from "@/lib/keyword-research-jobs";
import { getFirmContext } from "@/lib/firm-context";

export const runtime = "nodejs";
export const maxDuration = 300;

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

    const systemPrompt = `You are an expert SEO competitor analysis specialist for law firms.

${firmContext}`;

    const userPrompt = `Identify keyword gaps and competitive opportunities for katzmelinger.com.

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
}`;

    const jobId = await createJob("competitor-gaps", { competitors: competitorList });

    after(
      runAnthropicJob({
        jobId,
        systemPrompt,
        userPrompt,
      }),
    );

    return NextResponse.json({ jobId });
  } catch (err: any) {
    console.error("[competitor-gaps/start] Failed:", err?.message);
    return NextResponse.json(
      { error: err?.message || "Failed to start competitor-gaps job" },
      { status: 500 },
    );
  }
}