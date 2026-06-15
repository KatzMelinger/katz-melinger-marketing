/**
 * POST /api/seo/schema-generator
 *   body: { templateId, params: { ... } }
 *
 * Takes a curated template id (see lib/schema-templates.ts) + the marketer's
 * inputs, asks Claude (via tool-use) to compose valid JSON-LD that's true to
 * the inputs + the firm's context. Returns { jsonld, schemaType, pageUrl }.
 *
 * Tool-use guarantees the response is parseable JSON — we never have to deal
 * with stray markdown fences or unescaped quotes.
 */

import { NextRequest, NextResponse } from "next/server";

import { getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import { getFirmContext } from "@/lib/firm-context";
import { findTemplate } from "@/lib/schema-templates";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    templateId?: unknown;
    params?: unknown;
  };
  const templateId =
    typeof body.templateId === "string" ? body.templateId : "";
  const params =
    body.params && typeof body.params === "object"
      ? (body.params as Record<string, unknown>)
      : {};
  if (!templateId) {
    return NextResponse.json(
      { error: "templateId required" },
      { status: 400 },
    );
  }
  const template = findTemplate(templateId);
  if (!template) {
    return NextResponse.json({ error: "unknown template" }, { status: 400 });
  }
  const pageUrl =
    typeof params.pageUrl === "string" ? params.pageUrl.trim() : "";
  if (!pageUrl) {
    return NextResponse.json(
      { error: "params.pageUrl required" },
      { status: 400 },
    );
  }
  try {
    new URL(pageUrl);
  } catch {
    return NextResponse.json(
      { error: "params.pageUrl is not a valid URL" },
      { status: 400 },
    );
  }

  const firm = await getFirmContext();
  const paramsBlock = Object.entries(params)
    .map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");

  const system = `You compose Schema.org JSON-LD for a law firm's website. Output must be a single valid JSON object (no @graph wrapper, no markdown), conforming to Schema.org for the requested type.

${firm}

Rules:
- The JSON object must have @context = "https://schema.org" and @type = "${template.schemaType}".
- Do NOT invent facts not in the firm context or user inputs. If a field has no value, omit it from the output.
- Use the firm's canonical contact info from the brand context for address, telephone, email, and url when relevant.
- Phone numbers should use E.164 format (e.g. "+1-212-460-0047") when available.
- For dates, use ISO 8601 (YYYY-MM-DD).
- The output MUST be JSON-LD only — no commentary, no markdown, no <script> tag. The caller wraps it.`;

  const user = `Generate Schema.org "${template.schemaType}" JSON-LD for the page below.

Template purpose: ${template.description}

Page URL (use as the schema's "url" or "mainEntityOfPage" field as appropriate):
${pageUrl}

Marketer-provided inputs:
${paramsBlock || "(none beyond pageUrl)"}

Call the return_schema tool with the JSON-LD as a JSON object plus a one-sentence rationale the marketer will see when this is queued for AutoPilot.`;

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      max_tokens: 4096,
      system,
      tools: [
        {
          name: "return_schema",
          description:
            "Return the composed JSON-LD as an object plus a one-sentence rationale.",
          input_schema: {
            type: "object" as const,
            properties: {
              jsonld: {
                type: "object",
                description:
                  "The full JSON-LD object. Must include @context, @type, and the relevant Schema.org fields.",
              },
              rationale: {
                type: "string",
                description:
                  "One sentence the marketer sees in the AutoPilot queue explaining what this schema adds.",
              },
            },
            required: ["jsonld", "rationale"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "return_schema" },
      messages: [{ role: "user", content: user }],
    });

    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json(
        { error: "model returned no schema" },
        { status: 502 },
      );
    }
    const input = toolUse.input as {
      jsonld?: Record<string, unknown>;
      rationale?: string;
    };
    if (!input.jsonld || typeof input.jsonld !== "object") {
      return NextResponse.json(
        { error: "model returned invalid jsonld" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      jsonld: input.jsonld,
      jsonld_string: JSON.stringify(input.jsonld, null, 2),
      schemaType: template.schemaType,
      pageUrl,
      rationale: input.rationale ?? "",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Schema generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
