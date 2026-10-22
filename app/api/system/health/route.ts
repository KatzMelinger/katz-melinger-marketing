/**
 * GET /api/system/health   System health (Oct 20 spec, Task A17): every
 * background job's last success, last error, next run and problem, plus this
 * month's AI and data cost by meter and by draft.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";
import { systemHealth } from "@/lib/system-health";
import { costSummary } from "@/lib/ai-cost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { tenantId, supabase } = await getTenantClient();
  const [health, cost] = await Promise.all([systemHealth(tenantId), costSummary(tenantId).catch(() => null)]);
  // Titles for the costliest drafts.
  const ids = cost?.topDrafts.map((d) => d.draftId) ?? [];
  const titles: Record<string, string> = {};
  if (ids.length) {
    const { data } = await supabase.from("content_drafts").select("id, title").in("id", ids);
    for (const d of data ?? []) titles[d.id as string] = (d.title as string | null) ?? "(untitled)";
  }
  return NextResponse.json({ ...health, cost, titles });
}
