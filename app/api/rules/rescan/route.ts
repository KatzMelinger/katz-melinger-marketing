/**
 * "Rescan all open drafts" (Oct 6 spec, Task 24): after a rule changes, run
 * the Task 23 fixer (lib/auto-fix-draft.ts, the same code as "Fix known
 * errors") on every open draft and list the drafts it changed.
 *
 * GET  /api/rules/rescan                 → { drafts: [{ id, title }] } the open drafts
 * POST /api/rules/rescan { draftIds }    → { results } for up to BATCH drafts
 *
 * The page sends the drafts a few at a time, so a long rescan never hits the
 * request time limit and shows progress as it goes. Each changed draft is
 * re-analyzed afterwards, as the button does. Open = a web page format, not
 * archived and not published (fixDraft skips the rest anyway).
 */
import { NextRequest, NextResponse } from "next/server";

import { scheduleDraftAnalysis } from "@/lib/auto-analyze";
import { fixDraft } from "@/lib/auto-fix-draft";
import { hasWebPage } from "@/lib/draft-metadata";
import { clearKnowledgeBaseCache } from "@/lib/legal-knowledge-base";
import { getCurrentUser } from "@/lib/supabase-route";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 4;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const tenantId = await resolveTenantId();
  const { data, error } = await getSupabaseAdmin()
    .from("content_drafts")
    .select("id, title, topic, format, status")
    .eq("tenant_id", tenantId)
    .not("status", "in", "(archived,published)")
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const drafts = (data ?? [])
    .filter((d) => hasWebPage(((d.format as string | null) ?? "").trim()))
    .map((d) => ({ id: d.id as string, title: (d.title as string | null)?.trim() || (d.topic as string | null)?.trim() || "Untitled" }));
  return NextResponse.json({ drafts });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const tenantId = await resolveTenantId();
  const b = (await req.json().catch(() => ({}))) as { draftIds?: unknown };
  const ids = Array.isArray(b.draftIds) ? b.draftIds.filter((x): x is string => typeof x === "string").slice(0, BATCH) : [];
  if (ids.length === 0) return NextResponse.json({ error: "draftIds required" }, { status: 400 });

  // A rule approved a moment ago must apply now, not after the cache expires.
  clearKnowledgeBaseCache();

  const results = await Promise.all(
    ids.map(async (draftId) => {
      try {
        const out = await fixDraft({ draftId, tenantId, actor: { id: user.id, email: user.email } });
        if (out.changes > 0 && out.result) {
          scheduleDraftAnalysis({ draftId, body: out.result.body, title: out.result.title });
        }
        return {
          draftId,
          title: out.title,
          skipped: out.skipped ?? null,
          changes: (out.result?.changes ?? []).map((c) => ({ from: c.from, to: c.to, reason: c.reason, source: c.source })),
          attorneyReview: out.attorneyReview,
        };
      } catch (e) {
        return { draftId, title: null, error: e instanceof Error ? e.message : String(e), changes: [], attorneyReview: [] };
      }
    }),
  );
  return NextResponse.json({ results });
}
