/**
 * GET /api/auth/me
 *
 * Returns the current logged-in user's id, email, and role. Used by the
 * sidebar to render the user menu. Returns 401 when no session.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase-route";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user });
}
