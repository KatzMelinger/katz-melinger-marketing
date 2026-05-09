/**
 * GET  /api/admin/users        — list every app_user (admin only)
 * POST /api/admin/users        — invite a new user
 *   body: { email: string, role?: "user" | "admin" }
 *
 * The invite uses Supabase Auth's admin.inviteUserByEmail, which creates the
 * auth row and sends a magic link the user clicks to set their password.
 * For the email to actually deliver, Supabase Auth → Email Templates must
 * have an "Invite user" template enabled (it is by default).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forbidden" },
      { status: 403 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_users")
    .select("user_id, email, role, status, invited_by, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forbidden" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const email = (body?.email as string | undefined)?.trim().toLowerCase();
  const role = (body?.role as string | undefined) === "admin" ? "admin" : "user";
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  // Send the invitation email via Supabase Auth admin API.
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
  if (inviteErr) {
    return NextResponse.json({ error: inviteErr.message }, { status: 400 });
  }

  const userId = invited.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Invite returned no user" }, { status: 500 });
  }

  // The on_auth_user_created trigger inserts an app_users row with role=user.
  // If the requested role is admin, upgrade it now.
  if (role === "admin") {
    await admin
      .from("app_users")
      .update({ role: "admin", updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  return NextResponse.json({ ok: true, user_id: userId });
}
