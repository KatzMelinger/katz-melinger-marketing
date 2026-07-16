/**
 * Manually-uploaded media for the social composer (Metricool-style upload).
 *
 * The marketer drags an image or short video into a platform tab; the bytes are
 * stored and a URL is returned. That URL flows into the variation's mediaUrls
 * and, at publish, into Ayrshare's mediaUrls field — the same path the generated
 * carousel slides already use. We never upload to a network via UI automation;
 * URL only.
 *
 * Bytes live in the EXISTING `generated-images` bucket under a `social-media/`
 * prefix (no new bucket). The bucket is private, so we hand back a long-lived
 * signed URL — Ayrshare fetches it server-side (the same way it fetches the
 * generated carousel slides today). Mirrors lib/image-style-assets.ts.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getTenantClient } from "@/lib/tenant-db";

const BUCKET = "generated-images";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365; // private bucket → long-lived signed URLs

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const ALLOWED_VIDEO_TYPES = ["video/mp4"] as const;
export const ALLOWED_SOCIAL_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
] as const;

// Ayrshare caps vary by network; 100MB is a safe client+server ceiling for a
// single image or short reel/video.
export const MAX_SOCIAL_ASSET_BYTES = 100 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

export function isAllowedSocialType(contentType: string): boolean {
  return (ALLOWED_SOCIAL_TYPES as readonly string[]).includes(contentType);
}

export type SocialAsset = {
  url: string;
  storage_path: string;
  mime: string;
  kind: "image" | "video";
  filename: string;
};

export async function saveSocialAsset(opts: {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}): Promise<SocialAsset> {
  if (!isAllowedSocialType(opts.contentType)) {
    throw new Error(`unsupported file type: ${opts.contentType}`);
  }

  const sb = getSupabaseAdmin();
  // Resolve (and RLS-check) the tenant, and scope the storage path to it.
  const { tenantId } = await getTenantClient();
  const id = crypto.randomUUID();
  const ext = EXT_BY_TYPE[opts.contentType] ?? "bin";
  const path = `${tenantId}/social-media/${id}.${ext}`;

  const { error: uploadError } = await sb.storage
    .from(BUCKET)
    .upload(path, opts.bytes, { contentType: opts.contentType, upsert: false });
  if (uploadError) {
    throw new Error(`storage upload failed: ${uploadError.message}`);
  }

  const { data: signed } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  const url = signed?.signedUrl ?? "";
  if (!url) {
    // Best-effort cleanup so storage doesn't accumulate orphaned objects.
    await sb.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error("could not sign uploaded file");
  }

  const kind = (ALLOWED_VIDEO_TYPES as readonly string[]).includes(opts.contentType)
    ? "video"
    : "image";
  return { url, storage_path: path, mime: opts.contentType, kind, filename: opts.filename };
}
