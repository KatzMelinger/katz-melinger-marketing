/**
 * GET  /api/content/batches             — list recent multi-format batches
 * POST /api/content/batches             — generate a new batch
 *   body: {
 *     topic, practiceArea?, formats: string[], tone?,
 *     targetKeywords?: string[], seoBriefHeadings?: string[],
 *     competitorGaps?: string[], sourceId?: string
 *   }
 *
 * The POST returns the batch_id and the array of generated drafts. Each
 * draft is also persisted in content_drafts so it shows up in the library.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";
import { normalizeLanguage } from "@/lib/content-language";
import { generateMultiFormat, type FormatKey } from "@/lib/content-multiformat";
import { scheduleDraftAnalysis } from "@/lib/auto-analyze";
import { findExistingContent, duplicateMessage } from "@/lib/content-dedup";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const { supabase } = await getTenantClient();
  const { data: batches, error } = await supabase
    .from("content_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // For each batch, also pull its drafts (titles only, for the index).
  const batchIds = (batches ?? []).map((b) => b.id);
  const draftMap = new Map<string, { id: string; format: string; title: string | null }[]>();
  if (batchIds.length > 0) {
    const { data: drafts } = await supabase
      .from("content_drafts")
      .select("id, batch_id, format, title")
      .in("batch_id", batchIds);
    for (const d of drafts ?? []) {
      const arr = draftMap.get(d.batch_id as string) ?? [];
      arr.push({ id: d.id as string, format: d.format as string, title: d.title as string | null });
      draftMap.set(d.batch_id as string, arr);
    }
  }

  return NextResponse.json({
    batches: (batches ?? []).map((b) => ({ ...b, drafts: draftMap.get(b.id) ?? [] })),
  });
}

const ALLOWED: FormatKey[] = ["blog", "linkedin", "twitter", "facebook", "instagram", "email", "podcast", "video_short", "video_long"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body?.topic) return NextResponse.json({ error: "topic required" }, { status: 400 });
  const formats = Array.isArray(body?.formats)
    ? (body.formats as string[]).filter((f): f is FormatKey => ALLOWED.includes(f as FormatKey))
    : [];
  if (formats.length === 0) {
    return NextResponse.json(
      { error: `formats[] required (one or more of: ${ALLOWED.join(", ")})` },
      { status: 400 },
    );
  }

  // Duplicate guard for a FRESH batch (a repurpose from a sourceId is an
  // intentional reformat, so it's exempt). Override with { force: true }.
  if (!body?.sourceId && body?.force !== true) {
    const { tenantId } = await getTenantClient();
    const dup = await findExistingContent({
      tenantId,
      keyword: body.topic,
      secondaryKeywords: Array.isArray(body.targetKeywords) ? (body.targetKeywords as string[]) : [],
    });
    if (dup) {
      return NextResponse.json(
        { error: duplicateMessage(dup), duplicate: true, existing: dup },
        { status: 409 },
      );
    }
  }

  // Optional per-format target runtime (podcast / video). Whitelist keys and
  // cap length so it's safe to drop into the prompt.
  let formatDurations: Partial<Record<FormatKey, string>> | undefined;
  if (body?.formatDurations && typeof body.formatDurations === "object") {
    const out: Partial<Record<FormatKey, string>> = {};
    for (const [k, v] of Object.entries(body.formatDurations as Record<string, unknown>)) {
      if (ALLOWED.includes(k as FormatKey) && typeof v === "string" && v.trim()) {
        out[k as FormatKey] = v.trim().slice(0, 40);
      }
    }
    if (Object.keys(out).length > 0) formatDurations = out;
  }

  // If sourceId provided, pull its content for repurposing.
  let sourceText: string | null = null;
  if (body?.sourceId) {
    const { supabase } = await getTenantClient();
    const { data } = await supabase
      .from("content_sources")
      .select("content")
      .eq("id", body.sourceId)
      .maybeSingle();
    sourceText = (data?.content as string | null) ?? null;
  }

  try {
    const result = await generateMultiFormat({
      topic: body.topic,
      practiceArea: body.practiceArea,
      formats,
      tone: body.tone,
      targetKeywords: body.targetKeywords,
      seoBriefHeadings: body.seoBriefHeadings,
      competitorGaps: body.competitorGaps,
      sourceId: body.sourceId ?? null,
      sourceText,
      formatDurations,
      originSource:
        typeof body?.origin_source === "string" ? body.origin_source : null,
      originContext:
        body?.origin_context && typeof body.origin_context === "object"
          ? (body.origin_context as Record<string, unknown>)
          : null,
      language: normalizeLanguage(body?.language),
    });

    // Auto-readability check for the prose formats in the batch (blog/email),
    // where a reading-grade score is meaningful. Runs after the response.
    for (const d of result.drafts) {
      if (d.format === "blog" || d.format === "email") {
        scheduleDraftAnalysis({
          draftId: d.id,
          body: d.body,
          title: d.title,
          topic: body.topic,
          format: d.format,
          targetKeywords: Array.isArray(body.targetKeywords) ? body.targetKeywords : [],
        });
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Batch generation failed";
    console.error("[content/batches] failed:", msg, err instanceof Error ? err.stack : "");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
