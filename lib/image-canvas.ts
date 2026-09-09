/**
 * Shared @napi-rs/canvas helpers used anywhere a generated image needs
 * code-composited text or a cover-fit crop. Extracted from lib/carousel-render.ts
 * so the size-map crop step (lib/image-size-map.ts) reuses the exact same
 * cover-fit math instead of a second copy.
 */

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

/** Word-wrap `text` to fit `maxWidth` at the current ctx font. */
export function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
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

export function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Cover-fit `img` (any size) onto a `targetW`x`targetH` canvas, centered and cropped to fill exactly. */
export async function coverCropToBuffer(
  src: Buffer,
  targetW: number,
  targetH: number,
): Promise<Buffer> {
  const img = await loadImage(src);
  const canvas = createCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d");
  const scale = Math.max(targetW / img.width, targetH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (targetW - w) / 2, (targetH - h) / 2, w, h);
  return canvas.toBuffer("image/png");
}
