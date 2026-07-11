/**
 * The social variations the Repurpose flow generates from a page, and how each
 * one maps onto a publishable channel.
 *
 * Shared by the generate API (which feeds `formats` to generateMultiFormat),
 * the schedule API, and the review drawer UI. Kept free of server-only imports
 * (`import type` is erased at build time) so the client bundle stays clean.
 */

import type { FormatKey } from "./content-multiformat";

/** A generated variation and the channel(s) it can be scheduled to. */
export type RepurposeFormat = {
  key: Extract<
    FormatKey,
    "instagram" | "linkedin" | "facebook" | "carousel" | "video_short"
  >;
  label: string;
  /** Ayrshare platform(s) this variation naturally posts to (first = default). */
  platforms: string[];
  /**
   * "caption" = a ready-to-post body; "script" = a production script (carousel
   * slides, video shot list) that posts as the caption/voiceover text.
   */
  kind: "caption" | "script";
};

export const REPURPOSE_FORMATS: RepurposeFormat[] = [
  { key: "instagram", label: "Instagram caption", platforms: ["instagram"], kind: "caption" },
  { key: "linkedin", label: "LinkedIn post", platforms: ["linkedin"], kind: "caption" },
  { key: "facebook", label: "Facebook post", platforms: ["facebook"], kind: "caption" },
  {
    key: "carousel",
    label: "Carousel script",
    platforms: ["instagram", "linkedin"],
    kind: "script",
  },
  {
    key: "video_short",
    label: "Short video hook + script",
    platforms: ["instagram", "tiktok", "youtube"],
    kind: "script",
  },
];

/** The format list handed to generateMultiFormat for a repurpose run. */
export const REPURPOSE_FORMAT_KEYS: FormatKey[] = REPURPOSE_FORMATS.map((f) => f.key);

const BY_KEY = new Map(REPURPOSE_FORMATS.map((f) => [f.key as string, f]));

export function repurposeFormatMeta(format: string): RepurposeFormat | undefined {
  return BY_KEY.get(format);
}
