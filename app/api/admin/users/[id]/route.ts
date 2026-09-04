/**
 * PATCH  /api/admin/users/[id]   — change role or status (admin only)
 *   body: { role?: "user" | "admin", status?: "active" | "disabled" }
 * POST   /api/admin/users/[id]   — re-send an access email (admin only)
 *   body: { action: "invite" | "reset" }
 *     "invite" — resend the original invitation (for users who never accepted)
 *     "reset"  — send a password-recovery email (for users who are locked out)
 * DELETE /api/admin/users/[id]   — remove user from auth + app_users
 *
 * EVERY handler here scopes the target to the caller's own tenant.
 * requireAdmin() proves the caller is an admin, but "admin" is a PER-TENANT
 * role — it carries no claim about which firm the [id] in the URL belongs to —
 * and these handlers use the service-role client, which bypasses RLS. Without
 * the tenant filter an admin at one firm could promote, disable, mail or
 * outright delete a user at another firm just by knowing their id, which the
 * unscoped GET /api/admin/users handed out. A target outside the caller's
 * tenant gets the same 404 a genuinely missing user gets, so these endpoints
 * don't confirm that an id exists somewhere else.
 *
 * Cross-tenant user administration is the super-admin console's job
 * (/api/admin/tenants, gated by requireSuperAdmin) — not this one.
 */

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

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

  const tenantId = await resolveTenantId();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("app_users")
    .update(patch)
    .eq("user_id", id)
    .eq("tenant_id", tenantId)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forbidden" },
      { status: 403 },
    );
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (action !== "invite" && action !== "reset") {
    return NextResponse.json(
      { error: 'action must be "invite" or "reset"' },
      { status: 400 },
    );
  }

  const tenantId = await resolveTenantId();
  const admin = getSupabaseAdmin();
  // Resolve the user's email from app_users (id is the auth user_id), scoped to
  // the caller's firm — otherwise this mails an invite or a password-reset link
  // to a user at another firm on demand.
  const { data: row, error: lookupErr } = await admin
    .from("app_users")
    .select("email")
    .eq("user_id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  const email = row?.email as string | undefined;
  if (!email) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (action === "invite") {
    // Re-send the invitation. inviteUserByEmail errors if the account already
    // exists and is confirmed — point the admin at the reset action instead.
    const { error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error) {
      return NextResponse.json(
        {
          error: `Could not resend invite: ${error.message}. If they already have an account, use "Send reset" instead.`,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, message: `Invitation re-sent to ${email}.` });
  }

  // action === "reset": send a password-recovery email. resetPasswordForEmail
  // is a public-client method, so use the anon key (the same one the browser
  // login uses). Supabase delivers the email via its configured templates.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json(
      { error: "Password reset unavailable: NEXT_PUBLIC_SUPABASE_ANON_KEY is not set." },
      { status: 500 },
    );
  }
  const publicClient = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await publicClient.auth.resetPasswordForEmail(email);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: `Password reset email sent to ${email}.` });
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

  const tenantId = await resolveTenantId();
  const admin = getSupabaseAdmin();

  // Confirm the target is a user of the caller's own firm BEFORE deleting.
  // deleteUser() takes a raw auth.users id and answers to no tenant — without
  // this lookup the handler destroyed any account in the database, in any
  // firm, given only its id.
  const { data: target, error: lookupErr } = await admin
    .from("app_users")
    .select("user_id")
    .eq("user_id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // The app_users row is deleted by ON DELETE CASCADE when the auth.users row
  // goes away.
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
