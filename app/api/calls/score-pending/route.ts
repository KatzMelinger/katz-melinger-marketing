/**
 * Auto-score every answered call >= 60s that has a transcript but no score
 * row yet. Skips voicemails (the "answered=true && voicemail=true" combo)
 * since those aren't conversations. Newest calls first, so coaching stays
 * current; the 2026 backlog is handled by scripts/score-calls-backfill.ts.
 *
 * Each call also records who handled it (see lib/sales-staff.ts).
 *
 * POST /api/calls/score-pending — UI trigger ("Score pending" button).
 *   Body (optional): { limit: number, min_duration_seconds: number, since: ISO }
 *
 * GET /api/calls/score-pending — Vercel Cron trigger (hourly). Requires
 *   `Authorization: Bearer ${CRON_SECRET}`. Reads the same options from query
 *   params (?limit=&min_duration_seconds=&since=). Registered in vercel.json.
 */
import { NextRequest, NextResponse } from "next/server";

import { CALL_SCORING_COLUMNS, scoreAndSave } from "@/lib/call-scoring";
import { loadSalesStaff, type SalesStaff } from "@/lib/sales-staff";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase-server";
import { DEFAULT_TENANT_ID, resolveTenantId } from "@/lib/tenant-context";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Stop starting new calls after this, leaving room for in-flight ones. */
const TIME_BUDGET_MS = 200_000;
/** Calls scored at once. Each is one ~1-minute model request. */
const CONCURRENCY = 3;

type Json = Record<string, unknown>;

type ScorePendingOptions = {
  limit: number;
  minDuration: number;
  since: string | null;
  // null = all tenants (cron); set = only this tenant (manual button).
  tenantId: string | null;
};

/**
 * Vercel injects `Authorization: Bearer ${CRON_SECRET}` on scheduled
 * invocations when CRON_SECRET is set. Reject anything else so the cron URL
 * can't be abused to burn Anthropic credits.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

function clampLimit(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(1, Math.min(50, Math.floor(raw)))
    : 25;
}

function clampDuration(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(0, Math.floor(raw))
    : 60;
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  let body: Json = {};
  try {
    body = (await req.json().catch(() => ({}))) as Json;
  } catch {
    /* ignore */
  }
  return runScorePending(supabase, {
    limit: clampLimit(body.limit),
    minDuration: clampDuration(body.min_duration_seconds),
    since: typeof body.since === "string" ? body.since : null,
    tenantId: await resolveTenantId(),
  });
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Cron has no user session — use the admin client (service role).
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const limitParam = sp.get("limit");
  const minParam = sp.get("min_duration_seconds");
  return runScorePending(supabase, {
    limit: clampLimit(limitParam ? Number(limitParam) : undefined),
    minDuration: clampDuration(minParam ? Number(minParam) : undefined),
    since: sp.get("since"),
    tenantId: null,
  });
}

async function runScorePending(supabase: SupabaseClient, opts: ScorePendingOptions) {
  const started = Date.now();
  const { limit, minDuration, since, tenantId } = opts;

  // Find candidates: answered, not VM, duration >= min, has transcript, no score yet.
  let q = supabase
    .from("calls")
    .select(CALL_SCORING_COLUMNS)
    .eq("answered", true)
    .eq("voicemail", false)
    .gte("duration", minDuration)
    .not("transcription", "is", null)
    .order("start_time", { ascending: false })
    .limit(500); // overshoot then filter
  if (since) q = q.gte("start_time", since);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data: candidates, error } = await q;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (candidates ?? []).map((c) => (c as Json).id as string);
  let alreadyScored = new Set<string>();
  if (ids.length) {
    const { data: scored } = await supabase
      .from("call_scores")
      .select("call_id")
      .in("call_id", ids);
    alreadyScored = new Set((scored ?? []).map((r) => (r as Json).call_id as string));
  }

  const toScore = ((candidates ?? []) as Json[])
    .filter((c) => !alreadyScored.has(c.id as string))
    .slice(0, limit);

  const staffByTenant = new Map<string, SalesStaff[]>();
  async function staffFor(tid: string) {
    if (!staffByTenant.has(tid)) staffByTenant.set(tid, await loadSalesStaff(supabase, tid));
    return staffByTenant.get(tid)!;
  }

  const results: { id: string; ok: boolean; overall_score?: number; staff?: string | null; error?: string }[] = [];
  let next = 0;
  async function worker() {
    while (next < toScore.length && Date.now() - started < TIME_BUDGET_MS) {
      const call = toScore[next++];
      const tid = (typeof call.tenant_id === "string" ? call.tenant_id : tenantId) ?? DEFAULT_TENANT_ID;
      const out = await scoreAndSave({ supabase, tenantId: tid, call, staff: await staffFor(tid) });
      results.push(
        out.ok
          ? {
              id: call.id as string,
              ok: true,
              overall_score: out.result.overall_score,
              staff: out.attribution.staff?.full_name ?? null,
            }
          : { id: call.id as string, ok: false, error: out.error },
      );
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return NextResponse.json({
    candidates: candidates?.length ?? 0,
    skipped_already_scored: alreadyScored.size,
    scored: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    left_for_next_run: toScore.length - results.length,
    results,
  });
}
