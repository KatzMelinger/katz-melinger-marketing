/**
 * POST /api/seo/pr-pitches
 *   body: { query: string, journalistName?: string, outlet?: string, deadline?: string }
 *
 * Takes a journalist's source query (from HARO-style services like Qwoted,
 * Featured.com, SourceBottle, JustReachOut, or a plain email) and returns:
 *   - fit:      yes | maybe | no  — is this a credible opportunity for the firm?
 *   - reason:   1 sentence explanation
 *   - angle:    the specific expertise angle the firm should lead with
 *   - pitch:    a complete pitch response ready to send
 *   - quote:    a 2-3 sentence pull-quote the journalist could use as-is
 *   - attribution: how attorney name + firm should appear in the article
 *
 * Doesn't store anything. The client may then save the pitch to
 * content_drafts via /api/content/draft using content_type=email.
 */

import { NextRequest, NextResponse } from "next/server";

import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { getTenantConfig } from "@/lib/tenant-config";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type PitchResponse = {
  fit: "yes" | "maybe" | "no";
  reason: string;
  angle: string;
  pitch: string;
  quote: string;
  attribution: string;
};

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const journalistName = typeof body?.journalistName === "string" ? body.journalistName.trim() : "";
  const outlet = typeof body?.outlet === "string" ? body.outlet.trim() : "";
  const deadline = typeof body?.deadline === "string" ? body.deadline.trim() : "";

  if (!query) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  if (query.length < 40) {
    return NextResponse.json(
      { error: "Query is too short — paste the full journalist query for a meaningful pitch." },
      { status: 400 },
    );
  }

  const [firm, cfg] = await Promise.all([getFirmContext(), getTenantConfig()]);
  const firmName = cfg.firmName || "the firm";
  const spokesperson =
    cfg.firmSpokesperson || (cfg.firmName ? `an attorney at ${cfg.firmName}` : "a firm attorney");

  const system = `You are a PR strategist for ${firmName}. ${firm} You help the firm decide which journalist queries to respond to and draft pitches that actually get used. You're brutally honest about fit — saying no to off-target queries is more valuable than forcing fits.`;

  const user = `A journalist has posted this source query:

${outlet ? `Outlet: ${outlet}\n` : ""}${journalistName ? `Reporter: ${journalistName}\n` : ""}${deadline ? `Deadline: ${deadline}\n` : ""}
Query:
"""
${query}
"""

Evaluate this query for ${firmName} and produce a pitch.

The firm's practice areas and expertise are described in the firm context above.
If the query falls outside those practice areas (a different area of law, or a
non-legal topic), say "no" with a one-line reason.

If it IS in scope, produce a pitch response from "${spokesperson}" that:
  - Opens with one sentence stating the relevant credential
  - Provides a substantive answer / quote that the reporter could use
  - Stays under ~200 words
  - Closes with availability for a follow-up call
  - Includes the firm name and one supporting credential (years in
    practice, notable case category) without sounding like marketing copy

Return JSON only:
{
  "fit": "yes" | "maybe" | "no",
  "reason": "one sentence on why this is/isn't a fit",
  "angle": "specific expertise angle to lead with (1 sentence)",
  "pitch": "complete pitch response, ~150-200 words, ready to paste into an email reply",
  "quote": "2-3 sentence pull-quote the journalist could use as-is, attributed to ${spokesperson}",
  "attribution": "exactly how the attorney + firm should be cited (e.g. '${spokesperson}')"
}`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<PitchResponse>(text);
    return NextResponse.json({ pitch: parsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate pitch";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
