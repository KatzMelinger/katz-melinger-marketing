/**
 * Per-channel output size map for the generic image generator.
 *
 * gpt-image-1 only natively outputs 1024x1024, 1536x1024, or 1024x1536 — the
 * real marketing sizes (Instagram 1080x1350, blog featured 1200x630, etc.)
 * aren't native. For the channels Diana's spec pins a size to, we generate at
 * the nearest native size and crop to the exact target instead of leaving the
 * mismatch in the saved image. Channels not listed here (general, website,
 * newsletter) aren't specced with a fixed size, so they keep the existing
 * manual size picker untouched.
 */

import type { ImageSize } from "./openai-images";
import { coverCropToBuffer } from "./image-canvas";
import { CHANNEL_TARGET_SIZE, formatSize, type TargetSize } from "./image-style";

export { CHANNEL_TARGET_SIZE, formatSize, type TargetSize };

const NATIVE_SIZES: { size: ImageSize; w: number; h: number }[] = [
  { size: "1024x1024", w: 1024, h: 1024 },
  { size: "1536x1024", w: 1536, h: 1024 },
  { size: "1024x1536", w: 1024, h: 1536 },
];

/** The native gpt-image-1 size whose aspect ratio is closest to the target, so the crop trims the least. */
export function nearestNativeSize(target: TargetSize): ImageSize {
  const targetRatio = target.w / target.h;
  let best = NATIVE_SIZES[0];
  let bestDiff = Infinity;
  for (const n of NATIVE_SIZES) {
    const diff = Math.abs(n.w / n.h - targetRatio);
    if (diff < bestDiff) {
      best = n;
      bestDiff = diff;
    }
  }
  return best.size;
}

/** Crop a generated PNG (any size) to exactly `target`, cover-fit and centered. */
export async function cropToTarget(png: Buffer, target: TargetSize): Promise<Buffer> {
  return coverCropToBuffer(png, target.w, target.h);
}
