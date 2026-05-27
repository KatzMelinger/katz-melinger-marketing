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
