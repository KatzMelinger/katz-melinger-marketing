/**
 * POST /api/seo/technical/autopilot-fixes/retry
 *   body: { id: string }
 *
 * Re-queues a failed / needs_manual fix by flipping it back to 'approved' so
 * the WP plugin re-attempts it on the next sync. Session-authed + tenant-scoped.
 */

import { NextRequest, NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import { retryRecommendation } from "@/lib/wp-autopilot";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    const tenantId = await resolveTenantId();
    const item = await retryRecommendation({ tenantId, id });
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "retry failed";
    const status = /not found|status=/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
