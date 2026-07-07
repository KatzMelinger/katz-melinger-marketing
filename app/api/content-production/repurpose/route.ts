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
import { generateSocialPosts } from "@/lib/content-social";
import { fetchPageText } from "@/lib/page-optimizer";
import { REPURPOSE_FORMAT_KEYS } from "@/lib/repurpose-formats";
import type { SocialFormatKey } from "@/lib/social-format-rules";

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

  const topic = title || url;
  if (!topic) {
    return NextResponse.json({ error: "title or url is required" }, { status: 400 });
  }

  const db = await getTenantDb();

  // Ground the variations in the live page. Social generation is source-required
  // (Rule 1): the source is the page being repurposed, so we need its text. Use
  // the pasted source when provided, else fetch the live page.
  let sourceText = str(body.sourceText) || undefined;
  if (!sourceText && url) {
    try {
      sourceText = await fetchPageText(url);
    } catch {
      /* handled below — source is required */
    }
  }
  if (!sourceText?.trim()) {
    return NextResponse.json(
      {
        error:
          "Couldn't read the source page to repurpose. Paste the source content or check the URL — social posts must be generated from an approved source.",
      },
      { status: 422 },
    );
  }

  let gen;
  try {
    gen = await generateSocialPosts({
      source: {
        kind: "page",
        title: topic,
        text: sourceText,
        url: url || null,
      },
      formats: REPURPOSE_FORMAT_KEYS as SocialFormatKey[],
      practiceArea: practiceArea || undefined,
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
