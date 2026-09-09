/**
 * Shared headline/sub/badge/footer text-overlay compositor — the "text as a
 * real layer" pattern (badge, headline, accent bar, sub, footer) originally
 * built only for carousel slides (lib/carousel-render.ts). Generalized here so
 * a single social post image can get the exact same crisp, code-composited
 * copy instead of relying on the model to render legible text.
 */

import path from "node:path";

import { createCanvas, GlobalFonts, type Image } from "@napi-rs/canvas";

import { wrap, roundRect } from "./image-canvas";

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

export type OverlayBrand = { firmName: string; accentColor: string };

export type OverlayOptions = {
  W: number;
  H: number;
  bg: Image | null;
  brand: OverlayBrand;
  headline: string;
  sub?: string;
  /** Top-left pill, e.g. "2 / 6" for a carousel slide. Omit for a single post. */
  badge?: string | null;
  /** Right side of the footer, e.g. "Swipe →" or a phone number CTA. */
  footerRight?: string | null;
};

/** Cover-fit `img` onto the WxH canvas, centered. */
function drawCover(ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, img: Image, W: number, H: number) {
  const scale = Math.max(W / img.width, H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

/** Composite a background + templated text block. Shared by carousel slides and single-post images. */
export function compositeOverlay(opts: OverlayOptions): Buffer {
  ensureFonts();
  const { W, H, bg, brand, headline, sub, badge, footerRight } = opts;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const accent = brand.accentColor || "#116AB2";

  // Background: generated image cover-fit, or a brand gradient fallback.
  if (bg) {
    drawCover(ctx, bg, W, H);
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

  const margin = Math.round(W * 0.074); // 80px at W=1080, scales for other canvas widths
  const contentW = W - margin * 2;

  if (badge) {
    ctx.fillStyle = accent;
    roundRect(ctx, margin, margin, 132, 56, 28);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "28px CarouselSansBold";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(badge, margin + 24, margin + 30);
  }

  // Headline — bold, wrapped, anchored to the lower third.
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  const headFont = headline.length > 60 ? 64 : 76;
  ctx.font = `${headFont}px CarouselSansBold`;
  const headLines = wrap(ctx, headline, contentW);
  const headLH = headFont * 1.12;

  // Supporting text — smaller, lighter.
  ctx.font = "34px CarouselSans";
  const subLines = sub ? wrap(ctx, sub, contentW) : [];
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

  // Footer: firm name (left) + an optional right-side note (swipe hint / CTA phone).
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "26px CarouselSansBold";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(brand.firmName.toUpperCase().slice(0, 42), margin, H - margin + 16);
  if (footerRight) {
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "26px CarouselSans";
    ctx.fillText(footerRight, W - margin, H - margin + 16);
    ctx.textAlign = "left";
  }

  return canvas.toBuffer("image/png");
}
