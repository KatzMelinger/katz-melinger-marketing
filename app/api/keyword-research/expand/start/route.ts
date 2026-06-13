/**
 * POST /api/keyword-research/expand/start
 *
 * Kicks off an expand job in the background. See discover/start for the full
 * pattern explanation.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createJob, runAnthropicJob } from "@/lib/keyword-research-jobs";
import { getFirmContext } from "@/lib/firm-context";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_KEYWORD_LENGTH = 200;

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => ({}));
    const { keyword } = body || {};

    if (typeof keyword !== "string" || keyword.trim().length === 0) {
      return NextResponse.json(
        { error: "keyword is required" },
        { status: 400 },
      );
    }

    const safeKeyword = keyword.trim().slice(0, MAX_KEYWORD_LENGTH);
    const firmContext = await getFirmContext();

    const systemPrompt = `You are an expert SEO keyword strategist for law firm marketing in NYC/NJ.

${firmContext}`;

    const userPrompt = `Expand the keyword "${safeKeyword}" into a comprehensive keyword cluster for katzmelinger.com.

Generate:
1. Long-tail variations (more specific phrases people search)
2. Question-based keywords (what, how, when, can, etc.)
3. Local variations (with NYC, New York, NJ, New Jersey, Manhattan, Brooklyn, etc.)
4. Related/semantic keywords (LSI keywords)
5. Competitor keywords (what competing firms might rank for)

For each keyword, estimate volume and difficulty.

Respond in JSON format:
{
  "seedKeyword": "${safeKeyword}",
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
}`;

    const jobId = await createJob("expand", { keyword: safeKeyword });

    after(
      runAnthropicJob({
        jobId,
        systemPrompt,
        userPrompt,
      }),
    );

    return NextResponse.json({ jobId });
  } catch (err: any) {
    console.error("[expand/start] Failed:", err?.message);
    return NextResponse.json(
      { error: err?.message || "Failed to start expand job" },
      { status: 500 },
    );
  }
}