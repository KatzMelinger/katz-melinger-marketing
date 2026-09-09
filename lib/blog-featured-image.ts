/**
 * Auto-generated blog featured image (Diana's spec: "when a blog draft is
 * approved, generate a WordPress featured image automatically"). No headline
 * text is composited here — Diana's per-channel note is explicit that blog
 * imagery wants a clean editorial photo with LESS overlaid text than social,
 * unlike the social_post/carousel pipelines. Cropped to the blog channel's
 * 1200x630 target via the same size-map used by /api/images/generate.
 *
 * Never blocks the publish/queue flow it's called from — every failure mode
 * resolves to `null` and is logged, not thrown.
 */

import { generateImages } from "./openai-images";
import { composeStyleForGeneration } from "./image-style-store";
import { saveImagePng } from "./image-store";
import { CHANNEL_TARGET_SIZE } from "./image-style";
import { nearestNativeSize, cropToTarget } from "./image-size-map";

const TARGET = CHANNEL_TARGET_SIZE.blog!; // 1200x630, guaranteed present

function scenePrompt(title: string): string {
  return (
    `Photorealistic, editorial featured image for a law firm blog article titled "${title}". ` +
    `Horizontal composition, neutral and professional, minimal overlaid text — a clean editorial ` +
    `photo rather than a graphic. No logos, no watermarks, no readable text or numbers in the image.`
  );
}

/**
 * Generate + save a featured image for a blog draft. Returns the public URL,
 * or null on any failure (never throws — this must never block publishing).
 */
export async function generateBlogFeaturedImage(args: {
  title: string;
  draftId: string;
}): Promise<string | null> {
  try {
    const { promptSuffix } = await composeStyleForGeneration("blog");
    const prompt = `${scenePrompt(args.title)}${promptSuffix || ""}`;
    const results = await generateImages({
      prompt,
      size: nearestNativeSize(TARGET),
      quality: "medium",
      n: 1,
    });
    const first = results[0];
    if (!first?.b64_json) return null;
    const native = Buffer.from(first.b64_json, "base64");
    const bytes = await cropToTarget(native, TARGET);
    const saved = await saveImagePng({
      bytes,
      prompt: args.title,
      size: `${TARGET.w}x${TARGET.h}`,
      quality: "medium",
      metadata: {
        source: "blog_featured_image",
        channel: "blog",
        draft_id: args.draftId,
        autoSized: true,
      },
    });
    return saved.public_url || null;
  } catch (e) {
    console.warn(`[blog-featured-image] generation failed (draft ${args.draftId}):`, e);
    return null;
  }
}
