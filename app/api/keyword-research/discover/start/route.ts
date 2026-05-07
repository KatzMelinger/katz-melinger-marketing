/**
 * POST /api/keyword-research/discover/start
 *
 * Kicks off a discover job in the background via Vercel's waitUntil(). Returns
 * a jobId immediately — the caller polls /api/keyword-research/discover/status
 * to see when it's done.
 *
 * This pattern sidesteps Vercel's 60-second function timeout. The background
 * work runs after the HTTP response is sent and can take several minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createJob, runAnthropicJob } from "@/lib/keyword-research-jobs";
import { getFirmContext } from "@/lib/firm-context";

export const runtime = "nodejs";
export const maxDuration = 300; // give after() background work full Pro Fluid Compute budget

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      seedKeyword,
      practiceArea,
      intent,
      count = 20,
    } = body || {};

    // Validate count
    const safeCount = Math.min(Math.max(parseInt(String(count), 10) || 20, 5), 30);

    // Build the prompt context up front (fast Supabase reads)
    const firmContext = await getFirmContext();

    const seedContext = seedKeyword
      ? `Use "${seedKeyword}" as the seed keyword to expand from.`
      : `Generate keywords from scratch based on the firm's practice areas.`;

    const focusArea =
      practiceArea && practiceArea !== "All"
        ? `Focus specifically on the practice area: ${practiceArea}.`
        : `Cover all of the firm's practice areas.`;

    const intentFilter =
      intent && intent !== "all"
        ? `Filter to ${intent} search intent only.`
        : `Include a mix of search intents (informational, commercial, transactional).`;

    const systemPrompt = `You are an expert SEO keyword strategist specializing in law firm marketing. You deeply understand search intent, keyword difficulty estimation, and content gap analysis for legal services in the New York and New Jersey market.

${firmContext}`;

    const userPrompt = `Discover ${safeCount} high-value keyword opportunities for katzmelinger.com.

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
}`;

    // Create the job row
    const jobId = await createJob("discover", {
      seedKeyword,
      practiceArea,
      intent,
      count: safeCount,
    });

    // Kick off the actual work in the background. The HTTP response goes out
    // immediately; the Anthropic call continues running for ~110s and writes
    // the result to the job row when done.
    after(
      runAnthropicJob({
        jobId,
        systemPrompt,
        userPrompt,
      }),
    );

    return NextResponse.json({ jobId });
  } catch (err: any) {
    console.error("[discover/start] Failed:", err?.message);
    return NextResponse.json(
      { error: err?.message || "Failed to start discover job" },
      { status: 500 },
    );
  }
}