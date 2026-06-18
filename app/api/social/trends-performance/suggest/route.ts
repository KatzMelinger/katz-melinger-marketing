/**
 * POST /api/social/trends-performance/suggest  — "Suggest with Claude"
 *
 * Drafts the editorial half of Screen 3 (Trends & Performance) that Metricool
 * can't provide: a set of trending topics tagged Hot/Warm/Growing, plus a
 * one-paragraph content suggestion for next month. Grounded in the firm context
 * and the firm's recent best-performing formats. Returns suggestions only — the
 * user edits and Saves; this does not write to social_insights.
 */

import { NextResponse } from "next/server";

import { extractJSON, getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { getSocialOverview } from "@/lib/metricool";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 120;

type Incoming = { topics?: Array<{ topic?: unknown; status?: unknown }>; suggestion?: unknown };

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;

  const today = new Date().toISOString().slice(0, 10);
  const firm = await getFirmContext().catch(() => "");

  // Light grounding: the firm's recent formats/post topics, if Metricool is up.
  let perf = "";
  try {
    const data = (await getSocialOverview()) as Array<{
      network: string;
      posts: Array<{ content?: string; engagement?: number; type?: string }>;
    }>;
    const top = data
      .flatMap((n) => n.posts.map((p) => ({ ...p, network: n.network })))
      .sort((a, b) => (Number(b.engagement) || 0) - (Number(a.engagement) || 0))
      .slice(0, 8)
      .map((p) => `- [${p.network}/${p.type ?? "post"}] ${(p.content ?? "").slice(0, 120)}`)
      .join("\n");
    if (top) perf = `\n\nThe firm's recent best-performing posts (for grounding):\n${top}`;
  } catch {
    /* Metricool optional — proceed with firm context only */
  }

  const system = `You are a social media content strategist for a NY/NJ plaintiff-side employment law firm. ${firm}
Today is ${today}. Suggest realistic, on-brand editorial direction. Keep topics specific to the firm's practice (employment discrimination, wage & hour, severance, wrongful termination, harassment, FMLA, commercial collections), and to NY/NJ where relevant.`;

  const user = `Propose:
1) 5–7 trending/timely TOPICS the firm should post about, each tagged:
   - "hot" (act this week), "warm" (this month), or "growing" (rising interest, get ahead of it)
2) one short SUGGESTION paragraph (2–4 sentences) recommending what to focus on next month and why.${perf}

Return JSON only:
{
  "topics": [ { "topic": "…", "status": "hot|warm|growing" } ],
  "suggestion": "…"
}`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = extractJSON<Incoming>(text);

    const topics = (Array.isArray(parsed.topics) ? parsed.topics : [])
      .map((t) => {
        const status = asString(t.status).toLowerCase();
        return {
          topic: asString(t.topic),
          status: ["hot", "warm", "growing"].includes(status) ? status : "warm",
        };
      })
      .filter((t) => t.topic)
      .slice(0, 8);
    const suggestion = asString(parsed.suggestion);

    return NextResponse.json({ topics, suggestion });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to generate suggestions";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
