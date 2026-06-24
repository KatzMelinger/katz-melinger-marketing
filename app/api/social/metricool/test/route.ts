import { NextResponse } from "next/server";

import { getBrandProfiles } from "@/lib/metricool";
import { guardUser } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

/**
 * Single-call credential check against Metricool using /admin/simpleProfiles.
 */
export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    const body = await getBrandProfiles();
    return NextResponse.json({
      ok: true,
      path: "/admin/simpleProfiles",
      body,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        path: "/admin/simpleProfiles",
        error: message,
      },
      { status: 500 },
    );
  }
}
