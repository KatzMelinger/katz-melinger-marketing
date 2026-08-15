/**
 * Aspect-ratio checks for the composer's format media guard (master-spec 4A).
 *
 * Reel/Story/Short formats are vertical. Until now the guard only counted
 * attachments, so a landscape photo satisfied "needs a vertical (9:16) video or
 * image" and the post failed at the platform instead of in the composer.
 *
 * Browser-free logic lives here so it can be unit-tested; the DOM measurement
 * (which needs Image/HTMLVideoElement) is in measureAspect below and is the only
 * part that touches the document.
 */

/** 9:16 portrait — the target for Reels, Stories and Shorts. */
export const VERTICAL_TARGET = 9 / 16; // 0.5625

/**
 * How far from 9:16 still counts as "close enough to look right". 0.5-0.66
 * covers 9:16 through roughly 2:3, which the platforms letterbox acceptably.
 * Wider than that and the platform crops visibly.
 */
const VERTICAL_MIN = 0.5;
const VERTICAL_MAX = 0.66;

export type Dimensions = { width: number; height: number };

export type AspectVerdict =
  | { ok: true; warning?: string }
  | { ok: false; reason: string };

/**
 * Judge a vertical-format asset.
 *
 * Landscape and square are rejected — those are unambiguously the wrong shape
 * and the platform will either refuse them or crop the subject out. Portrait
 * that simply isn't 9:16 (a 3:4 phone photo, say) passes with a warning instead
 * of a block: it publishes fine with letterboxing, and blocking it would be a
 * false positive on media the firm may have deliberately chosen.
 */
export function judgeVertical(dim: Dimensions | null): AspectVerdict {
  // Unknown dimensions must not block: a CORS-restricted or slow asset should
  // not be treated as a bad one. The platform stays the backstop.
  if (!dim || dim.width <= 0 || dim.height <= 0) return { ok: true };

  const ratio = dim.width / dim.height;
  if (ratio > 1) return { ok: false, reason: `is landscape (${dim.width}x${dim.height}) — needs 9:16 vertical` };
  if (ratio === 1) return { ok: false, reason: `is square (${dim.width}x${dim.height}) — needs 9:16 vertical` };
  if (ratio < VERTICAL_MIN) {
    return { ok: false, reason: `is narrower than 9:16 (${dim.width}x${dim.height})` };
  }
  if (ratio > VERTICAL_MAX) {
    return {
      ok: true,
      warning: `${dim.width}x${dim.height} isn't 9:16 — the platform will letterbox or crop it`,
    };
  }
  return { ok: true };
}

/** True when the URL looks like a video, so we measure it with a video element. */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|m4v|webm|avi)(\?|#|$)/i.test(url);
}

/**
 * Read an asset's pixel dimensions in the browser. Resolves null rather than
 * rejecting for anything that fails — a measurement we couldn't take must not
 * become a blocked post (see judgeVertical).
 */
export function measureAspect(url: string, timeoutMs = 8000): Promise<Dimensions | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const done = (d: Dimensions | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(d);
    };
    const timer = setTimeout(() => done(null), timeoutMs);

    if (isVideoUrl(url)) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight });
      v.onerror = () => done(null);
      v.src = url;
      return;
    }
    const img = new Image();
    img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = url;
  });
}
