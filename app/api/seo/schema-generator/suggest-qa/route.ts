/**
 * POST /api/seo/schema-generator/suggest-qa
 *   body: { url: string }
 *
 * Fetches the target page, extracts its visible text, and asks Claude (via
 * tool-use) for 5-8 frequently-asked questions that a NY/NJ employment-law
 * client would actually ask AND that the page already answers. Returns
 * { pairs: [{ question, answer }] } for the schema generator UI to drop
 * into the FAQPage form for review.
 *
 * Why grounding matters: Google rewards FAQ schema where the answer text
 * matches visible page content. Hallucinated answers risk being treated as
 * deceptive markup. The system prompt forces the model to draw from the
 * page text.
 */

import { NextRequest, NextResponse } from "next/server";

import { getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { snapshotPage } from "@/lib/page-snapshot";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (!raw) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return NextResponse.json({ error: "http(s) only" }, { status: 400 });
  }

  let snapshot;
  try {
    snapshot = await snapshotPage(url.toString());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (snapshot.status >= 400) {
    return NextResponse.json(
      { error: `page returned HTTP ${snapshot.status}` },
      { status: 502 },
    );
  }

  // Strip HTML tags from the body excerpt so the model sees plain text.
  const bodyText = snapshot.htmlExcerpt
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const firm = await getFirmContext();

  const system = `You produce FAQPage Q&A grounded in a single existing page's content. ${firm}

Rules:
- Draft questions a real prospective client would type into Google or ask out loud — not search-engine bait.
- Every answer MUST be grounded in the page text supplied below. Paraphrase the page's own wording. Do NOT invent facts not present on the page.
- If the page doesn't cover something a user would ask, OMIT that question rather than inventing an answer.
- Answers should be 1-3 sentences, conversational, second person ("you", "your").
- Never give legal advice or guarantees of outcome. Phrasing like "in many cases" / "may be able to" / "courts often" is safer than "will" / "always".
- Aim for 5-8 high-quality Q&A pairs. Fewer is better than padding.`;

  const user = `Target URL: ${snapshot.url}
Page title: ${snapshot.title ?? "(none)"}
Meta description: ${snapshot.metaDescription ?? "(none)"}
H1: ${snapshot.h1 ?? "(none)"}

Page text (extracted from the rendered HTML):
---
${bodyText.slice(0, 6000)}
---

Call the return_qa tool with 5-8 grounded Q&A pairs based on this page.`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 3000,
      system,
      tools: [
        {
          name: "return_qa",
          description:
            "Return 5-8 FAQ Q&A pairs grounded in the supplied page text.",
          input_schema: {
            type: "object" as const,
            properties: {
              pairs: {
                type: "array",
                description:
                  "Q&A pairs. Each answer must be grounded in the supplied page text.",
                items: {
                  type: "object",
                  properties: {
                    question: {
                      type: "string",
                      description:
                        "A natural question a real prospective client would ask.",
                    },
                    answer: {
                      type: "string",
                      description:
                        "1-3 sentences paraphrased from the page text. No invented facts.",
                    },
                  },
                  required: ["question", "answer"],
                },
              },
            },
            required: ["pairs"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "return_qa" },
      messages: [{ role: "user", content: user }],
    });

    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json(
        { error: "model returned no Q&A" },
        { status: 502 },
      );
    }
    const input = toolUse.input as {
      pairs?: Array<{ question?: string; answer?: string }>;
    };
    const pairs = (input.pairs ?? [])
      .filter(
        (p): p is { question: string; answer: string } =>
          typeof p?.question === "string" &&
          typeof p?.answer === "string" &&
          p.question.trim().length > 0 &&
          p.answer.trim().length > 0,
      )
      .slice(0, 12);

    return NextResponse.json({
      pairs,
      sourceUrl: snapshot.url,
      pageTitle: snapshot.title,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Q&A generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
