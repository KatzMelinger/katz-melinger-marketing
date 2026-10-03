/**
 * Sync calls from CallRail (with detail fields: recording, transcription,
 * voicemail flag, agent email, etc.) into public.calls.
 *
 * POST /api/calls/sync — UI trigger ("Sync from CallRail" button).
 *   Body (optional): { since: "YYYY-MM-DD" } — only sync calls on/after this date.
 *
 * GET /api/calls/sync — Vercel Cron trigger. Requires
 *   `Authorization: Bearer ${CRON_SECRET}`. Reads ?since=YYYY-MM-DD from query;
 *   without it the cron re-syncs only the last CRON_LOOKBACK_DAYS (7) days,
 *   which is enough to settle calls that were still in progress on the last
 *   run. A full-history resync is the POST without `since`.
 *   Registered in vercel.json (hourly) so the call log stays fresh without a
 *   human clicking the button — everything downstream (scoring, lead-response
 *   leakage) is only as current as the last sync.
 *
 * Returns: { synced, total, errors? }
 */

import { NextRequest, NextResponse } from "next/server";

import { fetchCallRailCallsDetailedPage } from "@/lib/callrail-fetch";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { DEFAULT_TENANT_ID, resolveTenantId } from "@/lib/tenant-context";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Json = Record<string, unknown>;

// CallRail can attach a transcript days after the call; re-syncing a week
// back picks those up so they become scoreable.
const CRON_LOOKBACK_DAYS = 7;

/**
 * Attribution columns added by supabase/calls_marketing_source.sql. Until that
 * SQL has been run the upsert would fail on them, so a "column not found"
 * error drops them and retries — the same values are in `raw`, which is what
 * /api/calls reads from anyway.
 */
const ATTRIBUTION_COLUMNS = [
  "marketing_source",
  "medium",
  "campaign",
  "landing_page_url",
  "referrer_domain",
  "call_type",
] as const;

function isMissingColumnError(message: string): boolean {
  return (
    ATTRIBUTION_COLUMNS.some((c) => message.includes(`'${c}'`) || message.includes(`"${c}"`)) &&
    /column|schema cache/i.test(message)
  );
}

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

/** Stop starting new pages after this long; leaves room under maxDuration (300s). */
const TIME_BUDGET_MS = 200_000;
/** 250 calls a page; the same 12,500-call ceiling the old fetch had. */
const MAX_PAGES = 50;

async function runCallsSync(
  supabase: SupabaseClient,
  tenantId: string,
  since: string | undefined,
  startPage = 1,
): Promise<NextResponse> {
  const apiKey = process.env.CALLRAIL_API_KEY;
  const accountId = process.env.CALLRAIL_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    return NextResponse.json({ error: "Missing CALLRAIL_API_KEY or CALLRAIL_ACCOUNT_ID" }, { status: 503 });
  }

  // Page by page, SAVING EACH PAGE before fetching the next, and stopping
  // well inside the function's time limit. The full history did not fit in
  // one request (504, nothing saved, 2026-10-01); now a run that stops early
  // returns { done: false, nextPage } and the button calls again from there.
  const started = Date.now();
  let synced = 0;
  let total = 0;
  let page = Math.max(1, startPage);
  let totalPages = page;
  const errors: string[] = [];
  let attributionColumns = true;
  while (page <= totalPages) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      return NextResponse.json({
        synced, total, since: since ?? null, attributionColumns,
        done: false, nextPage: page, totalPages,
        errors: errors.length ? errors : undefined,
      });
    }
    const result = await fetchCallRailCallsDetailedPage(apiKey, accountId, page, since);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, synced, nextPage: page }, { status: 502 });
    }
    totalPages = Math.min(result.totalPages, MAX_PAGES);
    total += result.calls.length;
    page += 1;
    if (result.calls.length === 0) continue;
    const slice = result.calls;
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
        marketing_source: c.source ?? null,
        medium: c.medium ?? null,
        campaign: c.campaign ?? null,
        landing_page_url: c.landing_page_url ?? null,
        referrer_domain: c.referrer_domain ?? null,
        call_type: c.call_type ?? null,
        raw: c as unknown as Json,
        synced_at: new Date().toISOString(),
        tenant_id: tenantId,
      };
    });

    let { error } = await supabase
      .from("calls")
      .upsert(attributionColumns ? rows : rows.map(withoutAttribution), { onConflict: "id" });
    if (error && attributionColumns && isMissingColumnError(error.message)) {
      // Migration not run yet: keep syncing into `raw` only.
      attributionColumns = false;
      ({ error } = await supabase.from("calls").upsert(rows.map(withoutAttribution), { onConflict: "id" }));
    }
    if (error) {
      errors.push(error.message);
    } else {
      synced += rows.length;
    }
  }

  return NextResponse.json({
    synced,
    total,
    since: since ?? null,
    attributionColumns,
    done: true,
    totalPages,
    errors: errors.length ? errors : undefined,
  });
}

function withoutAttribution<T extends Json>(row: T): Json {
  const copy: Json = { ...row };
  for (const c of ATTRIBUTION_COLUMNS) delete copy[c];
  return copy;
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  let since: string | undefined;
  let page = 1;
  try {
    const body = (await req.json().catch(() => ({}))) as Json;
    if (typeof body.since === "string" && body.since.trim()) since = body.since.trim();
    if (typeof body.page === "number" && Number.isFinite(body.page)) page = Math.max(1, Math.floor(body.page));
  } catch {
    // No body — that's fine.
  }
  return runCallsSync(supabase, await resolveTenantId(), since, page);
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  const sinceParam = req.nextUrl.searchParams.get("since");
  const since =
    sinceParam && sinceParam.trim()
      ? sinceParam.trim()
      : new Date(Date.now() - CRON_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Cron has no user session — stamp the default tenant.
  return runCallsSync(supabase, DEFAULT_TENANT_ID, since);
}
