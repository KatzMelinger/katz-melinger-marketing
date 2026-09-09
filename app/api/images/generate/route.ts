/**
 * POST /api/images/generate
 *   body: { prompt: string, size?: ImageSize, quality?: ImageQuality }
 *
 * Generates a marketing image via OpenAI gpt-image-1, uploads the PNG to the
 * Supabase `generated-images` bucket, and records a row in `generated_images`.
 * Returns the saved row (with `public_url`) so the browser can render it.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  generateImages,
  generateWithReferences,
  type ImageQuality,
  type ImageSize,
} from "@/lib/openai-images";
import { saveImagePng } from "@/lib/image-store";
import { composeStyleForGeneration, loadImageStyle } from "@/lib/image-style-store";
import {
  isStyleScope,
  type StyleScope,
} from "@/lib/image-style";
import {
  listStyleAssets,
  readStyleAssetBytes,
} from "@/lib/image-style-assets";
import { CHANNEL_TARGET_SIZE, nearestNativeSize, cropToTarget, formatSize } from "@/lib/image-size-map";
import { renderSinglePostImage } from "@/lib/single-image-render";
import { getOperatingBrief } from "@/lib/social-operating-brief";
import { getTenantConfig } from "@/lib/tenant-config";
import { getTenantDb } from "@/lib/tenant-db";
import { guardUser } from "@/lib/supabase-route";

const MAX_REFERENCES = 4;

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_SIZES: ImageSize[] = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "auto",
];
const VALID_QUALITIES: ImageQuality[] = ["low", "medium", "high", "auto"];

function firstHex(s: string | undefined | null): string | null {
  const m = (s ?? "").match(/#([0-9a-fA-F]{6})\b/);
  return m ? `#${m[1]}` : null;
}

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: unknown;
    size?: unknown;
    quality?: unknown;
    useBrandStyle?: unknown;
    channel?: unknown;
    /** Optional headline text (social_post channel only) — composited on top
     *  of a text-free generated background instead of left to the model. */
    headline?: unknown;
    sub?: unknown;
    /** Include a phone-number CTA footer, from the operating brief (S1). */
    includeCta?: unknown;
  };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const useBrandStyle = body.useBrandStyle !== false; // default true
  const channel: StyleScope =
    typeof body.channel === "string" && isStyleScope(body.channel)
      ? body.channel
      : "general";
  // Headline compositing is only offered for social_post — carousels already
  // have their own pipeline, and blog explicitly wants less overlaid text
  // (Diana's per-channel note), so a headline there is ignored rather than honored.
  const headline =
    channel === "social_post" && typeof body.headline === "string" ? body.headline.trim() : "";
  const sub = headline && typeof body.sub === "string" ? body.sub.trim() : "";
  const includeCta = headline ? body.includeCta === true : false;
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  if (prompt.length > 4000) {
    return NextResponse.json(
      { error: "prompt too long (max 4000 chars)" },
      { status: 400 },
    );
  }

  // The channel picks the output size for the channels Diana's spec pins one
  // to (social_carousel/social_post/blog) — the client's requested size is
  // ignored there in favor of the mapped target, generated at the nearest
  // native size and cropped exactly. Every other channel keeps the manual picker.
  const targetSize = CHANNEL_TARGET_SIZE[channel];
  const size: ImageSize = targetSize
    ? nearestNativeSize(targetSize)
    : typeof body.size === "string" && VALID_SIZES.includes(body.size as ImageSize)
      ? (body.size as ImageSize)
      : "1024x1024";
  const quality: ImageQuality =
    typeof body.quality === "string" &&
    VALID_QUALITIES.includes(body.quality as ImageQuality)
      ? (body.quality as ImageQuality)
      : "medium";

  try {
    const styleSuffix = useBrandStyle
      ? (await composeStyleForGeneration(channel)).promptSuffix
      : "";
    const finalPrompt = styleSuffix ? `${prompt}${styleSuffix}` : prompt;

    // When the channel has uploaded design references and the user hasn't
    // opted out of brand style, anchor the generation to those references via
    // the edits endpoint. Otherwise use plain text-to-image generation.
    let referenceBytes: Uint8Array[] = [];
    if (useBrandStyle) {
      const assets = await listStyleAssets(channel);
      const chosen = assets.slice(0, MAX_REFERENCES);
      referenceBytes = await Promise.all(
        chosen.map((a) => readStyleAssetBytes(a.storage_path)),
      );
    }

    // Headline path: text as a real layer (S8/S9 — the carousel pattern applied
    // to a single post). The background gets a forced NO-text instruction and
    // the copy is composited on top via lib/text-overlay.ts, instead of asking
    // the model to render legible words (which it can't — see carousel-render.ts).
    if (headline) {
      const db = await getTenantDb();
      const [cfg, style, brief] = await Promise.all([
        getTenantConfig(db.tenantId).catch(() => ({ firmName: "" }) as { firmName?: string }),
        loadImageStyle().catch(() => null),
        includeCta ? getOperatingBrief(db.tenantId) : Promise.resolve(null),
      ]);
      const bytes = await renderSinglePostImage({
        scenePrompt: prompt,
        headline,
        sub: sub || undefined,
        cta: brief?.socialPhone ?? null,
        brand: {
          firmName: cfg.firmName || "Your Firm",
          accentColor: firstHex(style?.colorPalette) || "#116AB2",
          styleSuffix,
        },
        referenceImages: referenceBytes,
      });
      const saved = await saveImagePng({
        bytes,
        prompt,
        size: formatSize(targetSize!),
        quality,
        metadata: {
          source: "generate",
          brandStyleApplied: Boolean(styleSuffix),
          channel,
          referenceCount: referenceBytes.length,
          autoSized: true,
          textOverlay: { headline, sub: sub || null, cta: includeCta ? brief?.socialPhone ?? null : null },
        },
      });
      return NextResponse.json({ image: saved });
    }

    const results =
      referenceBytes.length > 0
        ? await generateWithReferences({
            prompt: finalPrompt,
            referenceImages: referenceBytes,
            size,
            quality,
            n: 1,
          })
        : await generateImages({
            prompt: finalPrompt,
            size,
            quality,
            n: 1,
          });
    const first = results[0];
    if (!first?.b64_json) {
      return NextResponse.json(
        { error: "Model returned no image" },
        { status: 502 },
      );
    }
    let bytes: Buffer = Buffer.from(first.b64_json, "base64");
    // Crop the native-size generation down to the channel's exact target so the
    // saved image is never a mismatched aspect ratio (see lib/image-size-map.ts).
    if (targetSize) {
      bytes = await cropToTarget(bytes, targetSize);
    }
    const saved = await saveImagePng({
      bytes,
      // Persist the user-typed prompt only — the brand style is the same on
      // every call, and showing it in the library makes the prompt unreadable.
      prompt,
      // The library shows the true output size — the target, not the native
      // size it was generated at and cropped from.
      size: targetSize ? formatSize(targetSize) : size,
      quality,
      metadata: {
        source: "generate",
        brandStyleApplied: Boolean(styleSuffix),
        channel,
        referenceCount: referenceBytes.length,
        ...(targetSize ? { autoSized: true, generatedAtSize: size } : {}),
      },
    });
    return NextResponse.json({ image: saved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Image generation failed";
    console.error("[images/generate] failed:", msg, err instanceof Error ? err.stack : "");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
