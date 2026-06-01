/**
 * GET  /api/images/style/assets?channel=<scope> — list uploaded design
 *      references (optionally scoped to one channel).
 * POST /api/images/style/assets — multipart upload. Fields:
 *      - channel: StyleScope ('general' | 'social_carousel' | ...)
 *      - files:   one or more image files (png/jpeg/webp)
 *
 * Follows the multipart pattern in app/api/content/brand-documents/route.ts.
 */

import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";

import { isStyleScope } from "@/lib/image-style";
import {
  ALLOWED_ASSET_TYPES,
  isAllowedAssetType,
  listStyleAssets,
  saveStyleAsset,
  type StyleAsset,
} from "@/lib/image-style-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const channelParam = req.nextUrl.searchParams.get("channel");
  const channel =
    channelParam && isStyleScope(channelParam) ? channelParam : undefined;
  try {
    const assets = await listStyleAssets(channel);
    return NextResponse.json({ assets });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "load failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

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

  const channelRaw = form.get("channel");
  const channel = typeof channelRaw === "string" ? channelRaw : "";
  if (!isStyleScope(channel)) {
    return NextResponse.json({ error: "invalid channel" }, { status: 400 });
  }

  const files = form
    .getAll("files")
    .filter((v): v is File => typeof File !== "undefined" && v instanceof File);

  if (!files.length) {
    return NextResponse.json(
      {
        error: `No files uploaded. Attach one or more images (${ALLOWED_ASSET_TYPES.join(", ")}).`,
      },
      { status: 400 },
    );
  }

  const uploaded: StyleAsset[] = [];
  const failures: Array<{ filename: string; error: string }> = [];

  for (const file of files) {
    if (!isAllowedAssetType(file.type)) {
      failures.push({
        filename: file.name,
        error: `Unsupported type. Allowed: ${ALLOWED_ASSET_TYPES.join(", ")}.`,
      });
      continue;
    }
    try {
      const arr = await file.arrayBuffer();
      const saved = await saveStyleAsset({
        channel,
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
