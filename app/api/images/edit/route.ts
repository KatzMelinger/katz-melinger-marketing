/**
 * POST /api/images/edit
 *   body: { parentImageId: uuid, prompt: string, size?, quality? }
 *
 * Edits a previously generated image by feeding its bytes back to OpenAI
 * gpt-image-1 along with a new prompt ("make the background darker", "add a
 * coffee cup on the desk", etc.). Saves the result as a new row linked to the
 * source via `parent_image_id`.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  editImage,
  type ImageQuality,
  type ImageSize,
} from "@/lib/openai-images";
import { readImageBytes, saveImagePng } from "@/lib/image-store";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  composeStyleForGeneration,
  isStyleScope,
  type StyleScope,
} from "@/lib/image-style";

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
    parentImageId?: unknown;
    prompt?: unknown;
    size?: unknown;
    quality?: unknown;
    useBrandStyle?: unknown;
    channel?: unknown;
  };
  const parentImageId =
    typeof body.parentImageId === "string" ? body.parentImageId : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const useBrandStyle = body.useBrandStyle !== false; // default true
  const channel: StyleScope =
    typeof body.channel === "string" && isStyleScope(body.channel)
      ? body.channel
      : "general";
  if (!parentImageId) {
    return NextResponse.json(
      { error: "parentImageId required" },
      { status: 400 },
    );
  }
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
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
    const sb = getSupabaseAdmin();
    const { data: parent, error: parentErr } = await sb
      .from("generated_images")
      .select("storage_path, size, quality")
      .eq("id", parentImageId)
      .maybeSingle();
    if (parentErr) {
      return NextResponse.json({ error: parentErr.message }, { status: 500 });
    }
    if (!parent) {
      return NextResponse.json(
        { error: "parent image not found" },
        { status: 404 },
      );
    }

    const sourceBytes = await readImageBytes(parent.storage_path as string);
    const styleSuffix = useBrandStyle
      ? (await composeStyleForGeneration(channel)).promptSuffix
      : "";
    const finalPrompt = styleSuffix ? `${prompt}${styleSuffix}` : prompt;
    const results = await editImage({
      imageBytes: sourceBytes,
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
      prompt,
      size,
      quality,
      parentImageId,
      metadata: {
        source: "edit",
        brandStyleApplied: Boolean(styleSuffix),
        channel,
      },
    });
    return NextResponse.json({ image: saved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Image edit failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
