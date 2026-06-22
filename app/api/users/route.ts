/**
 * GET /api/users  — list every active app_user (id, email).
 *
 * Authenticated-only (not admin-only) so any teammate can populate an "owner"
 * dropdown on shared records like the content pipeline. For admin actions
 * (invite, change role) use /api/admin/users instead.
 */

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_users")
    .select("user_id, email, role, status")
    .eq("tenant_id", await resolveTenantId())
    .eq("status", "active")
    .order("email", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Lightweight payload: drop the role-management fields the dropdown
  // doesn't need.
  const users = (data ?? []).map((u) => ({
    id: u.user_id as string,
    email: u.email as string,
  }));

  return NextResponse.json({ users });
}
