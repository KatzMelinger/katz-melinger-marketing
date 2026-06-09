/**
 * Server-only Supabase reads/writes for the image-style guide + per-channel
 * notes. Split out of lib/image-style.ts so the pure constants there stay
 * importable from client components (this module pulls in next/headers via the
 * tenant client and must never reach the browser bundle).
 */

import { getTenantClient } from "@/lib/tenant-db";
import {
  IMAGE_STYLE_KEYS,
  EMPTY_IMAGE_STYLE,
  EMPTY_CHANNEL_NOTES,
  CHANNEL_LABELS,
  formatImageStyleAsPromptSuffix,
  isStyleChannel,
  type ImageStyleSettings,
  type ImageStyleKey,
  type ChannelNotes,
  type StyleChannel,
  type StyleScope,
} from "@/lib/image-style";

export async function loadImageStyle(): Promise<ImageStyleSettings> {
  try {
    const { supabase: sb } = await getTenantClient();
    const { data, error } = await sb
      .from("image_style_settings")
      .select("key, value");
    if (error || !data) return { ...EMPTY_IMAGE_STYLE };
    const out: ImageStyleSettings = { ...EMPTY_IMAGE_STYLE };
    for (const row of data) {
      const key = row.key as string;
      if ((IMAGE_STYLE_KEYS as readonly string[]).includes(key)) {
        out[key as ImageStyleKey] =
          typeof row.value === "string" ? row.value : "";
      }
    }
    return out;
  } catch {
    return { ...EMPTY_IMAGE_STYLE };
  }
}

export async function saveImageStyle(
  patch: Partial<ImageStyleSettings>,
): Promise<ImageStyleSettings> {
  const { supabase: sb, tenantId } = await getTenantClient();
  const rows = Object.entries(patch)
    .filter(([key]) => (IMAGE_STYLE_KEYS as readonly string[]).includes(key))
    .map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : "",
      updated_at: new Date().toISOString(),
      tenant_id: tenantId,
    }));
  if (rows.length === 0) return loadImageStyle();
  const { error } = await sb
    .from("image_style_settings")
    .upsert(rows, { onConflict: "tenant_id,key" });
  if (error) throw new Error(error.message);
  return loadImageStyle();
}

export async function loadChannelNotes(): Promise<ChannelNotes> {
  try {
    const { supabase: sb } = await getTenantClient();
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
  const { supabase: sb, tenantId } = await getTenantClient();
  const { error } = await sb.from("image_style_channels").upsert(
    {
      channel,
      notes: typeof notes === "string" ? notes : "",
      updated_at: new Date().toISOString(),
      tenant_id: tenantId,
    },
    { onConflict: "tenant_id,channel" },
  );
  if (error) throw new Error(error.message);
  return loadChannelNotes();
}

/**
 * Build the full prompt suffix for a generation in a given scope: the general
 * 5-field guide, plus the selected channel's notes (if any).
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
