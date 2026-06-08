/**
 * GET /api/metrics/overview — date-scoped marketing KPIs with period-over-period
 * deltas, drawn from the sources we can actually filter by date:
 *   - calls          public.calls.start_time
 *   - coach scores   public.call_scores.scored_at
 *   - spend          public.marketing_spend.period_month
 *
 * Query params (all optional):
 *   ?since=YYYY-MM-DD   window start (default: 29 days before until)
 *   ?until=YYYY-MM-DD   window end   (default: today)
 *
 * The "prior" window is the equally-long span immediately before [since, until],
 * so callers get a like-for-like comparison without computing dates themselves.
 */
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

type Json = Record<string, unknown>;

function parseDay(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function delta(current: number, prior: number): { abs: number; pct: number | null } {
  const abs = Math.round((current - prior) * 100) / 100;
  const pct = prior > 0 ? Math.round(((current - prior) / prior) * 1000) / 10 : null;
  return { abs, pct };
}

type WindowAgg = {
  calls: number;
  answered: number;
  missed: number;
  voicemail: number;
  scored: number;
  avg_score: number | null;
  spend: number;
};

export async function GET(req: NextRequest) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });
  const tid = await resolveTenantId();

  const sp = req.nextUrl.searchParams;
  const untilDay = parseDay(sp.get("until")) ?? new Date();
  const until = new Date(Date.UTC(untilDay.getUTCFullYear(), untilDay.getUTCMonth(), untilDay.getUTCDate()));
  const sinceParam = parseDay(sp.get("since"));
  const since = sinceParam
    ? new Date(Date.UTC(sinceParam.getUTCFullYear(), sinceParam.getUTCMonth(), sinceParam.getUTCDate()))
    : new Date(until.getTime() - 29 * DAY_MS);

  if (since.getTime() > until.getTime()) {
    return NextResponse.json({ error: "since must be on or before until" }, { status: 400 });
  }

  // Inclusive day count, and the equally-long prior window ending the day before `since`.
  const days = Math.round((until.getTime() - since.getTime()) / DAY_MS) + 1;
  const curStart = since;
  const curEnd = new Date(until.getTime() + DAY_MS - 1); // end of `until` day
  const priorEnd = new Date(curStart.getTime() - 1);
  const priorStart = new Date(curStart.getTime() - days * DAY_MS);

  const inCur = (t: number) => t >= curStart.getTime() && t <= curEnd.getTime();
  const inPrior = (t: number) => t >= priorStart.getTime() && t <= priorEnd.getTime();

  // --- Calls (start_time) across both windows in one fetch ---------------------
  const { data: calls, error: callsErr } = await supabase
    .from("calls")
    .select("answered, voicemail, start_time")
    .eq("tenant_id", tid)
    .gte("start_time", priorStart.toISOString())
    .lte("start_time", curEnd.toISOString())
    .limit(50000);
  if (callsErr) return NextResponse.json({ error: callsErr.message }, { status: 500 });

  // --- Coach scores (scored_at) ------------------------------------------------
  const { data: scores, error: scoresErr } = await supabase
    .from("call_scores")
    .select("overall_score, scored_at")
    .eq("tenant_id", tid)
    .gte("scored_at", priorStart.toISOString())
    .lte("scored_at", curEnd.toISOString())
    .limit(50000);
  if (scoresErr) return NextResponse.json({ error: scoresErr.message }, { status: 500 });

  // --- Spend (period_month) ----------------------------------------------------
  const { data: spendRows, error: spendErr } = await supabase
    .from("marketing_spend")
    .select("amount, period_month")
    .eq("tenant_id", tid)
    .gte("period_month", dayKey(new Date(Date.UTC(priorStart.getUTCFullYear(), priorStart.getUTCMonth(), 1))))
    .lte("period_month", dayKey(curEnd))
    .limit(50000);
  if (spendErr) return NextResponse.json({ error: spendErr.message }, { status: 500 });

  // Aggregate.
  const blank = (): { agg: WindowAgg; scoreSum: number; scoreCount: number } => ({
    agg: { calls: 0, answered: 0, missed: 0, voicemail: 0, scored: 0, avg_score: null, spend: 0 },
    scoreSum: 0,
    scoreCount: 0,
  });
  const cur = blank();
  const prior = blank();
  const curSeries = new Map<string, number>();

  for (const c of (calls ?? []) as Json[]) {
    const t = new Date(c.start_time as string).getTime();
    if (Number.isNaN(t)) continue;
    const bucket = inCur(t) ? cur : inPrior(t) ? prior : null;
    if (!bucket) continue;
    bucket.agg.calls += 1;
    if (c.voicemail === true) bucket.agg.voicemail += 1;
    else if (c.answered === true) bucket.agg.answered += 1;
    else bucket.agg.missed += 1;
    if (bucket === cur) {
      const k = dayKey(new Date(t));
      curSeries.set(k, (curSeries.get(k) ?? 0) + 1);
    }
  }

  for (const s of (scores ?? []) as Json[]) {
    const t = new Date(s.scored_at as string).getTime();
    if (Number.isNaN(t)) continue;
    const bucket = inCur(t) ? cur : inPrior(t) ? prior : null;
    if (!bucket) continue;
    bucket.agg.scored += 1;
    const sc = s.overall_score;
    if (typeof sc === "number" && Number.isFinite(sc)) {
      bucket.scoreSum += sc;
      bucket.scoreCount += 1;
    }
  }

  for (const r of (spendRows ?? []) as Json[]) {
    const m = parseDay(r.period_month as string);
    if (!m) continue;
    const t = m.getTime();
    if (inCur(t)) cur.agg.spend += num(r.amount);
    else if (inPrior(t)) prior.agg.spend += num(r.amount);
  }

  cur.agg.avg_score = cur.scoreCount ? Math.round(cur.scoreSum / cur.scoreCount) : null;
  prior.agg.avg_score = prior.scoreCount ? Math.round(prior.scoreSum / prior.scoreCount) : null;

  // Fill the current-window daily series so the sparkline has no gaps.
  const series: { date: string; calls: number }[] = [];
  for (let t = curStart.getTime(); t <= until.getTime(); t += DAY_MS) {
    const k = dayKey(new Date(t));
    series.push({ date: k, calls: curSeries.get(k) ?? 0 });
  }

  return NextResponse.json({
    window: { since: dayKey(curStart), until: dayKey(until), days },
    previous: { since: dayKey(priorStart), until: dayKey(priorEnd) },
    current: cur.agg,
    prior: prior.agg,
    deltas: {
      calls: delta(cur.agg.calls, prior.agg.calls),
      answered: delta(cur.agg.answered, prior.agg.answered),
      missed: delta(cur.agg.missed, prior.agg.missed),
      scored: delta(cur.agg.scored, prior.agg.scored),
      avg_score: delta(cur.agg.avg_score ?? 0, prior.agg.avg_score ?? 0),
      spend: delta(cur.agg.spend, prior.agg.spend),
    },
    series,
  });
}
