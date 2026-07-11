/**
 * POST /api/content-production/repurpose/script
 *   body: { draftId?, copy, platform? }
 *
 * The Script (reel / video) add-on — the sibling of the Slides add-on. Turns a
 * post's copy into a 30 to 60 second vertical-video script with a hook, body,
 * and call to action, in the firm's brand voice. Like Slides, the asset is
 * saved back onto the source draft's metadata (metadata.reel_script) so
 * reopening the composer shows it, and returned for immediate display.
 *
 * Brand rules are enforced after generation (no dashes), matching the rest of
 * the social pipeline. Nothing here publishes; it only produces the asset.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";
import { getFirmContext } from "@/lib/firm-context";
import {
  getAnthropic,
  CONTENT_SHORT_FORM_MODEL,
  cachedSystemPrompt,
  extractJSON,
} from "@/lib/anthropic";
import { stripEmDashes } from "@/lib/sanitize-content";
import { recordVendorUsage } from "@/lib/usage-meter";

export const runtime = "nodejs";
export const maxDuration = 60;

type ScriptOut = { hook?: string; body?: string; cta?: string };

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    draftId?: string;
    copy?: string;
    platform?: string;
  };
  const copy = typeof body.copy === "string" ? body.copy.trim() : "";
  if (!copy) {
    return NextResponse.json({ error: "copy is required" }, { status: 400 });
  }

  const db = await getTenantDb();
  const firm = await getFirmContext(db.tenantId).catch(() => "");

  const system = `You are a short-form video scriptwriter for a law firm. You write 30 to 60 second
vertical video scripts (Reels / TikTok) that a firm attorney can read to camera.

The firm's details are below — use them verbatim and never fabricate firm information.
${firm}

NON-NEGOTIABLE RULES:
- Calm, plain English. Authoritative, approachable, action-oriented. No hype.
- No em dashes or en dashes anywhere.
- "New York" and "New Jersey" always spelled out, never abbreviated.
- No fear-based urgency, no outcome guarantees, no fee or price language, no superlatives.
- One idea only. A 3-second hook that speaks to the viewer's situation, a short body that
  delivers the single point in spoken-word sentences, and a soft call to action (an invitation,
  never a hard sell). Total spoken length reads in 30 to 60 seconds.`;

  const user = `Turn this social post into a reel/video script.
${body.platform ? `Target platform: ${body.platform}.\n` : ""}SOURCE POST:
"""
${copy.slice(0, 2000)}
"""
Return JSON only: { "hook": "...", "body": "...", "cta": "..." }`;

  let out: ScriptOut = {};
  try {
    const resp = await getAnthropic().messages.create({
      model: CONTENT_SHORT_FORM_MODEL,
      max_tokens: 1024,
      system: cachedSystemPrompt(system),
      messages: [{ role: "user", content: user }],
    });
    await recordVendorUsage("anthropic", {
      provider: "anthropic",
      endpoint: "repurpose-script",
      units: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
      detail: CONTENT_SHORT_FORM_MODEL,
    });
    const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
    out = extractJSON<ScriptOut>(text);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Script generation failed" },
      { status: 500 },
    );
  }

  const script = {
    hook: stripEmDashes(out.hook ?? ""),
    body: stripEmDashes(out.body ?? ""),
    cta: stripEmDashes(out.cta ?? ""),
  };
  if (!script.hook && !script.body) {
    return NextResponse.json({ error: "The model returned no usable script." }, { status: 502 });
  }

  // Persist onto the draft (best-effort) so reopening the composer shows it.
  if (body.draftId) {
    const { data: row } = await db
      .from("content_drafts")
      .select("metadata")
      .eq("id", body.draftId)
      .maybeSingle();
    const meta = (row?.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<
      string,
      unknown
    >;
    await db
      .from("content_drafts")
      .update({ metadata: { ...meta, reel_script: script } })
      .eq("id", body.draftId);
  }

  return NextResponse.json({
    ok: true,
    script,
    text: [script.hook, script.body, script.cta].filter(Boolean).join("\n\n"),
  });
}
