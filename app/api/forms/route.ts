/**
 * GET /api/forms — persisted form submissions from public.forms for the
 * current tenant. Falls back to a live CallRail fetch (with a hint to run a
 * sync) when the table is empty, mirroring /api/calls behavior so the page
 * works before the first sync.
 */

import { NextResponse } from "next/server";

import { fetchAllFormSubmissions } from "@/lib/callrail-forms";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseServer();
  if (supabase) {
    const tid = await resolveTenantId();
    const { data, error } = await supabase
      .from("forms")
      .select(
        "id, form_name, customer_name, customer_phone_number, customer_email, source, source_name, submitted_at, lead_status",
      )
      .eq("tenant_id", tid)
      .order("submitted_at", { ascending: false })
      .limit(2000);
    if (!error && data && data.length > 0) {
      return NextResponse.json({ submissions: data, source: "supabase" });
    }
  }

  // Empty table (or no Supabase) — fall back to live CallRail so the page isn't blank.
  const apiKey = process.env.CALLRAIL_API_KEY;
  const accountId = process.env.CALLRAIL_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    return NextResponse.json({ submissions: [], error: "Missing CALLRAIL_API_KEY or CALLRAIL_ACCOUNT_ID" });
  }
  const result = await fetchAllFormSubmissions(apiKey, accountId);
  if (!result.ok) {
    return NextResponse.json({ submissions: [], error: result.error });
  }
  return NextResponse.json({
    submissions: result.submissions,
    source: "callrail-live",
    hint: "Showing live CallRail data. Click “Sync from CallRail” to persist these submissions.",
  });
}
