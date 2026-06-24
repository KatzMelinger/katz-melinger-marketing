/**
 * POST /api/content-production/repurpose
 *   body: { url?, title?, sourceText?, practiceArea?, keywords?: string[] }
 *
 * Step 1 of the Repurpose-into-social workflow: take an existing page and
 * generate a spread of brand-voice social variations (Instagram / LinkedIn /
 * Facebook / X captions + a carousel script + a short-video hook). The drafts
 * are saved to content_drafts (so they show in the Drafts library) and returned
 * for in-place review.
 *
 * This endpoint deliberately does NOT schedule anything. The human reviews,
 * edits, and picks in the drawer, then POSTs the chosen ones to
 * /api/content-production/repurpose/schedule. Generate and schedule are two
 * separate steps so nothing goes out sight-unseen.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";
import { generateMultiFormat } from "@/lib/content-multiformat";
import { fetchPageText } from "@/lib/page-optimizer";
import { REPURPOSE_FORMAT_KEYS } from "@/lib/repurpose-formats";

export const runtime = "nodejs";
export const maxDuration = 120;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = str(body.url);
  const title = str(body.title);
  const practiceArea = str(body.practiceArea);
  const keywords = Array.isArray(body.keywords)
    ? (body.keywords as unknown[]).filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : [];

  const topic = title || url;
  if (!topic) {
    return NextResponse.json({ error: "title or url is required" }, { status: 400 });
  }

  const db = await getTenantDb();

  // Ground the variations in the live page when we have a URL and no pasted
  // source. Fails soft — if the page can't be fetched we still generate from
  // the topic/keywords rather than erroring the whole run.
  let sourceText = str(body.sourceText) || undefined;
  if (!sourceText && url) {
    try {
      sourceText = await fetchPageText(url);
    } catch {
      /* topic-only generation */
    }
  }

  let gen;
  try {
    gen = await generateMultiFormat({
      topic,
      practiceArea: practiceArea || undefined,
      formats: REPURPOSE_FORMAT_KEYS,
      targetKeywords: keywords.length ? keywords : undefined,
      sourceText,
      originSource: "repurpose",
      originContext: url ? { url } : null,
      tenantId: db.tenantId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generation failed" },
      { status: 500 },
    );
  }

  if (!gen.drafts.length) {
    return NextResponse.json({ error: "The model returned no usable variations." }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    batch_id: gen.batch_id,
    topic,
    drafts: gen.drafts.map((d) => ({
      id: d.id,
      format: d.format,
      title: d.title,
      body: d.body,
      metadata: d.metadata,
    })),
  });
}
