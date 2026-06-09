/**
 * PATCH /api/admin/tenants/[id] — super-admin: update a firm's status or name.
 *   body: { status?: "active" | "suspended", name?: string }
 *
 * Suspending a firm is a soft action: it flips tenants.status. (Enforcing what
 * "suspended" blocks at request time is a follow-up; today it's a label the
 * super-admin console surfaces.)
 */

import { NextRequest, NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forbidden" },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid tenant id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    status?: unknown;
    name?: unknown;
  };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status === "active" || body.status === "suspended") {
    patch.status = body.status;
  }
  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
  }
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("tenants")
    .update(patch)
    .eq("id", id)
    .select("id, slug, name, status")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  return NextResponse.json({ ok: true, tenant: data });
}
