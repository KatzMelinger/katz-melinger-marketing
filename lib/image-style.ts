/**
 * Brand-style guide for the image generator. Mirrors lib/firm-context.ts for
 * text content: a single helper reads `image_style_settings` from Supabase
 * and formats it as a prompt suffix that's appended to the user's prompt
 * inside /api/images/generate and /api/images/edit.
 *
 * If the table is empty or unreachable, returns an empty string so generation
 * still works out of the box.
 */

import { getSupabaseServer } from "@/lib/supabase-server";

export const IMAGE_STYLE_KEYS = [
  "visualDirection",
  "colorPalette",
  "moodTone",
  "composition",
  "avoidList",
] as const;

export type ImageStyleKey = (typeof IMAGE_STYLE_KEYS)[number];

export type ImageStyleSettings = Record<ImageStyleKey, string>;

const EMPTY: ImageStyleSettings = {
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

export async function loadImageStyle(): Promise<ImageStyleSettings> {
  const sb = getSupabaseServer();
  if (!sb) return { ...EMPTY };
  try {
    const { data, error } = await sb
      .from("image_style_settings")
      .select("key, value");
    if (error || !data) return { ...EMPTY };
    const out: ImageStyleSettings = { ...EMPTY };
    for (const row of data) {
      const key = row.key as string;
      if ((IMAGE_STYLE_KEYS as readonly string[]).includes(key)) {
        out[key as ImageStyleKey] =
          typeof row.value === "string" ? row.value : "";
      }
    }
    return out;
  } catch {
    return { ...EMPTY };
  }
}

export async function saveImageStyle(
  patch: Partial<ImageStyleSettings>,
): Promise<ImageStyleSettings> {
  const sb = getSupabaseServer();
  if (!sb) return { ...EMPTY, ...patch } as ImageStyleSettings;
  const rows = Object.entries(patch)
    .filter(([key]) => (IMAGE_STYLE_KEYS as readonly string[]).includes(key))
    .map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : "",
      updated_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return loadImageStyle();
  const { error } = await sb
    .from("image_style_settings")
    .upsert(rows, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return loadImageStyle();
}

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
// ----------------------------------------------------------------------------
// The general guide above (the 5 IMAGE_STYLE_KEYS) applies to everything. Each
// channel below layers a free-form notes block on top, stored one-row-per-
// channel in `image_style_channels`. "general" is NOT a channel here — it is
// the key/value guide above.
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

const EMPTY_CHANNEL_NOTES: ChannelNotes = {
  social_carousel: "",
  social_post: "",
  blog: "",
  website: "",
  newsletter: "",
};

export async function loadChannelNotes(): Promise<ChannelNotes> {
  const sb = getSupabaseServer();
  if (!sb) return { ...EMPTY_CHANNEL_NOTES };
  try {
    const { data, error } = await sb
      .from("image_style_channels")
      .select("channel, notes");
    if (error || !data) return { ...EMPTY_CHANNEL_NOTES };
    const out: ChannelNotes = { ...EMPTY_CHANNEL_NOTES };
    for (const row of data) {
      const channel = row.channel as string;
      if (isStyleChannel(channel)) {
        out[channel] = typeof row.notes === "string" ? row.notes : "";
      }
    }
    return out;
  } catch {
    return { ...EMPTY_CHANNEL_NOTES };
  }
}

export async function saveChannelNotes(
  channel: StyleChannel,
  notes: string,
): Promise<ChannelNotes> {
  const sb = getSupabaseServer();
  if (!sb) return { ...EMPTY_CHANNEL_NOTES, [channel]: notes };
  const { error } = await sb.from("image_style_channels").upsert(
    {
      channel,
      notes: typeof notes === "string" ? notes : "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel" },
  );
  if (error) throw new Error(error.message);
  return loadChannelNotes();
}

/**
 * Build the full prompt suffix for a generation in a given scope: the general
 * 5-field guide, plus the selected channel's notes (if any). Returns an empty
 * string when nothing is configured so callers can append cleanly.
 */
export async function composeStyleForGeneration(
  scope: StyleScope,
): Promise<{ promptSuffix: string }> {
  const generalSuffix = formatImageStyleAsPromptSuffix(await loadImageStyle());
  if (scope === "general") return { promptSuffix: generalSuffix };

  const notes = (await loadChannelNotes())[scope]?.trim() ?? "";
  if (!notes) return { promptSuffix: generalSuffix };

  const channelBlock = `\n\n${CHANNEL_LABELS[scope]} — apply these channel-specific notes:\n${notes}`;
  return { promptSuffix: `${generalSuffix}${channelBlock}` };
}
