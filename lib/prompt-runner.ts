/**
 * Prompt template renderer + executor.
 *
 * Variable syntax: {{variable_name}}. extractVariables walks a template and
 * returns the unique variable names in order of first appearance, which the
 * UI uses to build a form. renderTemplate substitutes each occurrence.
 *
 * Execute calls Claude (Anthropic) and returns the text + usage stats so we
 * can record a per-run cost estimate. Cost is priced PER MODEL — see PRICING.
 */

import { getAnthropic } from "./anthropic";

/**
 * $/MTok list pricing, keyed by the exact model id stored on the prompt.
 *
 * This used to be a single flat Sonnet rate applied to every run, which was
 * wrong for two of the three models the /prompts picker offers: an Opus 4.7 run
 * was recorded at roughly 60% of its real cost, a Haiku 4.5 run at about 3x.
 * The rate has to follow the model, because the model is user-selectable.
 *
 * Approximate list prices — check https://anthropic.com/pricing before using
 * these for anything that bills a client. A model MISSING from this table
 * prices as null (see priceRun) rather than falling back to some other model's
 * rate: an absent number is honest, a confidently wrong one is not, and this
 * table WILL fall behind the picker the next time a model is added there.
 */
const PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  "claude-sonnet-4-5-20250929": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-4-5-20251001": { inputPerMillion: 1, outputPerMillion: 5 },
  "claude-opus-4-7": { inputPerMillion: 5, outputPerMillion: 25 },
};

/**
 * Cost of one run in dollars, or null when we don't have a rate for the model.
 * Null flows through to ai_prompt_runs.cost_estimate, which is already nullable;
 * the result panel shows "cost n/a" and the run-history list omits the figure
 * (it has always guarded on != null).
 */
function priceRun(model: string, inputTokens: number, outputTokens: number): number | null {
  const rate = PRICING[model];
  if (!rate) return null;
  const cost =
    (inputTokens / 1_000_000) * rate.inputPerMillion +
    (outputTokens / 1_000_000) * rate.outputPerMillion;
  return Math.round(cost * 10000) / 10000;
}

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
  /** Null when PRICING has no rate for the model that ran. */
  costEstimate: number | null;
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

  return {
    output: text,
    inputTokens,
    outputTokens,
    costEstimate: priceRun(args.model, inputTokens, outputTokens),
    latencyMs,
    rendered: { system: renderedSystem, user: renderedUser },
  };
}
