/**
 * Brand-style guide for the image generator — PURE constants, types, and
 * formatters only. No DB / server imports here so this module is safe to import
 * from client components (e.g. the /content/images/style page). The actual
 * Supabase reads/writes live in lib/image-style-store.ts (server-only).
 */

export const IMAGE_STYLE_KEYS = [
  "visualDirection",
  "colorPalette",
  "moodTone",
  "composition",
  "avoidList",
] as const;

export type ImageStyleKey = (typeof IMAGE_STYLE_KEYS)[number];

export type ImageStyleSettings = Record<ImageStyleKey, string>;

export const EMPTY_IMAGE_STYLE: ImageStyleSettings = {
  visualDirection: "",
  colorPalette: "",
  moodTone: "",
  composition: "",
  avoidList: "",
};

const FIELD_LABELS: Record<ImageStyleKey, string> = {
  visualDirection: "Visual direction",
  colorPalette: "Color palette",
  moodTone: "Mood and tone",
  composition: "Composition",
  avoidList: "Avoid",
};

/**
 * Format the style settings as a prompt suffix. Returns an empty string if
 * every field is blank so callers can prepend cleanly.
 */
export function formatImageStyleAsPromptSuffix(
  style: ImageStyleSettings,
): string {
  const parts: string[] = [];
  for (const key of IMAGE_STYLE_KEYS) {
    const value = (style[key] ?? "").trim();
    if (!value) continue;
    parts.push(`${FIELD_LABELS[key]}: ${value}`);
  }
  if (parts.length === 0) return "";
  return `\n\nBrand visual style — apply these consistently:\n${parts.map((p) => `- ${p}`).join("\n")}`;
}

// ============================================================================
// Per-channel style notes (sub-styles)
// ============================================================================

export const STYLE_CHANNELS = [
  "social_carousel",
  "social_post",
  "blog",
  "website",
  "newsletter",
] as const;

export type StyleChannel = (typeof STYLE_CHANNELS)[number];

/** Channels that may carry style/assets, including the general guide. */
export type StyleScope = StyleChannel | "general";

export const CHANNEL_LABELS: Record<StyleScope, string> = {
  general: "General guide",
  social_carousel: "Social — Slides / Carousels",
  social_post: "Social — Posts",
  blog: "Blog",
  website: "Website content",
  newsletter: "Newsletter",
};

export function isStyleChannel(value: string): value is StyleChannel {
  return (STYLE_CHANNELS as readonly string[]).includes(value);
}

export function isStyleScope(value: string): value is StyleScope {
  return value === "general" || isStyleChannel(value);
}

export type ChannelNotes = Record<StyleChannel, string>;

export const EMPTY_CHANNEL_NOTES: ChannelNotes = {
  social_carousel: "",
  social_post: "",
  blog: "",
  website: "",
  newsletter: "",
};
