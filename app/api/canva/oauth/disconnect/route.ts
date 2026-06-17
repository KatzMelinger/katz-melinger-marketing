/**
 * POST /api/canva/oauth/disconnect
 *
 * Removes the stored Canva tokens for the current tenant. The integration
 * drops back to "Needs OAuth" until reconnected.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { disconnectCanva } from "@/lib/canva-server";

export const dynamic = "force-dynamic";

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    await disconnectCanva();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Disconnect failed";
    return NextResponse.json({ error }, { status: 500 });
  }
}
