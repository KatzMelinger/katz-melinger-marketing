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
import { composeStyleForGeneration } from "@/lib/image-style-store";
import {
  isStyleScope,
  type StyleScope,
} from "@/lib/image-style";
import {
  listStyleAssets,
  readStyleAssetBytes,
} from "@/lib/image-style-assets";

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

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: unknown;
    size?: unknown;
    quality?: unknown;
    useBrandStyle?: unknown;
    channel?: unknown;
  };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const useBrandStyle = body.useBrandStyle !== false; // default true
  const channel: StyleScope =
    typeof body.channel === "string" && isStyleScope(body.channel)
      ? body.channel
      : "general";
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  if (prompt.length > 4000) {
    return NextResponse.json(
      { error: "prompt too long (max 4000 chars)" },
      { status: 400 },
    );
  }

  const size: ImageSize =
    typeof body.size === "string" && VALID_SIZES.includes(body.size as ImageSize)
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
    const bytes = Buffer.from(first.b64_json, "base64");
    const saved = await saveImagePng({
      bytes,
      // Persist the user-typed prompt only — the brand style is the same on
      // every call, and showing it in the library makes the prompt unreadable.
      prompt,
      size,
      quality,
      metadata: {
        source: "generate",
        brandStyleApplied: Boolean(styleSuffix),
        channel,
        referenceCount: referenceBytes.length,
      },
    });
    return NextResponse.json({ image: saved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Image generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
