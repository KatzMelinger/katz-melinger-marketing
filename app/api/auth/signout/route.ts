/**
 * POST /api/auth/signout
 *
 * Clears the Supabase auth cookie on the server side then redirects to
 * /login. Idempotent: signing out when already signed out just bounces to
 * /login.
 */

import { NextResponse } from "next/server";
import { getSupabaseRouteClient } from "@/lib/supabase-route";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await getSupabaseRouteClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
