/**
 * GET /api/calls — list view for the /calls dashboard.
 *
 * Reads from public.calls (synced via /api/calls/sync). Joins the most
 * recent score per call. Falls back to live CallRail metadata if the local
 * table is empty (so the UI works on first load before the first sync).
 */
import { NextResponse } from "next/server";

import { fetchAllCallRailCalls } from "@/lib/callrail-fetch";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (supabase) {
    const tid = await resolveTenantId();
    const { data: calls, error } = await supabase
      .from("calls")
      .select(
        "id,customer_name,customer_phone_number,duration,answered,voicemail,direction,source_name,start_time,first_call,lead_status,agent_email,transcription_language",
      )
      .eq("tenant_id", tid)
      .order("start_time", { ascending: false })
      .limit(2000);
    if (!error && calls && calls.length > 0) {
      const ids = (calls as Json[]).map((c) => c.id as string);
      const { data: scores } = await supabase
        .from("call_scores")
        .select("call_id, overall_score, rubric_type, language, scored_at")
        .eq("tenant_id", tid)
        .in("call_id", ids)
        .order("scored_at", { ascending: false });
      // Take the most recent score per call_id
      const latest = new Map<string, Json>();
      for (const s of (scores ?? []) as Json[]) {
        const cid = s.call_id as string;
        if (!latest.has(cid)) latest.set(cid, s);
      }
      const enriched = (calls as Json[]).map((c) => ({
        ...c,
        score: latest.get(c.id as string) ?? null,
      }));
      return NextResponse.json({ calls: enriched, source: "supabase" });
    }
    if (error) {
      // Fall through to CallRail fallback
      console.error("[calls] supabase read failed:", error.message);
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
  return NextResponse.json({
    calls: result.calls.map((c) => ({ ...c, score: null })),
    source: "callrail-live",
    hint: "Run POST /api/calls/sync to persist + enable AI scoring.",
  });
}
