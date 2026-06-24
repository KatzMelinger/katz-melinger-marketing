/**
 * POST /api/content-production/repurpose/carousel-images
 *   body: { draftId?, script }
 *
 * Turns a carousel SCRIPT into post-ready slide IMAGES (the hybrid pipeline):
 * each slide gets a brand-styled generated background with a crisp templated
 * text overlay composited on top, so the slides come out legible and on-brand
 * rather than as AI images with garbled words.
 *
 * Each slide PNG is stored in the generated-images bucket (signed, externally
 * fetchable URL) so it can be attached to an Ayrshare carousel post. The slide
 * URLs + posting caption are saved back onto the draft and returned so the
 * review drawer can show thumbnails and schedule with media.
 *
 * Degrades gracefully: with no OpenAI key, slides still render on the brand
 * gradient (no generated background) so the flow never hard-fails.
 */

import { NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";
import { loadImageStyle, composeStyleForGeneration } from "@/lib/image-style-store";
import { saveImagePng } from "@/lib/image-store";
import { parseCarouselScript } from "@/lib/carousel-slides";
import { renderCarouselSlides } from "@/lib/carousel-render";

export const runtime = "nodejs";
export const maxDuration = 300;

// Instagram allows up to 10 carousel images.
const MAX_SLIDES = 10;

function firstHex(s: string | undefined | null): string | null {
  const m = (s ?? "").match(/#([0-9a-fA-F]{6})\b/);
  return m ? `#${m[1]}` : null;
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { draftId?: string; script?: string };
  const script = typeof body.script === "string" ? body.script : "";
  if (!script.trim()) {
    return NextResponse.json({ error: "script is required" }, { status: 400 });
  }

  const parsed = parseCarouselScript(script);
  if (!parsed.slides.length) {
    return NextResponse.json(
      { error: "Could not find any slides in the script (expected 'Slide 1: …' lines)." },
      { status: 422 },
    );
  }
  const truncated = parsed.slides.length > MAX_SLIDES;
  const slides = parsed.slides.slice(0, MAX_SLIDES);

  const db = await getTenantDb();

  // Brand context for the slides.
  const [cfg, style, styleStyle] = await Promise.all([
    getTenantConfig(db.tenantId).catch(() => ({ firmName: "" }) as { firmName?: string }),
    loadImageStyle().catch(() => null),
    composeStyleForGeneration("social_carousel").catch(() => ({ promptSuffix: "" })),
  ]);
  const brand = {
    firmName: cfg.firmName || "Your Firm",
    accentColor: firstHex(style?.colorPalette) || "#185FA5",
    styleSuffix: styleStyle.promptSuffix || "",
  };

  const generateBackground = !!process.env.OPENAI_API_KEY?.trim();

  let rendered;
  try {
    rendered = await renderCarouselSlides({ slides, brand, generateBackground });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Slide rendering failed" },
      { status: 500 },
    );
  }

  // Upload each slide; keep order. A single upload failure drops that slide
  // rather than the whole set.
  const out: { n: number; headline: string; url: string }[] = [];
  for (const r of rendered) {
    try {
      const saved = await saveImagePng({
        bytes: r.png,
        prompt: `Carousel slide ${r.n}: ${r.headline}`,
        size: "1080x1350",
        quality: "medium",
        metadata: {
          kind: "carousel_slide",
          draft_id: body.draftId ?? null,
          slide: r.n,
          generated_background: generateBackground,
        },
      });
      if (saved.public_url) out.push({ n: r.n, headline: r.headline, url: saved.public_url });
    } catch {
      /* skip this slide */
    }
  }

  if (!out.length) {
    return NextResponse.json({ error: "No slides could be saved." }, { status: 502 });
  }

  const urls = out.map((s) => s.url);

  // Persist onto the draft (best-effort) so reopening shows the slides + caption.
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
      .update({
        metadata: { ...meta, carousel_media_urls: urls, carousel_caption: parsed.caption },
      })
      .eq("id", body.draftId);
  }

  return NextResponse.json({
    ok: true,
    slides: out,
    urls,
    caption: parsed.caption,
    generatedBackground: generateBackground,
    truncated,
    message: `${out.length} slide image(s) ready${
      generateBackground ? "" : " (brand gradient — connect OpenAI for generated backgrounds)"
    }${truncated ? `. Only the first ${MAX_SLIDES} slides were rendered.` : "."}`,
  });
}
