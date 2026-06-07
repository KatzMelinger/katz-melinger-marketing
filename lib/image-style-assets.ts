/**
 * Uploaded design-reference files for the brand image style, per channel.
 *
 * Real on-brand examples (PNG/JPEG/WEBP) the marketer uploads on
 * /content/images/style. When a channel has assets, /api/images/generate
 * forwards them to gpt-image-1's edits endpoint as visual references so output
 * matches the look.
 *
 * Bytes live in the EXISTING `generated-images` bucket under a
 * `style-references/<channel>/` prefix (no new bucket needed); pointers +
 * metadata are recorded in the `image_style_assets` table. Mirrors the upload
 * → getPublicUrl → insert pattern in lib/image-store.ts.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getTenantClient } from "@/lib/tenant-db";
import { isStyleScope, type StyleScope } from "@/lib/image-style";

const BUCKET = "generated-images";

export type StyleAsset = {
  id: string;
  channel: string;
  storage_path: string;
  public_url: string;
  filename: string | null;
  content_type: string | null;
  created_at: string;
};

export const ALLOWED_ASSET_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function isAllowedAssetType(contentType: string): boolean {
  return (ALLOWED_ASSET_TYPES as readonly string[]).includes(contentType);
}

export async function saveStyleAsset(opts: {
  channel: StyleScope;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}): Promise<StyleAsset> {
  if (!isStyleScope(opts.channel)) {
    throw new Error(`invalid channel: ${opts.channel}`);
  }
  if (!isAllowedAssetType(opts.contentType)) {
    throw new Error(`unsupported file type: ${opts.contentType}`);
  }

  const sb = getSupabaseAdmin();
  const id = crypto.randomUUID();
  const ext = EXT_BY_TYPE[opts.contentType] ?? "png";
  const path = `style-references/${opts.channel}/${id}.${ext}`;

  const { error: uploadError } = await sb.storage
    .from(BUCKET)
    .upload(path, opts.bytes, {
      contentType: opts.contentType,
      upsert: false,
    });
  if (uploadError) {
    throw new Error(`storage upload failed: ${uploadError.message}`);
  }

  const { data: publicData } = sb.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = publicData.publicUrl;

  const { supabase: db, tenantId } = await getTenantClient();
  const { data, error } = await db
    .from("image_style_assets")
    .insert({
      id,
      channel: opts.channel,
      storage_path: path,
      public_url: publicUrl,
      filename: opts.filename,
      content_type: opts.contentType,
      tenant_id: tenantId,
    })
    .select("*")
    .maybeSingle();

  if (error || !data) {
    // Best-effort cleanup so storage doesn't accumulate orphaned objects.
    await sb.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error(`db insert failed: ${error?.message ?? "no row returned"}`);
  }

  return data as StyleAsset;
}

export async function listStyleAssets(
  channel?: StyleScope,
): Promise<StyleAsset[]> {
  const { supabase: sb } = await getTenantClient();
  let query = sb
    .from("image_style_assets")
    .select("*")
    .order("created_at", { ascending: false });
  if (channel) query = query.eq("channel", channel);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as StyleAsset[];
}

export async function deleteStyleAsset(id: string): Promise<void> {
  const { supabase: db } = await getTenantClient();
  const { data: row, error: readError } = await db
    .from("image_style_assets")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    throw new Error(`db read failed: ${readError.message}`);
  }
  if (!row) return;

  await getSupabaseAdmin().storage.from(BUCKET).remove([row.storage_path as string]);
  await db.from("image_style_assets").delete().eq("id", id);
}

/**
 * Download the raw bytes for a stored asset, used by /api/images/generate to
 * forward design references to OpenAI's edits endpoint.
 */
export async function readStyleAssetBytes(
  storagePath: string,
): Promise<Uint8Array> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(
      `storage download failed: ${error?.message ?? "not found"}`,
    );
  }
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}
