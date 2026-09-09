/**
 * Hybrid carousel slide renderer.
 *
 * Each slide = a generative background (gpt-image-1, brand-styled, NO text) with
 * a crisp templated text overlay composited on top via @napi-rs/canvas. The
 * generator handles the look; the canvas handles legible, on-brand headline text
 * — so slides come out post-ready instead of as AI images with garbled words.
 *
 * Pure compositing + OpenAI image calls only; no DB imports. The route supplies
 * brand context (firm name, accent color, style suffix) so this stays testable
 * standalone.
 */

import { loadImage } from "@napi-rs/canvas";

import { generateImages, generateWithReferences } from "./openai-images";
import { compositeOverlay } from "./text-overlay";

// Instagram-portrait canvas (4:5). Crisp text, standard carousel aspect.
const W = 1080;
const H = 1350;

export type SlideInput = { n: number; headline: string; sub: string };

export type CarouselBrand = {
  firmName: string;
  /** Hex accent, e.g. "#116AB2". */
  accentColor: string;
  /** Brand-style prompt suffix from composeStyleForGeneration(). */
  styleSuffix: string;
};

export type RenderedSlide = { n: number; headline: string; png: Buffer };

function backgroundPrompt(slide: SlideInput, brand: CarouselBrand): string {
  return (
    `Editorial abstract background for a professional law firm social media carousel slide. ` +
    `Visual theme inspired by: "${slide.headline}". Modern, clean, high quality, lots of negative space. ` +
    `IMPORTANT: absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO watermarks anywhere in the image. ` +
    `Keep the lower two-thirds darker and visually quiet so overlaid text stays readable.` +
    (brand.styleSuffix || "")
  );
}

function compositeSlide(
  slide: SlideInput,
  brand: CarouselBrand,
  bg: Awaited<ReturnType<typeof loadImage>> | null,
  total: number,
): Buffer {
  return compositeOverlay({
    W,
    H,
    bg,
    brand,
    headline: slide.headline,
    sub: slide.sub,
    badge: `${slide.n} / ${total}`,
    footerRight: slide.n === 1 && total > 1 ? "Swipe →" : null,
  });
}

/**
 * Render every slide. Backgrounds generate concurrently (capped); a slide whose
 * background fails still renders on the brand-gradient fallback so the set is
 * never partial.
 */
export async function renderCarouselSlides(opts: {
  slides: SlideInput[];
  brand: CarouselBrand;
  generateBackground?: boolean;
  concurrency?: number;
  /** Optional brand reference images (PNG bytes). When present, backgrounds are
   *  generated with the edits endpoint so they anchor on this visual style. */
  referenceImages?: Uint8Array[];
}): Promise<RenderedSlide[]> {
  const { slides, brand } = opts;
  const genBg = opts.generateBackground !== false;
  const limit = Math.max(1, opts.concurrency ?? 3);
  const references = opts.referenceImages ?? [];

  // Generate backgrounds with a small concurrency pool.
  const backgrounds: (Awaited<ReturnType<typeof loadImage>> | null)[] = new Array(slides.length).fill(null);
  if (genBg) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < slides.length) {
        const i = cursor++;
        try {
          const genOpts = {
            prompt: backgroundPrompt(slides[i], brand),
            size: "1024x1536" as const,
            quality: "medium" as const,
            n: 1,
          };
          const [img] = references.length
            ? await generateWithReferences({ ...genOpts, referenceImages: references })
            : await generateImages(genOpts);
          backgrounds[i] = await loadImage(Buffer.from(img.b64_json, "base64"));
        } catch {
          backgrounds[i] = null; // gradient fallback
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, slides.length) }, worker));
  }

  return slides.map((s, i) => ({
    n: s.n,
    headline: s.headline,
    png: compositeSlide(s, brand, backgrounds[i], slides.length),
  }));
}
