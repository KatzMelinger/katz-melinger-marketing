import { NextRequest, NextResponse } from "next/server";

import { fetchCmsJson } from "@/lib/cms-server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

type SourceCount = { source: string; count: number };
type SourceRevenue = { source: string; settlements: number; revenue: number };
type SourceSpend = { source: string; spend: number };
type RevenueAttribution = {
  area_of_law: string;
  settlement_count: number;
  total_settlement_value: number;
};

type FunnelRow = {
  source: string;
  intakes: number;
  matters: number;
  settlements: number;
  revenue: number;
  spend: number;
};

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeSource(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Unknown";
}

function toSourceCountRows(input: unknown): SourceCount[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      const src = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
      if (!src) return null;
      const source = normalizeSource(String(src.source ?? src.channel ?? ""));
      const count = num(src.count ?? src.matters ?? src.intakes);
      return { source, count };
    })
    .filter((row): row is SourceCount => row !== null);
}

function toRevenueRows(input: unknown): SourceRevenue[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      const src = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
      if (!src) return null;
      const source = normalizeSource(String(src.source ?? src.channel ?? src.area_of_law ?? ""));
      return {
        source,
        settlements: num(src.settlements ?? src.settlement_count ?? src.count),
        revenue: num(src.revenue ?? src.total_settlement_value ?? src.value),
      };
    })
    .filter((row): row is SourceRevenue => row !== null);
}

function toSpendRows(input: unknown): SourceSpend[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      const src = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
      if (!src) return null;
      return {
        source: normalizeSource(String(src.source ?? src.channel ?? "")),
        spend: num(src.spend ?? src.amount ?? src.value),
      };
    })
    .filter((row): row is SourceSpend => row !== null);
}

/**
 * Manual spend from public.marketing_spend, summed per source across the
 * optional [since, until] month window. Used to fill in (and override) the CMS
 * spend figures, which are empty in this deployment.
 */
async function fetchManualSpend(
  since: string | null,
  until: string | null,
): Promise<Map<string, number>> {
  const supabase = getSupabaseServer();
  const out = new Map<string, number>();
  if (!supabase) return out;
  let q = supabase.from("marketing_spend").select("source, amount, period_month").eq("tenant_id", await resolveTenantId());
  if (since) q = q.gte("period_month", since);
  if (until) q = q.lte("period_month", until);
  const { data, error } = await q;
  if (error || !data) return out;
  for (const row of data as Array<Record<string, unknown>>) {
    const source = normalizeSource(String(row.source ?? ""));
    out.set(source, (out.get(source) ?? 0) + num(row.amount));
  }
  return out;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const since = sp.get("since");
  const until = sp.get("until");

  const [intakesRaw, mattersRaw, settlementsRaw, spendRaw, attributionRaw, manualSpend] =
    await Promise.all([
      fetchCmsJson<unknown>("/api/v1/intakes/by-source"),
      fetchCmsJson<unknown>("/api/v1/matters/by-source"),
      fetchCmsJson<unknown>("/api/v1/revenue/settlements-by-source"),
      fetchCmsJson<unknown>("/api/v1/marketing/spend-by-source"),
      fetchCmsJson<{ breakdown?: unknown }>("/api/v1/revenue/attribution"),
      fetchManualSpend(since, until),
    ]);

  const intakes = toSourceCountRows(intakesRaw);
  const matters = toSourceCountRows(mattersRaw);
  const settlementsDirect = toRevenueRows(settlementsRaw);
  const spend = toSpendRows(spendRaw);

  const breakdownFallbackRaw = Array.isArray(attributionRaw?.breakdown)
    ? (attributionRaw?.breakdown as RevenueAttribution[])
    : [];
  const settlementsFallback: SourceRevenue[] = breakdownFallbackRaw.map((row) => ({
    source: normalizeSource(row.area_of_law),
    settlements: num(row.settlement_count),
    revenue: num(row.total_settlement_value),
  }));

  const settlements =
    settlementsDirect.length > 0 ? settlementsDirect : settlementsFallback;

  const keys = new Set<string>();
  for (const row of intakes) keys.add(row.source);
  for (const row of matters) keys.add(row.source);
  for (const row of settlements) keys.add(row.source);
  for (const row of spend) keys.add(row.source);
  for (const source of manualSpend.keys()) keys.add(source);

  const intakesMap = new Map(intakes.map((row) => [row.source, row.count] as const));
  const mattersMap = new Map(matters.map((row) => [row.source, row.count] as const));
  const settlementsMap = new Map(
    settlements.map((row) => [row.source, row.settlements] as const),
  );
  const revenueMap = new Map(settlements.map((row) => [row.source, row.revenue] as const));
  const spendMap = new Map(spend.map((row) => [row.source, row.spend] as const));

  const rows: FunnelRow[] = [...keys].map((source) => {
    // Manual spend wins when present; otherwise fall back to the CMS figure.
    const manual = manualSpend.get(source);
    const spendValue = manual != null && manual > 0 ? manual : spendMap.get(source) ?? 0;
    return {
      source,
      intakes: intakesMap.get(source) ?? 0,
      matters: mattersMap.get(source) ?? settlementsMap.get(source) ?? 0,
      settlements: settlementsMap.get(source) ?? 0,
      revenue: revenueMap.get(source) ?? 0,
      spend: spendValue,
    };
  });

  rows.sort((a, b) => b.revenue - a.revenue || b.intakes - a.intakes);

  return NextResponse.json({ rows });
}
