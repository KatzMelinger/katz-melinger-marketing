/**
 * GET  /api/content/pipeline?status=idea&bucket=money_page
 *   → { items: [...], stats: { total, byStatus, byBucket } }
 *
 * POST /api/content/pipeline
 *   body: { title, keywords?, location?, status?, bucket?, notes?, url?, draftId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

const VALID_STATUSES = ["idea", "brief", "draft", "review", "published"] as const;
const VALID_BUCKETS = ["money_page", "bofu_education", "mofu_trust", "local_authority"] as const;

type PipelineRow = {
  id: number;
  title: string;
  keywords: string | null;
  location: string | null;
  status: string;
  bucket: string;
  notes: string | null;
  url: string | null;
  draft_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const bucket = searchParams.get("bucket");

  if (status && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }
  if (bucket && !VALID_BUCKETS.includes(bucket as (typeof VALID_BUCKETS)[number])) {
    return NextResponse.json({ error: "Invalid bucket filter" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("content_pipeline")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const all = (data ?? []) as PipelineRow[];

  let filtered = all;
  if (status) filtered = filtered.filter((i) => i.status === status);
  if (bucket) filtered = filtered.filter((i) => i.bucket === bucket);

  const stats = {
    total: all.length,
    byStatus: Object.fromEntries(
      VALID_STATUSES.map((s) => [s, all.filter((i) => i.status === s).length]),
    ) as Record<string, number>,
    byBucket: Object.fromEntries(
      VALID_BUCKETS.map((b) => [b, all.filter((i) => i.bucket === b).length]),
    ) as Record<string, number>,
  };

  return NextResponse.json({ items: filtered, stats });
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

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("content_pipeline")
    .insert({
      title,
      keywords: body?.keywords?.trim() || null,
      location: body?.location?.trim() || null,
      status,
      bucket,
      notes: body?.notes?.trim() || null,
      url: body?.url?.trim() || null,
      draft_id: body?.draftId ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
