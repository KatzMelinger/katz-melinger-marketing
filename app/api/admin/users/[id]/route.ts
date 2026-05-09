/**
 * PATCH  /api/admin/users/[id]   — change role or status (admin only)
 *   body: { role?: "user" | "admin", status?: "active" | "disabled" }
 * DELETE /api/admin/users/[id]   — remove user from auth + app_users
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let me;
  try {
    me = await requireAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forbidden" },
      { status: 403 },
    );
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.role === "user" || body?.role === "admin") patch.role = body.role;
  if (body?.status === "active" || body?.status === "disabled") patch.status = body.status;

  // Safety: an admin can't demote or disable themselves — easy to lock yourself
  // out of the system otherwise.
  if (id === me.id && (patch.role === "user" || patch.status === "disabled")) {
    return NextResponse.json(
      { error: "You can't demote or disable yourself." },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("app_users")
    .update(patch)
    .eq("user_id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let me;
  try {
    me = await requireAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forbidden" },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (id === me.id) {
    return NextResponse.json({ error: "You can't delete yourself." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  // The app_users row is deleted by ON DELETE CASCADE when the auth.users row
  // goes away.
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
