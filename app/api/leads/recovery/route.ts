/**
 * Recovery worklist status for lost leads.
 *
 * GET  /api/leads/recovery — all recovery rows for the current tenant, keyed by
 *   normalized phone, so the lead-response page can overlay follow-up status on
 *   the lost-lead list.
 * POST /api/leads/recovery — upsert one lead's follow-up status.
 *   Body: { phone, status?, notes?, assigned_to?, first_lost_at? }
 */

import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/lead-response";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["new", "called_back", "reached", "dead"]);
type Json = Record<string, unknown>;

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ rows: [] });
  const tid = await resolveTenantId();
  const { data, error } = await supabase
    .from("lead_recovery")
    .select("phone, status, assigned_to, notes, first_lost_at, last_action_at, updated_at")
    .eq("tenant_id", tid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  const tid = await resolveTenantId();

  let body: Json = {};
  try {
    body = (await req.json()) as Json;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const phone = normalizePhone(typeof body.phone === "string" ? body.phone : null);
  if (!phone) return NextResponse.json({ error: "Valid phone required" }, { status: 400 });

  const status = typeof body.status === "string" && STATUSES.has(body.status) ? body.status : undefined;
  const notes = typeof body.notes === "string" ? body.notes : undefined;
  const assignedTo = typeof body.assigned_to === "string" ? body.assigned_to : undefined;
  const firstLostAt = typeof body.first_lost_at === "string" ? body.first_lost_at : undefined;

  const row: Json = {
    tenant_id: tid,
    phone,
    last_action_at: new Date().toISOString(),
  };
  if (status !== undefined) row.status = status;
  if (notes !== undefined) row.notes = notes;
  if (assignedTo !== undefined) row.assigned_to = assignedTo;
  if (firstLostAt !== undefined) row.first_lost_at = firstLostAt;

  const { data, error } = await supabase
    .from("lead_recovery")
    .upsert(row, { onConflict: "tenant_id,phone" })
    .select("phone, status, assigned_to, notes, first_lost_at, last_action_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}
