/**
 * GET /api/content/drafts/[id]/readiness
 *
 * The Ready checklist for one draft (Oct 20 spec, Task A4): the same isReady()
 * result the Approve route enforces and the Production Board reads. RLS-scoped
 * read, so another tenant's draft is not found.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import { readinessForDraft } from "@/lib/draft-readiness-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenantId } = await getTenantClient();
  const { data: d, error } = await supabase
    .from("content_drafts")
    .select("id, body, title, topic, format, practice_area, metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const readiness = await readinessForDraft(tenantId, {
    id,
    body: (d.body as string | null) ?? "",
    title: (d.title as string | null) ?? null,
    topic: (d.topic as string | null) ?? null,
    format: (d.format as string | null) ?? null,
    practice_area: (d.practice_area as string | null) ?? null,
    metadata: (d.metadata as Record<string, unknown> | null) ?? null,
  });
  return NextResponse.json({ readiness });
}
