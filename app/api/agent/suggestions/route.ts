/**
 * GET /api/agent/suggestions
 *
 * Context-aware starter prompts for Peggy's page. Each is something Peggy can
 * actually do with her tools, phrased around the firm's CURRENT state (rank
 * drops, active recommendations, the AutoPilot queue, open opportunities) so the
 * list refreshes as the system changes. Fail-soft: any query that errors is
 * skipped, and there's always an evergreen fallback so the list is never empty.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";

export const runtime = "nodejs";

const EVERGREEN = [
  "What's trending in my practice areas this month?",
  "What should we write next? Find and brief the top opportunities.",
];

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  const sb = await getTenantDb();
  const dynamic: string[] = [];

  // 1. Tracked keywords that lost rank (current_rank - previous_rank > 5).
  try {
    const { data } = await sb
      .from("seo_keywords")
      .select("current_rank, previous_rank")
      .not("current_rank", "is", null)
      .not("previous_rank", "is", null);
    const drops = (data ?? []).filter(
      (k) => (k.current_rank as number) - (k.previous_rank as number) > 5,
    ).length;
    if (drops > 0) {
      dynamic.push(
        `${drops} tracked keyword${drops === 1 ? "" : "s"} dropped in rank — show me which and what to do.`,
      );
    }
  } catch {
    /* no keyword data — skip */
  }

  // 2. Active strategy recommendations awaiting action.
  try {
    const { count } = await sb
      .from("recommendation_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    if (count && count > 0) {
      dynamic.push(`List my top ${Math.min(count, 5)} active recommendations by impact.`);
    }
  } catch {
    /* skip */
  }

  // 3. On-page AutoPilot fixes pending approval.
  try {
    const { count } = await sb
      .from("wp_autopilot_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (count && count > 0) {
      dynamic.push(`What's in my AutoPilot queue waiting for approval? (${count} pending)`);
    }
  } catch {
    /* skip */
  }

  // 4. Open content opportunity — offer to draft it end-to-end.
  try {
    const { data } = await sb
      .from("seo_opportunities")
      .select("keyword")
      .order("search_volume", { ascending: false, nullsFirst: false })
      .limit(1);
    const kw = (data?.[0]?.keyword as string | undefined)?.trim();
    if (kw) {
      dynamic.push(`Draft a blog post about "${kw}" and send it for approval.`);
    }
  } catch {
    /* skip */
  }

  // 5. Trending — phrased around the firm's first practice area when known.
  try {
    const { data } = await sb
      .from("tenant_settings")
      .select("practice_areas")
      .maybeSingle();
    const raw = (data as { practice_areas?: unknown } | null)?.practice_areas;
    let pa: string | null = null;
    if (Array.isArray(raw) && raw.length) {
      const first = raw[0] as unknown;
      pa =
        typeof first === "string"
          ? first
          : ((first as { name?: string; label?: string })?.name ??
            (first as { name?: string; label?: string })?.label ??
            null);
    }
    if (pa) dynamic.push(`What's trending in ${pa} this month?`);
  } catch {
    /* skip */
  }

  // Dedupe, prefer dynamic, top up with evergreen, cap at 6.
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const s of [...dynamic, ...EVERGREEN]) {
    if (s && !seen.has(s)) {
      seen.add(s);
      suggestions.push(s);
    }
    if (suggestions.length >= 6) break;
  }

  return NextResponse.json({ suggestions });
}
