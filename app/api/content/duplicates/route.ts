/**
 * GET /api/content/duplicates
 *
 * System-wide duplicate count for the Overview "Issues to fix" alert. Delegates
 * to countContentDuplicates() — scans WITHIN each content table and groups by the
 * registry semantic key, so "labor attorney ny" and "ny labor attorney" count as
 * one target. Read-only, tenant-scoped, fail-soft.
 */

import { NextResponse } from "next/server";

import { countContentDuplicates, listContentDuplicates } from "@/lib/content-dedup";
import { guardUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  // ?detail=1 returns the GROUPS with their members and a suggested keeper —
  // what the cleanup view needs (item 20). Without it, the counts the Overview
  // alert has always read, which is a much smaller payload and is fetched on
  // every dashboard load.
  const detail = new URL(req.url).searchParams.get("detail") === "1";
  try {
    const { tenantId } = await getTenantClient();
    if (detail) {
      return NextResponse.json({ groups: await listContentDuplicates(tenantId) });
    }
    return NextResponse.json(await countContentDuplicates(tenantId));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to scan duplicates", groups: null },
      { status: 200 },
    );
  }
}
