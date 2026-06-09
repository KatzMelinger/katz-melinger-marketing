/**
 * Super-admin tenant console (platform operator only — SUPER_ADMIN_EMAILS).
 *
 * GET  /api/admin/tenants   — list every firm with user counts + status.
 * POST /api/admin/tenants   — manually provision a firm + its first admin.
 *     body: { firmName, email, password }
 *
 * Gated by requireSuperAdmin(); uses the service-role client (which bypasses
 * RLS) to read/operate across all tenants. No DB-level RLS bypass exists — the
 * cross-tenant capability lives entirely behind this app-layer check.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { provisionTenant, ProvisionError } from "@/lib/tenant-provision";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forbidden" },
      { status: 403 },
    );
  }

  const admin = getSupabaseAdmin();
  const [{ data: tenants, error: tErr }, { data: users, error: uErr }] =
    await Promise.all([
      admin
        .from("tenants")
        .select("id, slug, name, status, primary_domain, created_at")
        .order("created_at", { ascending: false }),
      admin.from("app_users").select("tenant_id, role"),
    ]);
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  // Aggregate user + admin counts per tenant in one pass.
  const counts = new Map<string, { users: number; admins: number }>();
  for (const u of users ?? []) {
    const tid = u.tenant_id as string | null;
    if (!tid) continue;
    const c = counts.get(tid) ?? { users: 0, admins: 0 };
    c.users += 1;
    if (u.role === "admin") c.admins += 1;
    counts.set(tid, c);
  }

  const rows = (tenants ?? []).map((t) => ({
    ...t,
    user_count: counts.get(t.id as string)?.users ?? 0,
    admin_count: counts.get(t.id as string)?.admins ?? 0,
  }));

  return NextResponse.json({ tenants: rows });
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forbidden" },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    firmName?: unknown;
    email?: unknown;
    password?: unknown;
  };

  try {
    const result = await provisionTenant({
      firmName: typeof body.firmName === "string" ? body.firmName : "",
      adminEmail: typeof body.email === "string" ? body.email : "",
      adminPassword: typeof body.password === "string" ? body.password : "",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ProvisionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 },
    );
  }
}
