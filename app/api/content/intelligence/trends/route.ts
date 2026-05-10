/**
 * POST /api/content/intelligence/trends
 *   body: { practiceArea?: string }
 *
 * Returns AI's read on what's currently trending or newsworthy in NY/NJ
 * employment law that the firm could write about. Each trend gets an urgency
 * tag (hot / warm / evergreen) so the editorial team knows what to publish
 * this week vs. when the calendar is open.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirmContext } from "@/lib/firm-context";
import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";

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
  const body = await req.json().catch(() => ({}));
  const practiceArea = (body?.practiceArea as string | undefined) ?? "All";

  const firm = await getFirmContext();
  const focus =
    practiceArea && practiceArea !== "All"
      ? `Focus on ${practiceArea} specifically.`
      : `Cover trends across these practice areas: ${PRACTICE_AREAS.join(", ")}.`;

  const system = `You are a trend analyst for a NY/NJ plaintiff-side employment law firm. ${firm} Surface concrete current events, recent court rulings, new legislation, and viral workplace stories — not vague evergreen advice.`;

  const user = `Identify current trending topics, recent legal developments, and newsworthy events in NY/NJ employment law that the firm could create content about. ${focus}

For each, provide:
- topic: the event or theme
- whyTrending: what's making it hot right now (cite a specific ruling, law, news event, or cultural moment if you can)
- suggestedAngle: the firm's angle — what's their take or what would they teach?
- urgency: "hot" (publish this week), "warm" (this month), or "evergreen" (anytime)
- platforms: array of formats best suited (e.g. ["blog", "linkedin", "twitter", "podcast"])

Return JSON only:
{
  "trends": [
    {
      "topic": "...",
      "whyTrending": "...",
      "suggestedAngle": "...",
      "urgency": "hot|warm|evergreen",
      "platforms": ["..."]
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
    const parsed = extractJSON<{ trends?: unknown[] }>(text);
    const trends = Array.isArray(parsed.trends) ? parsed.trends : [];
    return NextResponse.json({ trends });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to track trends";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
