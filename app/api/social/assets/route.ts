/**
 * POST /api/social/assets — multipart upload for the social composer.
 *   Field `files`: one or more images (png/jpeg/webp) or MP4 videos.
 *
 * Stores each in Supabase Storage and returns a signed URL per file. The
 * composer pushes those URLs into the variation's mediaUrls, which flow to
 * Ayrshare's mediaUrls at publish (URL only — no UI automation).
 *
 * Mirrors the multipart pattern in app/api/images/style/assets/route.ts.
 */

import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";

import {
  ALLOWED_SOCIAL_TYPES,
  MAX_SOCIAL_ASSET_BYTES,
  isAllowedSocialType,
  saveSocialAsset,
  type SocialAsset,
} from "@/lib/social-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart form data." },
      { status: 400 },
    );
  }

  const files = form
    .getAll("files")
    .filter((v): v is File => typeof File !== "undefined" && v instanceof File);

  if (!files.length) {
    return NextResponse.json(
      {
        error: `No files uploaded. Attach an image or MP4 (${ALLOWED_SOCIAL_TYPES.join(", ")}).`,
      },
      { status: 400 },
    );
  }

  const uploaded: SocialAsset[] = [];
  const failures: Array<{ filename: string; error: string }> = [];

  for (const file of files) {
    if (!isAllowedSocialType(file.type)) {
      failures.push({
        filename: file.name,
        error: `Unsupported type. Allowed: ${ALLOWED_SOCIAL_TYPES.join(", ")}.`,
      });
      continue;
    }
    if (file.size > MAX_SOCIAL_ASSET_BYTES) {
      failures.push({
        filename: file.name,
        error: `Too large (max ${Math.round(MAX_SOCIAL_ASSET_BYTES / (1024 * 1024))}MB).`,
      });
      continue;
    }
    try {
      const arr = await file.arrayBuffer();
      const saved = await saveSocialAsset({
        bytes: new Uint8Array(Buffer.from(arr)),
        filename: file.name,
        contentType: file.type,
      });
      uploaded.push(saved);
    } catch (e) {
      failures.push({
        filename: file.name,
        error: e instanceof Error ? e.message : "Failed to process file.",
      });
    }
  }

  const status = uploaded.length > 0 ? 200 : 400;
  return NextResponse.json(
    { ok: uploaded.length > 0, uploaded, failures },
    { status },
  );
}
