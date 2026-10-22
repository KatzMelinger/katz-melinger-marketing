/**
 * GET  /api/legal/kb-impact?key=...   every live page that cites the entry
 * POST /api/legal/kb-impact { key }   open a refresh draft for each (attorneys and Admins)
 *
 * Oct 20 spec, Task A15. Approving a knowledge base change on /content/rules
 * does the POST by itself; this is for looking first, or doing it again.
 */
import { after, NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import { canClearLegalHold } from "@/lib/legal-reviewers";
import { affectedPages, openRefreshDrafts } from "@/lib/live-page-scan";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const key = req.nextUrl.searchParams.get("key")?.trim();
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  return NextResponse.json({ key, pages: await affectedPages(await resolveTenantId(), key) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && !canClearLegalHold(user.email)) {
    return NextResponse.json({ error: "Only an attorney or an Admin can open refresh drafts for a knowledge base change." }, { status: 403 });
  }
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  if (!key?.trim()) return NextResponse.json({ error: "key required" }, { status: 400 });
  const tenantId = await resolveTenantId();
  const pages = await affectedPages(tenantId, key.trim());
  const origin = new URL(req.url).origin;
  after(() =>
    openRefreshDrafts({
      tenantId,
      kbKey: key.trim(),
      reason: `manual:${new Date().toISOString().slice(0, 10)}`,
      origin,
      note: `Knowledge base entry ${key.trim()} changed; refreshed at ${user.email}'s request (Task A15).`,
    }).catch((e) => console.warn("[kb-impact] refresh failed:", e)),
  );
  return NextResponse.json({ ok: true, pages: pages.length });
}
