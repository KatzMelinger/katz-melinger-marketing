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
  type ImageQuality,
  type ImageSize,
} from "@/lib/openai-images";
import { saveImagePng } from "@/lib/image-store";

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
  };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
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
    const results = await generateImages({ prompt, size, quality, n: 1 });
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
      prompt,
      size,
      quality,
      metadata: { source: "generate" },
    });
    return NextResponse.json({ image: saved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Image generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
