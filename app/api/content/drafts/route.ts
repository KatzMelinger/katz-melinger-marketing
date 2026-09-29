/**
 * GET  /api/content/drafts          — list recent drafts (paginated)
 *   query: ?format=blog|linkedin|...&limit=50&offset=0&q=search
 *   limit defaults to 50 (max 500). q matches title, topic or body
 *   (case-insensitive substring). Returns { drafts, total, offset, limit, hasMore }.
 *
 * POST /api/content/drafts          — manually create / autosave a draft
 *   body: { format, topic, title?, body, metadata?, practiceArea?, seoBrief?, sourceId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";
import { findExistingContent, duplicateMessage } from "@/lib/content-dedup";

export const runtime = "nodejs";

// Max rows per page. Callers wanting everything page through with `offset`
// until they have `total` rows (the Content Studio does exactly that).
const MAX_LIMIT = 500;

/**
 * Make a free-text search safe to embed in a PostgREST `or=(...)` filter.
 * Commas, parentheses, quotes and colons are filter-syntax characters there;
 * `*` and `%` are wildcards; backslash is the LIKE escape. None of them matter
 * for matching a draft title, so they become spaces rather than being escaped.
 */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()"'*%:\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const format = searchParams.get("format");
  const rawLimit = Number(searchParams.get("limit") ?? "50");
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50, MAX_LIMIT));
  const rawOffset = Number(searchParams.get("offset") ?? "0");
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  const search = sanitizeSearch(searchParams.get("q") ?? "");

  const { supabase } = await getTenantClient();
  let q = supabase
    .from("content_drafts")
    .select(
      "id, batch_id, format, template, topic, practice_area, title, body, metadata, status, created_at, updated_at",
      { count: "exact" },
    )
    // id as a tiebreaker so offset paging is stable when created_at collides.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (format) q = q.eq("format", format);
  if (search) {
    // Title and topic are what people search by; body catches a phrase that
    // only appears in the text. A plain substring match on ~hundreds of rows.
    const pat = `*${search}*`;
    q = q.or(`title.ilike.${pat},topic.ilike.${pat},body.ilike.${pat}`);
  }

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const drafts = data ?? [];
  const total = count ?? drafts.length;
  return NextResponse.json({
    drafts,
    total,
    offset,
    limit,
    hasMore: offset + drafts.length < total,
  });
}

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (!body?.format || !body?.topic || !body?.body) {
    return NextResponse.json({ error: "format, topic, body required" }, { status: 400 });
  }
  const { supabase, tenantId } = await getTenantClient();

  // Duplicate guard (override with { force: true }).
  if (body?.force !== true) {
    const dup = await findExistingContent({ tenantId, keyword: body.topic || body.title || "" });
    if (dup) {
      return NextResponse.json(
        { error: duplicateMessage(dup), duplicate: true, existing: dup },
        { status: 409 },
      );
    }
  }

  const { data, error } = await supabase
    .from("content_drafts")
    .insert({
      format: body.format,
      template: body.template ?? null,
      topic: body.topic,
      title: body.title ?? null,
      body: body.body,
      metadata: body.metadata ?? {},
      practice_area: body.practiceArea ?? null,
      seo_brief: body.seoBrief ?? null,
      source_id: body.sourceId ?? null,
      tenant_id: tenantId,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
