/**
 * POST /api/compliance/state-rules/seed
 *
 * AI-drafts attorney-advertising compliance rules for US jurisdictions (50
 * states + DC) and persists any that don't already exist for the tenant.
 * Follows the forced-tool-use pattern from /api/brand-voice/wizard/generate so
 * the model output is parsed by the SDK into a validated object.
 *
 *   body: { codes?: string[] }   // default: all jurisdictions not yet seeded
 *
 * Every drafted row is stored as review_status='unverified'. These are a
 * STARTING POINT — they must be verified by counsel before being relied upon.
 *
 * Response: { inserted, requested, skipped, batches }
 */

import { NextRequest, NextResponse } from "next/server";

import { getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";
import {
  insertStateRulesIfMissing,
  listStateRules,
  type KeyRule,
} from "@/lib/compliance-rules-store";
import { US_JURISDICTIONS, US_JURISDICTION_NAME } from "@/lib/us-jurisdictions";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BATCH_SIZE = 8;

const SYSTEM = `You are an expert in U.S. legal-ethics and attorney-advertising rules. For each U.S. jurisdiction you are given, summarize the rules that govern how a law firm may advertise to the public (the state's Rules of Professional Conduct, typically RPC 7.1-7.5, plus any state-specific advertising rules, filing/review requirements, or required labels).

Be accurate and concrete, but NEVER invent a citation, rule number, dollar figure, or requirement you are not confident about. When you are unsure of a state-specific detail, state the general principle and add a short "verify with [state] bar" note rather than fabricating specifics. These drafts will be reviewed by an attorney before use.`;

type ToolState = {
  jurisdiction_code: string;
  governing_authority: string;
  rules_summary: string;
  required_label: string;
  key_rules: KeyRule[];
};

const TOOL = {
  name: "save_state_rules",
  description: "Save the drafted attorney-advertising rules for each jurisdiction.",
  input_schema: {
    type: "object" as const,
    properties: {
      states: {
        type: "array",
        items: {
          type: "object",
          properties: {
            jurisdiction_code: {
              type: "string",
              description: "Two-letter code, e.g. CA, TX, DC.",
            },
            governing_authority: {
              type: "string",
              description:
                "The governing rule set, e.g. 'California Rules of Professional Conduct, Rule 7.1-7.5'.",
            },
            rules_summary: {
              type: "string",
              description:
                "120-250 words of plain prose describing what is and isn't allowed in attorney advertising in this jurisdiction. This text is injected into a compliance-checker prompt.",
            },
            required_label: {
              type: "string",
              description:
                "Any required label/disclosure on ads, e.g. 'Attorney Advertising'. Empty string if none / unsure.",
            },
            key_rules: {
              type: "array",
              description: "4-8 of the most important concrete rules.",
              items: {
                type: "object",
                properties: {
                  citation: { type: "string", description: "Rule cite, e.g. 'RPC 7.1(a)'." },
                  rule: { type: "string", description: "What the rule requires/forbids." },
                  severity: { type: "string", enum: ["high", "medium", "low"] },
                },
                required: ["rule", "severity"],
              },
            },
          },
          required: ["jurisdiction_code", "rules_summary", "key_rules"],
        },
      },
    },
    required: ["states"],
  },
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeKeyRules(v: unknown): KeyRule[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      citation: str(r.citation),
      rule: str(r.rule),
      severity: (r.severity === "high" || r.severity === "low"
        ? r.severity
        : "medium") as KeyRule["severity"],
    }))
    .filter((r) => r.rule);
}

async function draftBatch(
  codes: string[],
): Promise<Array<ToolState>> {
  const list = codes
    .map((c) => `- ${c}: ${US_JURISDICTION_NAME[c] ?? c}`)
    .join("\n");
  const user = `Draft attorney-advertising compliance rules for these U.S. jurisdictions. Call save_state_rules with one entry per jurisdiction (use the exact two-letter code given):

${list}`;

  const resp = await getAnthropic().messages.create({
    model: KEYWORD_RESEARCH_MODEL,
    max_tokens: 8192,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
  });

  const block = resp.content.find((b) => b.type === "tool_use");
  const input = (block && block.type === "tool_use"
    ? (block.input as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const states = Array.isArray(input.states) ? input.states : [];
  return states
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      jurisdiction_code: str(s.jurisdiction_code).toUpperCase(),
      governing_authority: str(s.governing_authority),
      rules_summary: str(s.rules_summary),
      required_label: str(s.required_label),
      key_rules: normalizeKeyRules(s.key_rules),
    }))
    .filter((s) => s.jurisdiction_code && s.rules_summary);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const requestedCodes = Array.isArray(body?.codes)
    ? (body.codes as unknown[])
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim().toUpperCase())
    : null;

  try {
    // Only draft jurisdictions that don't already exist for this tenant.
    const existing = await listStateRules();
    const have = new Set(
      existing.map((r) => r.jurisdiction_code.toUpperCase()),
    );
    const allCodes = (requestedCodes ?? US_JURISDICTIONS.map((j) => j.code)).filter(
      (c) => US_JURISDICTION_NAME[c],
    );
    const targets = allCodes.filter((c) => !have.has(c));

    if (targets.length === 0) {
      return NextResponse.json({
        inserted: 0,
        requested: allCodes.length,
        skipped: allCodes.length,
        batches: 0,
        message: "All requested jurisdictions already have rules.",
      });
    }

    let inserted = 0;
    let batches = 0;
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      batches += 1;
      const drafts = await draftBatch(batch);
      const rows = drafts
        .filter((d) => US_JURISDICTION_NAME[d.jurisdiction_code])
        .map((d) => ({
          jurisdiction_code: d.jurisdiction_code,
          jurisdiction_name: US_JURISDICTION_NAME[d.jurisdiction_code],
          governing_authority: d.governing_authority || null,
          rules_summary: d.rules_summary,
          required_label: d.required_label || null,
          key_rules: d.key_rules,
        }));
      inserted += await insertStateRulesIfMissing(rows);
    }

    return NextResponse.json({
      inserted,
      requested: allCodes.length,
      skipped: allCodes.length - targets.length,
      batches,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Seed failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
