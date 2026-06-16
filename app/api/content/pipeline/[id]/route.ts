/**
 * PATCH  /api/content/pipeline/[id]   — update any subset of fields
 * DELETE /api/content/pipeline/[id]   — remove
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

const VALID_STATUSES = [
  "idea",
  "brief",
  "draft",
  "review",
  "needs_legal",
  "approved",
  "published",
] as const;
const VALID_BUCKETS = ["money_page", "bofu_education", "mofu_trust", "local_authority"] as const;
const VALID_CONTENT_TYPES = ["website", "social", "email"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardUser();
  if (denied) return denied;
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (typeof body?.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    patch.title = title;
  }
  if (typeof body?.status === "string") {
    if (!VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (typeof body?.bucket === "string") {
    if (!VALID_BUCKETS.includes(body.bucket as (typeof VALID_BUCKETS)[number])) {
      return NextResponse.json({ error: "Invalid bucket" }, { status: 400 });
    }
    patch.bucket = body.bucket;
  }
  if (typeof body?.contentType === "string") {
    if (
      !VALID_CONTENT_TYPES.includes(
        body.contentType as (typeof VALID_CONTENT_TYPES)[number],
      )
    ) {
      return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
    }
    patch.content_type = body.contentType;
  }
  for (const key of ["keywords", "location", "notes", "url"] as const) {
    if (key in (body ?? {})) {
      const v = body[key];
      patch[key] = typeof v === "string" ? v.trim() || null : null;
    }
  }
  if ("draftId" in (body ?? {})) {
    patch.draft_id = body.draftId ?? null;
  }
  // ownerUserId: explicit null clears, a valid string assigns, anything else
  // (undefined / wrong shape) leaves the column alone.
  if ("ownerUserId" in (body ?? {})) {
    const v = body.ownerUserId;
    if (v === null || v === "") {
      patch.owner_user_id = null;
    } else if (typeof v === "string" && v.trim()) {
      patch.owner_user_id = v.trim();
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("content_pipeline")
    .update(patch)
    .eq("id", numericId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardUser();
  if (denied) return denied;
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const { supabase, tenantId } = await getTenantClient();
  const { error } = await supabase
    .from("content_pipeline")
    .delete()
    .eq("id", numericId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
