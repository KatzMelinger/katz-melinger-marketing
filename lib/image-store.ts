/**
 * Persist a generated/edited image to Supabase storage + the
 * `generated_images` table. Shared by /api/images/generate and
 * /api/images/edit.
 *
 * - Bytes go to the `generated-images` bucket under a UUID-based path.
 * - A row in `generated_images` records the prompt + storage path + lineage.
 *
 * Returns the saved row (with `public_url`) so callers can return it to the
 * browser straight away.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getTenantClient } from "@/lib/tenant-db";

export type SavedImage = {
  id: string;
  prompt: string;
  size: string;
  quality: string;
  storage_path: string;
  public_url: string;
  parent_image_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

const BUCKET = "generated-images";

export async function saveImagePng(opts: {
  bytes: Uint8Array;
  prompt: string;
  size: string;
  quality: string;
  parentImageId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<SavedImage> {
  const sb = getSupabaseAdmin();
  const id = crypto.randomUUID();
  const yyyymm = new Date().toISOString().slice(0, 7); // 2026-05 — keeps paths shardable
  const path = `${yyyymm}/${id}.png`;

  const { error: uploadError } = await sb.storage
    .from(BUCKET)
    .upload(path, opts.bytes, {
      contentType: "image/png",
      upsert: false,
    });
  if (uploadError) {
    throw new Error(`storage upload failed: ${uploadError.message}`);
  }

  const { data: publicData } = sb.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = publicData.publicUrl;

  // Table write goes through the tenant client (RLS-enforced + stamped); the
  // storage upload above stays on the service-role client.
  const { supabase: db, tenantId } = await getTenantClient();
  const { data, error } = await db
    .from("generated_images")
    .insert({
      id,
      prompt: opts.prompt,
      size: opts.size,
      quality: opts.quality,
      storage_path: path,
      public_url: publicUrl,
      parent_image_id: opts.parentImageId ?? null,
      metadata: opts.metadata ?? {},
      tenant_id: tenantId,
    })
    .select("*")
    .maybeSingle();

  if (error || !data) {
    // Best-effort cleanup so storage doesn't accumulate orphaned objects.
    await sb.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error(`db insert failed: ${error?.message ?? "no row returned"}`);
  }

  return data as SavedImage;
}

/**
 * Fetch the PNG bytes for a stored image, used by /api/images/edit before
 * forwarding the source to OpenAI's edit endpoint.
 */
export async function readImageBytes(storagePath: string): Promise<Uint8Array> {
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

export async function deleteSavedImage(id: string): Promise<void> {
  // Table read/delete are tenant-scoped (RLS); storage removal uses service-role.
  const { supabase: db } = await getTenantClient();
  const { data: row, error: readError } = await db
    .from("generated_images")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    throw new Error(`db read failed: ${readError.message}`);
  }
  if (!row) return;

  await getSupabaseAdmin().storage.from(BUCKET).remove([row.storage_path as string]);
  await db.from("generated_images").delete().eq("id", id);
}
