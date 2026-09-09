/**
 * Single social-post image with a real headline text layer — the same
 * hybrid pattern as carousels (lib/carousel-render.ts), applied to a single
 * post rather than a slide sequence. Used only for the "social_post" channel,
 * which happens to share the carousel's 1080x1350 target size.
 */

import { loadImage } from "@napi-rs/canvas";

import { generateImages, generateWithReferences } from "./openai-images";
import { compositeOverlay, type OverlayBrand } from "./text-overlay";

const W = 1080;
const H = 1350;

export type SinglePostBrand = OverlayBrand & {
  /** Brand-style prompt suffix from composeStyleForGeneration(). */
  styleSuffix: string;
};

function backgroundPrompt(scenePrompt: string, brand: SinglePostBrand): string {
  return (
    `${scenePrompt} ` +
    `IMPORTANT: absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO watermarks anywhere in the image. ` +
    `Keep the lower two-thirds darker and visually quiet so overlaid text stays readable.` +
    (brand.styleSuffix || "")
  );
}

/**
 * Generate a text-free background from `scenePrompt` and composite the
 * headline/sub/CTA on top. Falls back to a brand-gradient background (never
 * throws) if generation fails, same resilience as the carousel renderer.
 */
export async function renderSinglePostImage(opts: {
  scenePrompt: string;
  headline: string;
  sub?: string;
  /** Right-footer CTA text, e.g. a phone number. Omit for no CTA footer. */
  cta?: string | null;
  brand: SinglePostBrand;
  referenceImages?: Uint8Array[];
}): Promise<Buffer> {
  const references = opts.referenceImages ?? [];
  let bg: Awaited<ReturnType<typeof loadImage>> | null = null;
  try {
    const genOpts = {
      prompt: backgroundPrompt(opts.scenePrompt, opts.brand),
      size: "1024x1536" as const,
      quality: "medium" as const,
      n: 1,
    };
    const [img] = references.length
      ? await generateWithReferences({ ...genOpts, referenceImages: references })
      : await generateImages(genOpts);
    bg = await loadImage(Buffer.from(img.b64_json, "base64"));
  } catch {
    bg = null; // gradient fallback, same as carousel
  }

  return compositeOverlay({
    W,
    H,
    bg,
    brand: opts.brand,
    headline: opts.headline,
    sub: opts.sub,
    badge: null,
    footerRight: opts.cta ?? null,
  });
}
