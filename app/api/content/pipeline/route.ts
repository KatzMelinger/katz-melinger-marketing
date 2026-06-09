/**
 * GET  /api/content/pipeline?status=idea&bucket=money_page&content_type=website
 *   → { items: [...], stats: { total, byStatus, byBucket } }
 *
 * POST /api/content/pipeline
 *   body: { title, keywords?, location?, status?, bucket?, notes?, url?, draftId?,
 *           ownerUserId? }
 *
 * Items include owner info (joined from app_users) and status_updated_at so the
 * UI can show "in Review since 5/12" without conflating that with the
 * touch-every-edit updated_at column.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

const VALID_STATUSES = ["idea", "brief", "draft", "review", "published"] as const;
const VALID_BUCKETS = ["money_page", "bofu_education", "mofu_trust", "local_authority"] as const;
const VALID_CONTENT_TYPES = ["website", "social", "email"] as const;

type PipelineRow = {
  id: number;
  title: string;
  keywords: string | null;
  location: string | null;
  status: string;
  bucket: string;
  content_type: string;
  notes: string | null;
  url: string | null;
  draft_id: string | null;
  owner_user_id: string | null;
  status_updated_at: string;
  created_at: string;
  updated_at: string;
};

type OwnerRow = { user_id: string; email: string };

/**
 * Merge owner email onto each pipeline row so the UI can render the name
 * without a second round-trip. We do this in app code instead of a Postgres
 * join because app_users lives behind a separate FK and supabase-js's join
 * syntax is verbose for this case.
 */
function attachOwners(
  rows: PipelineRow[],
  owners: OwnerRow[],
): Array<PipelineRow & { owner_email: string | null }> {
  const map = new Map(owners.map((o) => [o.user_id, o.email]));
  return rows.map((r) => ({
    ...r,
    owner_email: r.owner_user_id ? (map.get(r.owner_user_id) ?? null) : null,
  }));
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const bucket = searchParams.get("bucket");
  const contentType = searchParams.get("content_type");

  if (status && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }
  if (bucket && !VALID_BUCKETS.includes(bucket as (typeof VALID_BUCKETS)[number])) {
    return NextResponse.json({ error: "Invalid bucket filter" }, { status: 400 });
  }
  if (
    contentType &&
    !VALID_CONTENT_TYPES.includes(contentType as (typeof VALID_CONTENT_TYPES)[number])
  ) {
    return NextResponse.json({ error: "Invalid content_type filter" }, { status: 400 });
  }

  const { supabase, tenantId } = await getTenantClient();
  const [{ data: pipeData, error: pipeErr }, { data: ownersData }] = await Promise.all([
    supabase
      .from("content_pipeline")
      .select("*")
      .order("updated_at", { ascending: false }),
    supabase.from("app_users").select("user_id, email"),
  ]);
  if (pipeErr) return NextResponse.json({ error: pipeErr.message }, { status: 500 });

  const all = (pipeData ?? []) as PipelineRow[];
  const owners = (ownersData ?? []) as OwnerRow[];

  let filtered = all;
  if (status) filtered = filtered.filter((i) => i.status === status);
  if (bucket) filtered = filtered.filter((i) => i.bucket === bucket);
  if (contentType) filtered = filtered.filter((i) => i.content_type === contentType);

  const stats = {
    total: all.length,
    byStatus: Object.fromEntries(
      VALID_STATUSES.map((s) => [s, all.filter((i) => i.status === s).length]),
    ) as Record<string, number>,
    byBucket: Object.fromEntries(
      VALID_BUCKETS.map((b) => [b, all.filter((i) => i.bucket === b).length]),
    ) as Record<string, number>,
  };

  return NextResponse.json({ items: attachOwners(filtered, owners), stats });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = (body?.title as string | undefined)?.trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const status = VALID_STATUSES.includes(body?.status as (typeof VALID_STATUSES)[number])
    ? body.status
    : "idea";
  const bucket = VALID_BUCKETS.includes(body?.bucket as (typeof VALID_BUCKETS)[number])
    ? body.bucket
    : "bofu_education";
  const contentType = VALID_CONTENT_TYPES.includes(
    body?.contentType as (typeof VALID_CONTENT_TYPES)[number],
  )
    ? body.contentType
    : "website";

  const ownerUserId =
    typeof body?.ownerUserId === "string" && body.ownerUserId.trim()
      ? body.ownerUserId.trim()
      : null;

  const { supabase, tenantId } = await getTenantClient();
  const { data, error } = await supabase
    .from("content_pipeline")
    .insert({
      title,
      keywords: body?.keywords?.trim() || null,
      location: body?.location?.trim() || null,
      status,
      bucket,
      content_type: contentType,
      notes: body?.notes?.trim() || null,
      url: body?.url?.trim() || null,
      draft_id: body?.draftId ?? null,
      owner_user_id: ownerUserId,
      tenant_id: tenantId,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
