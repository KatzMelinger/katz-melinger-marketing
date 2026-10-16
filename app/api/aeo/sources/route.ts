/**
 * GET /api/aeo/sources — the off-site gap list (Oct 6 spec, Task 19;
 * lib/aeo-sources.ts): sources the latest AEO sweep's answers cite, each with
 * "firm present" or "firm absent" and the competitors it names.
 */
import { NextResponse } from "next/server";

import { offSiteSources } from "@/lib/aeo-sources";
import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    return NextResponse.json(await offSiteSources(await resolveTenantId()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
