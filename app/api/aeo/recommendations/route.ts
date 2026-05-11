/**
 * POST /api/aeo/recommendations
 *
 * Body: { prompt: string, providerResponses: { provider, text, citations }[] }
 *
 * For prompts where the firm did NOT appear in any provider's response, asks
 * Claude to look at the prompt + what the LLMs actually said and recommend
 * what content, schema, or citation moves would be needed to start appearing.
 *
 * Stateless — the client passes everything it has. We don't persist the
 * recommendation; the user re-generates if they want to refresh it.
 */

import { NextRequest, NextResponse } from "next/server";

import { extractJSON, getAnthropic } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ProviderResponse = {
  provider: string;
  text: string;
  citations?: { url?: string; domain?: string }[];
};

type Recommendation = {
  summary: string;
  priority: "high" | "medium" | "low";
  why: string;
  contentIdeas: { title: string; format: string; rationale: string }[];
  schemaToAdd: string[];
  citationOpportunities: { domain: string; reason: string }[];
  competitorsToBeat: { name: string; whyTheyWin: string }[];
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt : "";
    const providerResponses = Array.isArray(body?.providerResponses)
      ? (body.providerResponses as ProviderResponse[])
      : [];

    if (!prompt.trim()) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }
    if (providerResponses.length === 0) {
      return NextResponse.json(
        { error: "No provider responses to analyze" },
        { status: 400 },
      );
    }

    const firmContext = await getFirmContext();

    const responsesBlock = providerResponses
      .map((r) => {
        const citations = (r.citations ?? [])
          .map((c) => c.domain || c.url || "")
          .filter(Boolean)
          .join(", ");
        return `### ${r.provider}\n${(r.text || "").slice(0, 1800)}${
          citations ? `\n\nCitations: ${citations}` : ""
        }`;
      })
      .join("\n\n---\n\n");

    const system = `You are an SEO + AEO (answer engine optimization) strategist for a NY/NJ employment law firm. The firm did NOT show up in any LLM's response for a user prompt. Your job is to figure out exactly what the firm needs to do to start appearing in answers to this kind of question.

Be specific and actionable. Generic advice ("create more content") is worthless — name exact article titles, exact schema types, exact websites to get cited on.

${firmContext}`;

    const userPrompt = `User prompt: "${prompt}"

What the LLMs actually said (the firm was not mentioned in any of these):

${responsesBlock}

Analyze this. Why didn't the firm appear? What sources did the LLMs cite — can we get on those? What competitors did they name and why? What specific content piece or schema change would make the firm appear next time?

Respond ONLY with JSON:
{
  "summary": "1-2 sentence diagnosis of why the firm is invisible here",
  "priority": "high" | "medium" | "low",
  "why": "longer explanation — what the LLMs are looking for that the firm isn't providing",
  "contentIdeas": [
    {
      "title": "exact article title to publish",
      "format": "guide" | "faq" | "blog" | "landing-page" | "case-study",
      "rationale": "why this specific piece would surface here"
    }
  ],
  "schemaToAdd": ["FAQPage", "Attorney", "LegalService", "..."],
  "citationOpportunities": [
    {
      "domain": "domain LLMs are citing",
      "reason": "specific move to get cited — e.g. submit a guest post, get listed in a directory"
    }
  ],
  "competitorsToBeat": [
    {
      "name": "competitor named in responses",
      "whyTheyWin": "what they have that we don't"
    }
  ]
}

Limit to 3-4 content ideas, 3-5 schema items, 2-4 citation opportunities, and only competitors actually named in the responses above.`;

    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2500,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    if (!text.trim()) {
      return NextResponse.json(
        { error: "Empty response from Claude" },
        { status: 502 },
      );
    }

    const parsed = extractJSON(text) as Recommendation;
    return NextResponse.json({ recommendation: parsed });
  } catch (err) {
    console.error("[aeo/recommendations] Failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to generate recommendations",
      },
      { status: 500 },
    );
  }
}
