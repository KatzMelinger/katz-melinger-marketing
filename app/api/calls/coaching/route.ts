/**
 * GET /api/calls/coaching — per-agent sales-coaching rollup.
 *
 * call_scores has no agent column, so we join each score back to its call via
 * call_id -> calls.agent_email. For every intake rep we surface: how many calls
 * were scored, their average overall score, a recent-vs-prior trend delta, a
 * rubric-type breakdown, and the dimensions they most consistently lose points
 * on (recurring weaknesses) plus their strongest dimensions.
 *
 * Optional query params:
 *   ?since=ISO            only count scores on/after this timestamp
 *   ?min_calls=N          drop agents with fewer than N scored calls (default 1)
 */
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;

type DimensionRollup = {
  dimension_key: string;
  dimension_name: string;
  calls: number;
  earned: number;
  possible: number;
  pct: number; // 0–100, earned/possible
};

type AgentRollup = {
  agent_email: string;
  scored_count: number;
  avg_overall: number | null;
  trend_delta: number | null; // recent-half avg minus prior-half avg
  rubric_breakdown: Record<string, number>;
  weaknesses: DimensionRollup[];
  strengths: DimensionRollup[];
  recent_calls: Array<{
    call_id: string;
    overall_score: number | null;
    rubric_type: string | null;
    scored_at: string | null;
  }>;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function GET(req: NextRequest) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const since = sp.get("since");
  const minCalls = Math.max(1, Math.floor(Number(sp.get("min_calls") ?? "1")) || 1);

  // 1. Map every call to its agent (calls is the only table with agent_email).
  const { data: calls, error: callsErr } = await supabase
    .from("calls")
    .select("id, agent_email")
    .limit(20000);
  if (callsErr) return NextResponse.json({ error: callsErr.message }, { status: 500 });
  const agentByCall = new Map<string, string>();
  for (const c of (calls ?? []) as Json[]) {
    const id = c.id as string;
    const email = typeof c.agent_email === "string" && c.agent_email.trim() ? c.agent_email.trim() : "Unassigned";
    agentByCall.set(id, email);
  }

  // 2. Pull scores (most recent first) within the optional window.
  let sq = supabase
    .from("call_scores")
    .select("call_id, overall_score, rubric_type, scored_at, dimension_scores")
    .order("scored_at", { ascending: false })
    .limit(5000);
  if (since) sq = sq.gte("scored_at", since);
  const { data: scores, error: scoresErr } = await sq;
  if (scoresErr) return NextResponse.json({ error: scoresErr.message }, { status: 500 });

  // 3. Keep only the most recent score per call, then bucket by agent.
  type ScoreRow = {
    call_id: string;
    overall_score: number | null;
    rubric_type: string | null;
    scored_at: string | null;
    dimension_scores: Json[];
  };
  const seen = new Set<string>();
  const byAgent = new Map<string, ScoreRow[]>();
  for (const s of (scores ?? []) as Json[]) {
    const callId = s.call_id as string;
    if (seen.has(callId)) continue; // already have the latest for this call
    seen.add(callId);
    const agent = agentByCall.get(callId) ?? "Unassigned";
    const row: ScoreRow = {
      call_id: callId,
      overall_score: num(s.overall_score),
      rubric_type: typeof s.rubric_type === "string" ? s.rubric_type : null,
      scored_at: typeof s.scored_at === "string" ? s.scored_at : null,
      dimension_scores: Array.isArray(s.dimension_scores) ? (s.dimension_scores as Json[]) : [],
    };
    const list = byAgent.get(agent) ?? [];
    list.push(row);
    byAgent.set(agent, list);
  }

  // 4. Roll each agent up.
  const agents: AgentRollup[] = [];
  for (const [agent_email, rows] of byAgent) {
    if (rows.length < minCalls) continue;

    const overalls = rows.map((r) => r.overall_score).filter((v): v is number => v != null);
    const avg_overall = overalls.length
      ? Math.round(overalls.reduce((a, b) => a + b, 0) / overalls.length)
      : null;

    // Trend: rows are newest-first. Compare the recent half to the prior half.
    let trend_delta: number | null = null;
    if (overalls.length >= 4) {
      const half = Math.floor(overalls.length / 2);
      const recent = overalls.slice(0, half);
      const prior = overalls.slice(half);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      trend_delta = Math.round(mean(recent) - mean(prior));
    }

    const rubric_breakdown: Record<string, number> = {};
    for (const r of rows) {
      const key = r.rubric_type ?? "unclassified";
      rubric_breakdown[key] = (rubric_breakdown[key] ?? 0) + 1;
    }

    // Dimension rollup: accumulate earned/possible per dimension_key.
    const dims = new Map<string, DimensionRollup>();
    for (const r of rows) {
      for (const d of r.dimension_scores) {
        const dd = d as Json;
        const key = typeof dd.dimension_key === "string" ? dd.dimension_key : "";
        if (!key) continue;
        const score = num(dd.score) ?? 0;
        const max = num(dd.max) ?? 0;
        if (max <= 0) continue;
        const cur =
          dims.get(key) ??
          {
            dimension_key: key,
            dimension_name: typeof dd.dimension_name === "string" ? dd.dimension_name : key,
            calls: 0,
            earned: 0,
            possible: 0,
            pct: 0,
          };
        cur.calls += 1;
        cur.earned += score;
        cur.possible += max;
        if (typeof dd.dimension_name === "string" && dd.dimension_name) cur.dimension_name = dd.dimension_name;
        dims.set(key, cur);
      }
    }
    const dimList = [...dims.values()]
      .map((d) => ({ ...d, pct: d.possible > 0 ? Math.round((d.earned / d.possible) * 100) : 0 }))
      .filter((d) => d.calls >= Math.min(2, rows.length)); // ignore one-off dimensions when possible

    const weaknesses = [...dimList].sort((a, b) => a.pct - b.pct).slice(0, 3);
    const strengths = [...dimList].sort((a, b) => b.pct - a.pct).slice(0, 2);

    agents.push({
      agent_email,
      scored_count: rows.length,
      avg_overall,
      trend_delta,
      rubric_breakdown,
      weaknesses,
      strengths,
      recent_calls: rows.slice(0, 5).map((r) => ({
        call_id: r.call_id,
        overall_score: r.overall_score,
        rubric_type: r.rubric_type,
        scored_at: r.scored_at,
      })),
    });
  }

  // Most-coached first, then weakest average.
  agents.sort((a, b) => {
    if (b.scored_count !== a.scored_count) return b.scored_count - a.scored_count;
    return (a.avg_overall ?? 999) - (b.avg_overall ?? 999);
  });

  const totalScored = [...byAgent.values()].reduce((n, rows) => n + rows.length, 0);
  return NextResponse.json({
    agents,
    team: {
      agents_with_scores: agents.length,
      total_scored_calls: totalScored,
    },
  });
}
