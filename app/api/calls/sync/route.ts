/**
 * Sync calls from CallRail (with detail fields: recording, transcription,
 * voicemail flag, agent email, etc.) into public.calls.
 *
 * POST /api/calls/sync — UI trigger ("Sync from CallRail" button).
 *   Body (optional): { since: "YYYY-MM-DD" } — only sync calls on/after this date.
 *
 * GET /api/calls/sync — Vercel Cron trigger. Requires
 *   `Authorization: Bearer ${CRON_SECRET}`. Reads ?since=YYYY-MM-DD from query.
 *   Registered in vercel.json (hourly) so the call log stays fresh without a
 *   human clicking the button — everything downstream (scoring, lead-response
 *   leakage) is only as current as the last sync.
 *
 * Returns: { synced, total, errors? }
 */

import { NextRequest, NextResponse } from "next/server";

import { fetchAllCallRailCallsDetailed } from "@/lib/callrail-fetch";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase-server";
import { DEFAULT_TENANT_ID, resolveTenantId } from "@/lib/tenant-context";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Json = Record<string, unknown>;

/**
 * Vercel injects `Authorization: Bearer ${CRON_SECRET}` on scheduled
 * invocations when CRON_SECRET is set. Reject anything else so the cron URL
 * can't be abused to burn CallRail quota.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

function detectLanguage(text: string | null | undefined): "en" | "es" | "mixed" | "unknown" {
  if (!text || text.trim().length < 30) return "unknown";
  const t = text.toLowerCase();
  // Crude heuristic: count common Spanish-only words vs English-only words.
  const es = (t.match(/\b(qué|cómo|gracias|hola|usted|trabajo|trabajaba|señor|señora|señorita|empleador|salario|hora|despidieron|despido|chamba|carro)\b/g) || []).length;
  const en = (t.match(/\b(the|and|you|your|with|that|have|will|this|from|been|were|are)\b/g) || []).length;
  if (es >= 3 && en < 5) return "es";
  if (es >= 3 && en >= 5) return "mixed";
  if (en >= 5) return "en";
  return "unknown";
}

async function runCallsSync(
  supabase: SupabaseClient,
  tenantId: string,
  since: string | undefined,
): Promise<NextResponse> {
  const apiKey = process.env.CALLRAIL_API_KEY;
  const accountId = process.env.CALLRAIL_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    return NextResponse.json({ error: "Missing CALLRAIL_API_KEY or CALLRAIL_ACCOUNT_ID" }, { status: 503 });
  }

  const result = await fetchAllCallRailCallsDetailed(apiKey, accountId, since);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  if (result.calls.length === 0) {
    return NextResponse.json({ synced: 0, total: 0 });
  }

  // Upsert in batches of 250 to keep payload size reasonable.
  let synced = 0;
  const errors: string[] = [];
  const BATCH = 250;
  for (let i = 0; i < result.calls.length; i += BATCH) {
    const slice = result.calls.slice(i, i + BATCH);
    const rows = slice.map((c) => {
      const valueNum =
        c.value == null ? null : typeof c.value === "number" ? c.value : Number(c.value);
      return {
        id: c.id,
        customer_name: c.customer_name ?? null,
        customer_phone_number: c.customer_phone_number ?? null,
        customer_city: c.customer_city ?? null,
        customer_state: c.customer_state ?? null,
        customer_country: c.customer_country ?? null,
        tracking_phone_number: c.tracking_phone_number ?? null,
        duration: c.duration ?? null,
        answered: c.answered === true,
        voicemail: c.voicemail === true,
        direction: c.direction ?? null,
        source_name: c.source_name ?? null,
        start_time: c.start_time ?? null,
        first_call: c.first_call === true,
        lead_status: c.lead_status ?? null,
        agent_email: c.agent_email ?? null,
        value: Number.isFinite(valueNum as number) ? valueNum : null,
        tags: Array.isArray(c.tags) ? c.tags : [],
        note: c.note ?? null,
        keywords: c.keywords ?? null,
        recording_url: c.recording ?? null,
        recording_player_url: c.recording_player ?? null,
        recording_duration: c.recording_duration ?? null,
        transcription: c.transcription ?? null,
        transcription_language: detectLanguage(c.transcription ?? null),
        raw: c as unknown as Json,
        synced_at: new Date().toISOString(),
        tenant_id: tenantId,
      };
    });

    const { error } = await supabase.from("calls").upsert(rows, { onConflict: "id" });
    if (error) {
      errors.push(error.message);
    } else {
      synced += rows.length;
    }
  }

  return NextResponse.json({ synced, total: result.calls.length, errors: errors.length ? errors : undefined });
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  let since: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as Json;
    if (typeof body.since === "string" && body.since.trim()) since = body.since.trim();
  } catch {
    // No body — that's fine.
  }
  return runCallsSync(supabase, await resolveTenantId(), since);
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseAdmin();
  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam && sinceParam.trim() ? sinceParam.trim() : undefined;
  // Cron has no user session — stamp the default tenant.
  return runCallsSync(supabase, DEFAULT_TENANT_ID, since);
}
