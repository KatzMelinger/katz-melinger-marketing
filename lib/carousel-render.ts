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

import path from "node:path";

import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

import { generateImages } from "./openai-images";

// Instagram-portrait canvas (4:5). Crisp text, standard carousel aspect.
const W = 1080;
const H = 1350;

export type SlideInput = { n: number; headline: string; sub: string };

export type CarouselBrand = {
  firmName: string;
  /** Hex accent, e.g. "#185FA5". */
  accentColor: string;
  /** Brand-style prompt suffix from composeStyleForGeneration(). */
  styleSuffix: string;
};

export type RenderedSlide = { n: number; headline: string; png: Buffer };

// Register the bundled fonts once per process. Distinct family names keep
// weight selection deterministic across platforms (no reliance on system fonts).
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  try {
    GlobalFonts.registerFromPath(path.join(dir, "CarouselSans-Bold.ttf"), "CarouselSansBold");
    GlobalFonts.registerFromPath(path.join(dir, "CarouselSans-Regular.ttf"), "CarouselSans");
  } catch {
    /* fall back to whatever system fonts exist */
  }
  fontsReady = true;
}

function backgroundPrompt(slide: SlideInput, brand: CarouselBrand): string {
  return (
    `Editorial abstract background for a professional law firm social media carousel slide. ` +
    `Visual theme inspired by: "${slide.headline}". Modern, clean, high quality, lots of negative space. ` +
    `IMPORTANT: absolutely NO text, NO words, NO letters, NO numbers, NO logos, NO watermarks anywhere in the image. ` +
    `Keep the lower two-thirds darker and visually quiet so overlaid text stays readable.` +
    (brand.styleSuffix || "")
  );
}

/** Word-wrap `text` to fit `maxWidth` at the current ctx font. */
function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Cover-fit `img` (any size) onto the WxH canvas, centered. */
function drawCover(ctx: SKRSContext2D, img: Awaited<ReturnType<typeof loadImage>>) {
  const scale = Math.max(W / img.width, H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

function compositeSlide(
  slide: SlideInput,
  brand: CarouselBrand,
  bg: Awaited<ReturnType<typeof loadImage>> | null,
  total: number,
): Buffer {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const accent = brand.accentColor || "#185FA5";

  // Background: generated image cover-fit, or a brand gradient fallback.
  if (bg) {
    drawCover(ctx, bg);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, accent);
    g.addColorStop(1, "#0f172a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Legibility scrim — darken toward the bottom where the text sits.
  const scrim = ctx.createLinearGradient(0, 0, 0, H);
  scrim.addColorStop(0, "rgba(15,23,42,0.15)");
  scrim.addColorStop(0.45, "rgba(15,23,42,0.35)");
  scrim.addColorStop(1, "rgba(15,23,42,0.82)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);

  const margin = 80;
  const contentW = W - margin * 2;

  // Slide counter badge (top-left).
  ctx.fillStyle = accent;
  roundRect(ctx, margin, margin, 132, 56, 28);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "28px CarouselSansBold";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(`${slide.n} / ${total}`, margin + 24, margin + 30);

  // Headline — bold, wrapped, anchored to the lower third.
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  const headFont = slide.headline.length > 60 ? 64 : 76;
  ctx.font = `${headFont}px CarouselSansBold`;
  const headLines = wrap(ctx, slide.headline, contentW);
  const headLH = headFont * 1.12;

  // Supporting text — smaller, lighter.
  ctx.font = "34px CarouselSans";
  const subLines = slide.sub ? wrap(ctx, slide.sub, contentW) : [];
  const subLH = 34 * 1.3;

  const accentBarH = 8;
  const gapAfterHead = subLines.length ? 28 : 0;
  const blockH =
    accentBarH + 28 + headLines.length * headLH + gapAfterHead + subLines.length * subLH;
  let y = H - margin - 70 - blockH; // leave room for the footer

  // Accent bar above the headline.
  ctx.fillStyle = accent;
  roundRect(ctx, margin, y, 96, accentBarH, 4);
  ctx.fill();
  y += accentBarH + 28;

  ctx.fillStyle = "#ffffff";
  ctx.font = `${headFont}px CarouselSansBold`;
  ctx.textBaseline = "top";
  for (const ln of headLines) {
    ctx.fillText(ln, margin, y);
    y += headLH;
  }

  if (subLines.length) {
    y += gapAfterHead; // y is already at the bottom of the headline block
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = "34px CarouselSans";
    for (const ln of subLines) {
      ctx.fillText(ln, margin, y);
      y += subLH;
    }
  }

  // Footer: firm name (left) + swipe hint on the first slide (right).
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "26px CarouselSansBold";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(brand.firmName.toUpperCase().slice(0, 42), margin, H - margin + 16);
  if (slide.n === 1 && total > 1) {
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "26px CarouselSans";
    ctx.fillText("Swipe →", W - margin, H - margin + 16);
    ctx.textAlign = "left";
  }

  return canvas.toBuffer("image/png");
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
}): Promise<RenderedSlide[]> {
  const { slides, brand } = opts;
  const genBg = opts.generateBackground !== false;
  const limit = Math.max(1, opts.concurrency ?? 3);

  // Generate backgrounds with a small concurrency pool.
  const backgrounds: (Awaited<ReturnType<typeof loadImage>> | null)[] = new Array(slides.length).fill(null);
  if (genBg) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < slides.length) {
        const i = cursor++;
        try {
          const [img] = await generateImages({
            prompt: backgroundPrompt(slides[i], brand),
            size: "1024x1536",
            quality: "medium",
            n: 1,
          });
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
