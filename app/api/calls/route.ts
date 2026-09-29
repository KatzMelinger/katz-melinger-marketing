/**
 * GET /api/calls?from=YYYY-MM-DD&to=YYYY-MM-DD — list view for /calls.
 *
 * Reads from public.calls (synced via /api/calls/sync) for the firm-local date
 * range [from, to] (both inclusive; default = current month to date), paging
 * through it 1,000 rows at a time. Without paging PostgREST's 1,000-row cap
 * silently truncated the log, and every stat card with it.
 *
 * Marketing attribution (source, medium, campaign, call_type, ...) is read out
 * of `raw` rather than from the dedicated columns, so this works both before
 * and after supabase/calls_marketing_source.sql is run.
 *
 * Joins the most recent score per call. Falls back to live CallRail metadata
 * if the local table is empty (so the UI works on first load before the first
 * sync).
 */
import { NextRequest, NextResponse } from "next/server";

import { fetchAllCallRailCalls } from "@/lib/callrail-fetch";
import {
  firmLocalDayEndExclusiveUTC,
  firmLocalDayStartUTC,
  isIsoDate,
  monthToDate,
} from "@/lib/calls-stats";
import { loadPaged } from "@/lib/rank-history";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;

const CALL_COLUMNS = [
  "id",
  "customer_name",
  "customer_phone_number",
  "duration",
  "answered",
  "voicemail",
  "direction",
  "source_name",
  "start_time",
  "first_call",
  "lead_status",
  "agent_email",
  "transcription_language",
  // JSON-path selects: present for every synced row, migration or not.
  "marketing_source:raw->>source",
  "medium:raw->>medium",
  "campaign:raw->>campaign",
  "landing_page_url:raw->>landing_page_url",
  "referrer_domain:raw->>referrer_domain",
  "call_type:raw->>call_type",
].join(",");

/** ids per `.in()` — keeps the call_scores URL well under request-line limits. */
const SCORE_ID_CHUNK = 200;

export async function GET(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;

  const defaults = monthToDate(Date.now());
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const from = isIsoDate(fromParam) ? fromParam : defaults.from;
  const to = isIsoDate(toParam) ? toParam : defaults.to;
  const startUTC = firmLocalDayStartUTC(from);
  const endUTC = firmLocalDayEndExclusiveUTC(to);

  const supabase = getSupabaseServer();
  if (supabase) {
    const tid = await resolveTenantId();
    let calls: Json[] = [];
    let readError: string | null = null;
    try {
      calls = await loadPaged<Json>(async (lo, hi) => {
        const { data, error } = await supabase
          .from("calls")
          .select(CALL_COLUMNS)
          .eq("tenant_id", tid)
          .gte("start_time", startUTC)
          .lt("start_time", endUTC)
          .order("start_time", { ascending: false })
          .order("id", { ascending: true })
          .range(lo, hi);
        return { rows: (data ?? []) as unknown as Json[], error: error?.message ?? null };
      });
    } catch (e) {
      readError = e instanceof Error ? e.message : String(e);
    }

    if (!readError) {
      // An empty range is a real answer once the table has anything in it; only
      // fall back to live CallRail when the table has never been synced.
      let tableHasRows = calls.length > 0;
      if (!tableHasRows) {
        const { count } = await supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tid);
        tableHasRows = (count ?? 0) > 0;
      }
      if (tableHasRows) {
        const latest = new Map<string, Json>();
        try {
          const ids = calls.map((c) => c.id as string);
          for (let i = 0; i < ids.length; i += SCORE_ID_CHUNK) {
            const chunk = ids.slice(i, i + SCORE_ID_CHUNK);
            const scores = await loadPaged<Json>(async (lo, hi) => {
              const { data, error } = await supabase
                .from("call_scores")
                .select("call_id, overall_score, rubric_type, language, scored_at")
                .eq("tenant_id", tid)
                .in("call_id", chunk)
                .order("scored_at", { ascending: false })
                .range(lo, hi);
              return { rows: (data ?? []) as Json[], error: error?.message ?? null };
            });
            // Most recent score per call_id (rows arrive newest first).
            for (const s of scores) {
              const cid = s.call_id as string;
              if (!latest.has(cid)) latest.set(cid, s);
            }
          }
        } catch (e) {
          console.error("[calls] call_scores read failed:", e instanceof Error ? e.message : e);
        }
        const enriched = calls.map((c) => ({ ...c, score: latest.get(c.id as string) ?? null }));
        return NextResponse.json({ calls: enriched, source: "supabase", from, to });
      }
    } else {
      // Fall through to CallRail fallback
      console.error("[calls] supabase read failed:", readError);
    }
  }

  // Fallback: pull live from CallRail (no transcripts, no scores)
  const apiKey = process.env.CALLRAIL_API_KEY;
  const accountId = process.env.CALLRAIL_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    return NextResponse.json({ calls: [], error: "Missing CALLRAIL_API_KEY or CALLRAIL_ACCOUNT_ID" });
  }
  const result = await fetchAllCallRailCalls(apiKey, accountId);
  if (!result.ok) {
    return NextResponse.json({ calls: [], error: result.error });
  }
  const lo = new Date(startUTC).getTime();
  const hi = new Date(endUTC).getTime();
  return NextResponse.json({
    calls: result.calls
      .filter((c) => {
        const t = new Date(c.start_time).getTime();
        return t >= lo && t < hi;
      })
      .map((c) => ({ ...c, marketing_source: c.source ?? null, score: null })),
    source: "callrail-live",
    from,
    to,
    hint: "Run POST /api/calls/sync to persist + enable AI scoring.",
  });
}
