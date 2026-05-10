/**
 * Prompt template renderer + executor.
 *
 * Variable syntax: {{variable_name}}. extractVariables walks a template and
 * returns the unique variable names in order of first appearance, which the
 * UI uses to build a form. renderTemplate substitutes each occurrence.
 *
 * Execute calls Claude (Anthropic) and returns the text + usage stats so we
 * can record a per-run cost estimate. Cost is computed from Anthropic's
 * Sonnet 4.5 list pricing — adjust the constants when models change.
 */

import { getAnthropic } from "./anthropic";

// $/MTok pricing for Claude Sonnet 4.5 (approximate; check current Anthropic
// docs before relying on this for billing).
const PRICING = {
  inputPerMillion: 3,
  outputPerMillion: 15,
};

const VAR_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function extractVariables(...sources: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  for (const src of sources) {
    if (!src) continue;
    let m: RegExpExecArray | null;
    const re = new RegExp(VAR_REGEX.source, "g");
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      if (!seen.has(name)) seen.add(name);
    }
  }
  return Array.from(seen);
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(VAR_REGEX, (_, name) => {
    const v = vars[name];
    return v == null ? "" : String(v);
  });
}

export type RunResult = {
  output: string;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  latencyMs: number;
  rendered: { system: string | null; user: string };
};

export async function runPrompt(args: {
  systemPrompt?: string | null;
  userPrompt: string;
  variables: Record<string, string>;
  model: string;
  maxTokens: number;
}): Promise<RunResult> {
  const renderedSystem = args.systemPrompt ? renderTemplate(args.systemPrompt, args.variables) : null;
  const renderedUser = renderTemplate(args.userPrompt, args.variables);

  const started = Date.now();
  const resp = await getAnthropic().messages.create({
    model: args.model,
    max_tokens: args.maxTokens,
    system: renderedSystem ?? undefined,
    messages: [{ role: "user", content: renderedUser }],
  });
  const latencyMs = Date.now() - started;

  const text =
    resp.content[0]?.type === "text" ? resp.content[0].text : "";

  const inputTokens = resp.usage?.input_tokens ?? 0;
  const outputTokens = resp.usage?.output_tokens ?? 0;
  const costEstimate =
    (inputTokens / 1_000_000) * PRICING.inputPerMillion +
    (outputTokens / 1_000_000) * PRICING.outputPerMillion;

  return {
    output: text,
    inputTokens,
    outputTokens,
    costEstimate: Math.round(costEstimate * 10000) / 10000,
    latencyMs,
    rendered: { system: renderedSystem, user: renderedUser },
  };
}
