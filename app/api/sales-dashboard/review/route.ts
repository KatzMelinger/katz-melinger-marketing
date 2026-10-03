/**
 * Review page for leads signed before the hourly snapshot existed, whose
 * pre-signing Legal Assistant # 1 / Attorney/Reviewer Airtable has already
 * overwritten (lib/sales-dashboard/credit.ts).
 *
 * GET  — signed leads with no snapshot row, each with the staff initials from
 *        its Follow-Up Notes (before signing) and the intake guess.
 * POST — { airtable_id, intake_staff_id, sales_staff_id } (either may be null
 *        for "nobody") saves a manual row the snapshot cron never overwrites.
 * Admins only.
 */
import { NextResponse } from "next/server";

import { intakeGuessFromNotes, noteAuthorsBeforeSigning } from "@/lib/sales-dashboard/credit";
import { listDashboardIntakes, outcomeOf } from "@/lib/sales-dashboard/intakes";
import { loadSalesStaff } from "@/lib/sales-staff";
import { requireAdmin } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

async function admin() {
  try {
    return { user: await requireAdmin(), denied: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unauthorized";
    return {
      user: null,
      denied: NextResponse.json({ error: message }, { status: message.startsWith("Forbidden") ? 403 : 401 }),
    };
  }
}

export async function GET() {
  const { denied } = await admin();
  if (denied) return denied;
  const supabase = getSupabaseAdmin();
  const tenantId = await resolveTenantId();
  try {
    const [leads, staff, snaps] = await Promise.all([
      listDashboardIntakes(),
      loadSalesStaff(supabase, tenantId),
      supabase.from("intake_staff_snapshots").select("airtable_id").eq("tenant_id", tenantId),
    ]);
    if (snaps.error) throw new Error(snaps.error.message);
    const done = new Set((snaps.data ?? []).map((r) => r.airtable_id as string));
    const signed = leads.filter((l) => outcomeOf(l.status) === "signed");
    const todo = signed
      .filter((l) => !done.has(l.id))
      .sort((a, b) => (b.retainedAt ?? "").localeCompare(a.retainedAt ?? ""))
      .map((l) => ({
        id: l.id,
        name: l.name,
        created: l.createdAt.slice(0, 10),
        retained: l.retainedAt?.slice(0, 10) ?? null,
        category: l.category,
        quality: l.quality,
        had_sales_call: l.hadSalesCall,
        note_authors: noteAuthorsBeforeSigning(l, staff).map((s) => s.initials),
        intake_guess: intakeGuessFromNotes(l, staff)?.id ?? null,
      }));
    return NextResponse.json({
      signed: signed.length,
      reviewed: signed.length - todo.length,
      todo,
      staff: staff.map((s) => ({ id: s.id, name: s.full_name, initials: s.initials, roles: s.roles })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, denied } = await admin();
  if (denied) return denied;
  const supabase = getSupabaseAdmin();
  const tenantId = await resolveTenantId();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const airtableId = typeof body.airtable_id === "string" ? body.airtable_id : "";
  if (!/^rec[A-Za-z0-9]{14}$/.test(airtableId)) {
    return NextResponse.json({ error: "airtable_id required" }, { status: 400 });
  }

  const staff = await loadSalesStaff(supabase, tenantId);
  const pick = (v: unknown) => (typeof v === "string" && v ? staff.find((s) => s.id === v) : null);
  const intake = pick(body.intake_staff_id);
  const sales = pick(body.sales_staff_id);
  if ((body.intake_staff_id && !intake) || (body.sales_staff_id && !sales)) {
    return NextResponse.json({ error: "unknown staff member" }, { status: 400 });
  }

  const { error } = await supabase.from("intake_staff_snapshots").upsert(
    {
      tenant_id: tenantId,
      airtable_id: airtableId,
      legal_assistant: intake?.full_name ?? null,
      reviewer: sales?.full_name ?? null,
      source: "manual",
      confirmed_by: user!.email,
      observed_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,airtable_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
