/**
 * AI and data cost per draft and per month (Oct 20 spec, Task A17).
 *
 * Model calls made for a draft are written to the usage ledger
 * (external_api_usage) with detail "draft:<id>", priced from the token counts,
 * so System health can show the cost of each draft and of the month. A
 * monthly cap (Brand setting monthlyAiBudgetUsd) pauses the automatic runs
 * (Improve to Ready on new drafts) and alerts Kenneth; the buttons still work.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { recordUsage } from "./usage-meter";

/** US dollars per million tokens (input, output), by model family. */
const PRICE: { re: RegExp; input: number; output: number }[] = [
  { re: /haiku/i, input: 1, output: 5 },
  { re: /opus/i, input: 15, output: 75 },
  { re: /sonnet|fable/i, input: 3, output: 15 },
];

export function estimateCents(model: string, usage: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined): number {
  const p = PRICE.find((x) => x.re.test(model)) ?? PRICE[2];
  const inT = usage?.input_tokens ?? 0;
  const outT = usage?.output_tokens ?? 0;
  return Math.round(((inT * p.input + outT * p.output) / 1_000_000) * 100 * 100) / 100;
}

export async function recordAiCost(args: {
  tenantId: string;
  draftId?: string | null;
  endpoint: string;
  model: string;
  usage: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined;
}): Promise<void> {
  await recordUsage({
    tenantId: args.tenantId,
    provider: "anthropic",
    endpoint: args.endpoint,
    meter: "anthropic",
    units: 1,
    estCostCents: estimateCents(args.model, args.usage),
    detail: args.draftId ? `draft:${args.draftId}` : undefined,
  });
}

function monthStartISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export type CostSummary = {
  monthCents: number;
  byMeter: Record<string, number>;
  topDrafts: { draftId: string; cents: number; calls: number }[];
  budgetUsd: number | null;
  overBudget: boolean;
};

export async function costSummary(tenantId: string): Promise<CostSummary> {
  const sb = getSupabaseAdmin();
  const [{ data }, { data: budgetRow }] = await Promise.all([
    sb.from("external_api_usage").select("meter, est_cost_cents, detail").eq("tenant_id", tenantId).gte("created_at", monthStartISO()).range(0, 49999),
    sb.from("brand_voice_settings").select("value").eq("tenant_id", tenantId).eq("key", "monthlyAiBudgetUsd").maybeSingle(),
  ]);
  const byMeter: Record<string, number> = {};
  const byDraft = new Map<string, { cents: number; calls: number }>();
  let total = 0;
  for (const r of data ?? []) {
    const c = Number(r.est_cost_cents) || 0;
    total += c;
    byMeter[r.meter as string] = (byMeter[r.meter as string] ?? 0) + c;
    const m = /^draft:([0-9a-f-]{36})$/.exec(String(r.detail ?? ""));
    if (m) {
      const cur = byDraft.get(m[1]) ?? { cents: 0, calls: 0 };
      byDraft.set(m[1], { cents: cur.cents + c, calls: cur.calls + 1 });
    }
  }
  const budget = Number(budgetRow?.value);
  const budgetUsd = Number.isFinite(budget) && budget > 0 ? budget : null;
  return {
    monthCents: Math.round(total),
    byMeter,
    topDrafts: [...byDraft].map(([draftId, v]) => ({ draftId, cents: Math.round(v.cents), calls: v.calls })).sort((a, b) => b.cents - a.cents).slice(0, 15),
    budgetUsd,
    overBudget: budgetUsd !== null && total >= budgetUsd * 100,
  };
}

export async function overBudget(tenantId: string): Promise<boolean> {
  try {
    return (await costSummary(tenantId)).overBudget;
  } catch {
    return false;
  }
}
