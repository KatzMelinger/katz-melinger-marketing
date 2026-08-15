/**
 * POST /api/content/drafts/[id]/analyze
 *   body: { targetKeywords?: string[] }
 *
 * Runs readability, keyword density, AEO scoring, and brand-voice match.
 * Persists the result and returns it.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import { analyzeDraft } from "@/lib/content-analysis";
import { getReadabilityConfig } from "@/lib/readability-config-store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const targetKeywords = Array.isArray(body?.targetKeywords)
    ? (body.targetKeywords as string[])
    : [];

  const { supabase, tenantId } = await getTenantClient();
  const { data: draft, error } = await supabase
    .from("content_drafts")
    .select("body, seo_brief, title, topic, format, template, practice_area")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Pull keywords from the draft's stored brief if caller didn't override.
  const fromBrief = (draft.seo_brief as { targetKeywords?: string[] } | null)?.targetKeywords ?? [];
  const merged = Array.from(new Set([...targetKeywords, ...fromBrief]));

  try {
    const analysis = await analyzeDraft({
      draftId: id,
      body: draft.body as string,
      targetKeywords: merged,
      title: (draft.title as string | null) ?? null,
      topic: (draft.topic as string | null) ?? null,
      format: (draft.format as string | null) ?? null,
      template: (draft.template as string | null) ?? null,
      practiceArea: (draft.practice_area as string | null) ?? null,
      // Loaded here, not inside analyzeDraft: that module is imported by the
      // analysis card (a client component), so the DB-backed store must stay out
      // of it. Falls back to the code-seeded rules on its own.
      readabilityConfig: await getReadabilityConfig(tenantId),
    });
    return NextResponse.json(analysis);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
