/**
 * POST /api/content/drafts/[id]/apply-suggestion
 *   body: { finding: string }              — single finding
 *      OR { findings: string[] }           — apply multiple in one shot
 *
 * Takes one or more analysis findings (e.g. "No statute citations — add NYLL §740")
 * and the current draft body, asks Claude to make the minimum edits needed to
 * resolve them, and returns { updated_body, summary, no_change }.
 *
 * Multi-finding mode batches all changes into a single Claude call, which
 * is dramatically faster than looping single-finding calls and also lets the
 * model deconflict overlapping edits (e.g. "no H1" + "no keywords in title"
 * naturally combine into one new heading).
 *
 * Does NOT save the change — the caller (UI) shows a diff and the user
 * accepts before PATCH-ing the draft. This keeps the AI out of the
 * autosave loop and lets the user reject bad insertions.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  CONTENT_LONG_FORM_MODEL,
  getAnthropic,
} from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // Accept either { finding: string } or { findings: string[] }. Normalize
  // to a single list internally so the prompt builder doesn't branch.
  const findingList: string[] = [];
  if (typeof body?.finding === "string" && body.finding.trim()) {
    findingList.push(body.finding.trim());
  }
  if (Array.isArray(body?.findings)) {
    for (const f of body.findings) {
      if (typeof f === "string" && f.trim()) findingList.push(f.trim());
    }
  }
  if (findingList.length === 0) {
    return NextResponse.json(
      { error: "finding or findings required" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: draft, error } = await supabase
    .from("content_drafts")
    .select("body, title, topic, format, template")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const firm = await getFirmContext();

  const multi = findingList.length > 1;
  const feedbackBlock = multi
    ? findingList.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : findingList[0];

  const system = `You are an expert legal-content editor for a plaintiff-side employment law firm. You receive a finished draft and ${multi ? "a list of feedback items" : "a single piece of feedback"} from an analysis tool. Your job is to make the SMALLEST possible edits that resolve ${multi ? "ALL of the listed items" : "the feedback"} — never rewrite the whole piece, never restructure unprompted, never invent facts the original didn't include.

Hard rules:
- Preserve the original tone, voice, structure, and length wherever possible.
- Only modify the section(s) directly related to the feedback. Leave everything else byte-identical.
- If the feedback asks for a citation (e.g. "cite NYLL §740"), insert it naturally where it's most relevant, with a brief contextual sentence if needed.
- If the feedback asks for a missing section (e.g. "no H2 subheadings"), add the minimum structure to fix it — do not invent content the body doesn't support.
${multi ? "- When two items overlap (e.g. \"no H1\" + \"keyword missing from H1\"), satisfy both with a single coherent edit instead of two separate ones.\n" : ""}- If you can't honor ${multi ? "an item" : "the feedback"} without inventing facts or doing damage, leave that part unchanged and explain why in the summary. Apply whichever items you can.
- If you can't honor ANY of the items, return the body UNCHANGED and set no_change=true.
- Output the COMPLETE updated body, not just the changed lines. Use the same markdown conventions the original uses.

${firm}`;

  const user = `Format: ${draft.format ?? "blog"}${draft.template ? ` (template: ${draft.template})` : ""}
Topic: ${draft.topic ?? ""}
Current title: ${draft.title ?? "(none)"}

${multi ? `Feedback items to apply (resolve all where possible):` : `Feedback to apply:`}
"""
${feedbackBlock}
"""

Current draft body:
"""
${draft.body as string}
"""

Call the apply_edit tool with the complete updated body, a short summary of what changed${multi ? " (and which items, if any, you skipped and why)" : ""}, and the no_change flag.`;

  try {
    const resp = await getAnthropic().messages.create({
      model: CONTENT_LONG_FORM_MODEL,
      max_tokens: 8000,
      system,
      tools: [
        {
          name: "apply_edit",
          description:
            "Return the updated draft body, a one-or-two-sentence change summary, and a no_change flag indicating whether you decided to leave the draft unchanged.",
          input_schema: {
            type: "object" as const,
            properties: {
              updated_body: {
                type: "string",
                description:
                  "The COMPLETE updated draft body, in the same markdown conventions as the original. If you decided not to edit, return the original body verbatim.",
              },
              summary: {
                type: "string",
                description:
                  "One or two sentences describing exactly what you changed and where. If no_change is true, explain why.",
              },
              no_change: {
                type: "boolean",
                description:
                  "True if you decided not to edit the draft at all (e.g. honoring any item would require inventing facts).",
              },
            },
            required: ["updated_body", "summary", "no_change"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "apply_edit" },
      messages: [{ role: "user", content: user }],
    });

    // tool_choice forces a tool_use block — but the SDK still types content
    // as a union, so we narrow defensively.
    const toolUse = resp.content.find((b) => b.type === "tool_use");
    const parsed =
      toolUse && toolUse.type === "tool_use"
        ? (toolUse.input as {
            updated_body?: string;
            summary?: string;
            no_change?: boolean;
          })
        : null;

    const updated_body =
      typeof parsed?.updated_body === "string" && parsed.updated_body.trim()
        ? parsed.updated_body
        : (draft.body as string);
    const summary =
      typeof parsed?.summary === "string" ? parsed.summary : "";
    const no_change =
      parsed?.no_change === true || updated_body === (draft.body as string);

    return NextResponse.json({
      updated_body,
      original_body: draft.body as string,
      summary,
      no_change,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Apply failed" },
      { status: 500 },
    );
  }
}
