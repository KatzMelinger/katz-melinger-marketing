/**
 * POST /api/content/drafts/[id]/improve
 *
 * Improve to Ready (Oct 20 spec, Task A9): the "Improve to Ready" button, and
 * the automatic run after a new draft, refresh or Redraft (called with the
 * CRON_SECRET bearer, lib/improve-trigger.ts). Up to three passes of analyze,
 * plan, improve and re-check; returns the Improvement summary.
 */
import { after, NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getCurrentUser } from "@/lib/supabase-route";
import { improveToReady } from "@/lib/improve-to-ready";
import { overBudget } from "@/lib/ai-cost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isCron(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET?.trim();
  return !!s && req.headers.get("authorization") === `Bearer ${s}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let tenantId: string;
  let actor: { id: string | null; email: string | null } = { id: null, email: "Improve to Ready (automatic)" };
  if (isCron(req)) {
    const { data } = await getSupabaseAdmin().from("content_drafts").select("tenant_id").eq("id", id).maybeSingle();
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // The automatic run answers at once and works in after(), so the request
    // that started it is never kept waiting.
    const tid = data.tenant_id as string;
    // Task A17: over the monthly AI budget, automatic runs pause (the button
    // still works); the watchdog emails Kenneth.
    if (await overBudget(tid)) return NextResponse.json({ skipped: "over the monthly AI budget" }, { status: 202 });
    after(async () => {
      try {
        await improveToReady({ tenantId: tid, draftId: id, actor });
      } catch (e) {
        console.warn("[improve] automatic run failed:", e instanceof Error ? e.message : e);
      }
    });
    return NextResponse.json({ started: true }, { status: 202 });
  } else {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const t = await getTenantClient();
    const { data } = await t.supabase.from("content_drafts").select("id").eq("id", id).maybeSingle();
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    tenantId = t.tenantId;
    actor = { id: user.id, email: user.email ?? null };
  }
  try {
    const record = await improveToReady({ tenantId, draftId: id, actor });
    return NextResponse.json({ improvement: record });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
