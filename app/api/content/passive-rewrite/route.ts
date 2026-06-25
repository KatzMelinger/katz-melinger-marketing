/**
 * POST /api/content/passive-rewrite
 *   body: { sentences: string[] }
 *
 * Rewrites passive-voice sentences in active voice. Batches every flagged
 * sentence into ONE Claude call (far faster than one call per sentence) and
 * returns suggestions aligned by index. Does NOT save — the caller shows each
 * suggestion next to the original and the user applies per sentence.
 *
 * Uses the prompt the spec mandates, preserving meaning, legal accuracy, and
 * approximate length, and adding no new information.
 */

import { NextRequest, NextResponse } from "next/server";

import { CONTENT_LONG_FORM_MODEL, getAnthropic } from "@/lib/anthropic";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SENTENCES = 40;

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const sentences: string[] = Array.isArray(body?.sentences)
    ? body.sentences
        .filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0)
        .slice(0, MAX_SENTENCES)
    : [];

  if (sentences.length === 0) {
    return NextResponse.json({ error: "No sentences provided" }, { status: 400 });
  }

  const system =
    "You rewrite passive-voice sentences from legal marketing content into active voice. " +
    "For each sentence: rewrite it in active voice, keep the same meaning and legal accuracy, " +
    "keep the same approximate length, and do not add new information. " +
    "If a sentence is already active or cannot be improved without changing meaning, return it unchanged.";

  const numbered = sentences
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");

  const user = `Rewrite each of the following sentences in active voice. Keep the same meaning and legal accuracy. Keep the same approximate length. Do not add new information.

Sentences:
"""
${numbered}
"""

Call return_rewrites with one entry per sentence, each carrying the original 1-based index and the active-voice rewrite.`;

  try {
    const resp = await getAnthropic().messages.create({
      model: CONTENT_LONG_FORM_MODEL,
      max_tokens: 4000,
      system,
      tools: [
        {
          name: "return_rewrites",
          description: "Return the active-voice rewrite for each numbered sentence.",
          input_schema: {
            type: "object" as const,
            properties: {
              rewrites: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: {
                      type: "integer",
                      description: "The 1-based index of the sentence being rewritten.",
                    },
                    suggestion: {
                      type: "string",
                      description:
                        "The sentence rewritten in active voice (same meaning, accuracy, and approximate length). Unchanged if no improvement is possible.",
                    },
                  },
                  required: ["index", "suggestion"],
                },
              },
            },
            required: ["rewrites"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "return_rewrites" },
      messages: [{ role: "user", content: user }],
    });

    const toolUse = resp.content.find((b) => b.type === "tool_use");
    const parsed =
      toolUse && toolUse.type === "tool_use"
        ? (toolUse.input as { rewrites?: { index?: number; suggestion?: string }[] })
        : { rewrites: [] };

    // Align suggestions back to the input order; fall back to the original.
    const byIndex = new Map<number, string>();
    for (const r of parsed.rewrites ?? []) {
      if (typeof r?.index === "number" && typeof r?.suggestion === "string") {
        byIndex.set(r.index, r.suggestion.trim());
      }
    }
    const rewrites = sentences.map((original, i) => ({
      original,
      suggestion: byIndex.get(i + 1)?.trim() || original,
    }));

    return NextResponse.json({ rewrites });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Rewrite failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
