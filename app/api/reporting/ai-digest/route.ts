/**
 * POST /api/reporting/ai-digest
 *
 * One AI endpoint serving two of the Reporting surfaces. The client gathers the
 * raw metrics (it already holds the authenticated session), POSTs them here, and
 * Claude reasons over them and returns structured JSON we render with the normal
 * report components. Mirrors the gather-then-prompt pattern in
 * /api/recommendations/generate.
 *
 * Body: { kind: "trends" | "custom", cadence, payload, instruction? }
 *   - kind "trends":  payload = { keywordMovers, gsc, aeo, ... } →
 *       { headline, narrative, highlights: [{ label, direction, metric, detail }] }
 *   - kind "custom":  payload = full metrics bundle, instruction = the user's
 *       request → { title, summary, sections: [{ heading, bullets[] }] }
 */

import { NextRequest, NextResponse } from "next/server";

import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  kind?: "trends" | "custom";
  /** A human phrase for the window, e.g. "week", "month", "30-day window". */
  period?: string;
  payload?: unknown;
  instruction?: string;
};

type TrendsResult = {
  headline: string;
  narrative: string;
  highlights: { label: string; direction: "good" | "bad" | "neutral"; metric?: string; detail: string }[];
};

type CustomResult = {
  title: string;
  summary: string;
  sections: { heading: string; bullets: string[] }[];
};

function clip(value: unknown, max = 12000): string {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 0);
  return s.length > max ? `${s.slice(0, max)}…(truncated)` : s;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const kind = body.kind === "custom" ? "custom" : "trends";
  const period = typeof body.period === "string" && body.period.trim() ? body.period.trim() : "period";

  let firm = "";
  try {
    firm = await getFirmContext();
  } catch {
    firm = "";
  }

  const dataBlock = clip(body.payload);

  let system: string;
  let user: string;

  if (kind === "trends") {
    system = [
      "You are the CMO of a personal-injury / civil-litigation law firm reviewing this " +
        period +
        "'s marketing telemetry.",
      firm ? `Firm context:\n${firm}` : "",
      "From the data, surface only the changes that actually matter to a managing partner — the biggest wins and the biggest risks. Ignore noise and tiny movements.",
      "Rank by business impact: ranking/visibility for high-intent commercial keywords, AI-answer presence (AEO), and organic click/impression swings matter most.",
      "Return STRICT JSON only, no prose outside it, in this exact shape:",
      `{"headline": "one-line state of the ${period}", "narrative": "2-4 sentence plain-English summary a partner can read in 15 seconds", "highlights": [{"label": "short title", "direction": "good"|"bad"|"neutral", "metric": "the number/movement, e.g. '#8 → #3' or '+412 clicks'", "detail": "one sentence on why it matters / what to do"}]}`,
      "Provide 4-8 highlights, ordered most-important first, mixing good and bad. Be specific with numbers from the data.",
    ]
      .filter(Boolean)
      .join("\n\n");
    user = `Here is this ${period}'s trend data (current vs prior period where available):\n\n${dataBlock}`;
  } else {
    system = [
      "You are a marketing analyst preparing a custom report for the CMO of a law firm.",
      firm ? `Firm context:\n${firm}` : "",
      "Build the report the user asked for using ONLY the data provided. If the data can't support part of the request, say so briefly rather than inventing numbers.",
      "Be concrete and quantitative — cite the actual figures. Write for an executive: tight, decision-oriented bullets.",
      "Return STRICT JSON only, no prose outside it, in this exact shape:",
      `{"title": "report title reflecting the request", "summary": "2-3 sentence executive summary", "sections": [{"heading": "section title", "bullets": ["concrete bullet with numbers", "..."]}]}`,
      "Use 2-5 sections. Keep bullets scannable.",
    ]
      .filter(Boolean)
      .join("\n\n");
    user = [
      `The user's request: ${body.instruction?.trim() || "Summarize the most important marketing results for this " + period + "."}`,
      "",
      `Available data (current ${period} vs prior period where present):`,
      dataBlock,
    ].join("\n");
  }

  try {
    const res = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content[0]?.type === "text" ? res.content[0].text : "";
    if (kind === "trends") {
      const parsed = extractJSON<TrendsResult>(text);
      return NextResponse.json({ result: parsed });
    }
    const parsed = extractJSON<CustomResult>(text);
    return NextResponse.json({ result: parsed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI digest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
