/**
 * POST /api/seo/pr-pitches/screen
 *   body: { queries: Array<{ summary, query, category?, outlet?, deadline? }> }
 *
 * Bulk fit-screening for a HARO digest. The user pastes 30-50 journalist
 * queries; this endpoint runs them through Claude in ONE call to return
 * yes/maybe/no fit assessments. Costs ~10x less than calling the full
 * /api/seo/pr-pitches endpoint for each query.
 *
 * For "yes" / "maybe" results, the client can then call the full pitch
 * endpoint per query to get the drafted response.
 */

import { NextRequest, NextResponse } from "next/server";

import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type ScreenResult = {
  index: number;
  fit: "yes" | "maybe" | "no";
  reason: string;
  angle: string;
};

const MAX_QUERIES = 60;

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const queries = Array.isArray(body?.queries) ? body.queries : [];
  if (queries.length === 0) {
    return NextResponse.json({ error: "queries array required" }, { status: 400 });
  }
  if (queries.length > MAX_QUERIES) {
    return NextResponse.json(
      { error: `Too many queries (max ${MAX_QUERIES} per call)` },
      { status: 400 },
    );
  }

  const firm = await getFirmContext();

  // Number queries in the prompt so Claude can return matching indices.
  const numbered = queries
    .map((q: Record<string, unknown>, i: number) => {
      const summary = typeof q?.summary === "string" ? q.summary : "";
      const query = typeof q?.query === "string" ? q.query : summary;
      const category = typeof q?.category === "string" ? q.category : "";
      const outlet = typeof q?.outlet === "string" ? q.outlet : "";
      const deadline = typeof q?.deadline === "string" ? q.deadline : "";
      return [
        `### Query ${i}`,
        outlet && `Outlet: ${outlet}`,
        category && `Category: ${category}`,
        deadline && `Deadline: ${deadline}`,
        summary && `Summary: ${summary}`,
        `Query: ${query}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const system = `You are a PR strategist for Katz Melinger PLLC, a plaintiff-side employment law firm in NYC. ${firm} You're screening a batch of journalist source queries to identify which ones are worth a pitch. Be brutally honest — say no to off-topic queries.`;

  const user = `Below are ${queries.length} journalist queries from today's HARO digest. For each one, decide if it's a credible opportunity for the firm.

The firm's expertise is plaintiff-side employment law in NYC:
  - Workplace discrimination (race, gender, age, disability, religion)
  - Wage & hour (overtime, off-the-clock work, wage theft, class actions)
  - Wrongful termination
  - Sexual harassment / hostile work environment
  - FMLA / medical leave retaliation
  - Severance negotiations
  - Whistleblower retaliation
  - NY State and NYC-specific worker protections
  - Commercial collections / judgment enforcement (secondary)

Return a JSON object with one entry per query. Be conservative — most queries on HARO are NOT a fit.

For each:
  - fit: "yes" if directly in the firm's plaintiff-side employment law expertise; "maybe" if adjacent / requires some creative angle; "no" if off-topic (criminal law, divorce, business contracts, personal injury, opinion pieces unrelated to workers' rights, etc.)
  - reason: one sentence on why it is/isn't a fit
  - angle: if yes/maybe, the specific expertise angle to lead with. Empty string if no.

${numbered}

Return JSON only:
{
  "results": [
    { "index": 0, "fit": "no", "reason": "...", "angle": "" },
    { "index": 1, "fit": "yes", "reason": "...", "angle": "..." },
    ...
  ]
}`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<{ results?: ScreenResult[] }>(text);
    const results: ScreenResult[] = Array.isArray(parsed.results) ? parsed.results : [];
    return NextResponse.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to screen queries";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
