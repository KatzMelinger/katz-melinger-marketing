/**
 * Sync CallRail form submissions into public.forms so web-form leads are
 * persisted alongside calls (previously they were fetched live and discarded).
 *
 * POST /api/forms/sync — UI trigger ("Sync from CallRail" button).
 * GET  /api/forms/sync — Vercel Cron trigger. Requires
 *   `Authorization: Bearer ${CRON_SECRET}`. Registered in vercel.json.
 *
 * Returns: { synced, total, errors? }
 */

import { NextRequest, NextResponse } from "next/server";

import { fetchAllFormSubmissions } from "@/lib/callrail-forms";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase-server";
import { DEFAULT_TENANT_ID, resolveTenantId } from "@/lib/tenant-context";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Json = Record<string, unknown>;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

async function runFormsSync(supabase: SupabaseClient, tenantId: string): Promise<NextResponse> {
  const apiKey = process.env.CALLRAIL_API_KEY;
  const accountId = process.env.CALLRAIL_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    return NextResponse.json({ error: "Missing CALLRAIL_API_KEY or CALLRAIL_ACCOUNT_ID" }, { status: 503 });
  }

  const result = await fetchAllFormSubmissions(apiKey, accountId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  if (result.submissions.length === 0) {
    return NextResponse.json({ synced: 0, total: 0 });
  }

  let synced = 0;
  const errors: string[] = [];
  const BATCH = 250;
  for (let i = 0; i < result.submissions.length; i += BATCH) {
    const slice = result.submissions.slice(i, i + BATCH);
    const rows = slice.map((f) => ({
      id: f.id,
      form_name: f.form_name ?? null,
      customer_name: f.customer_name ?? null,
      customer_phone_number: f.customer_phone_number ?? null,
      customer_email: f.customer_email ?? null,
      source: f.source ?? null,
      source_name: f.source_name ?? null,
      submitted_at: f.submitted_at ?? null,
      lead_status: f.lead_status ?? null,
      raw: f as unknown as Json,
      synced_at: new Date().toISOString(),
      tenant_id: tenantId,
    }));

    const { error } = await supabase.from("forms").upsert(rows, { onConflict: "id" });
    if (error) {
      errors.push(error.message);
    } else {
      synced += rows.length;
    }
  }

  return NextResponse.json({ synced, total: result.submissions.length, errors: errors.length ? errors : undefined });
}

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  return runFormsSync(supabase, await resolveTenantId());
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runFormsSync(getSupabaseAdmin(), DEFAULT_TENANT_ID);
}
