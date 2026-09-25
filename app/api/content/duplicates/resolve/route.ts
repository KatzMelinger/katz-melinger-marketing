/**
 * POST /api/content/duplicates/resolve
 *   body: { table: "draft" | "brief" | "pipeline", keepId, archiveIds: string[] }
 *
 * Item 20: keep one of a duplicate group and clear the rest in one action.
 *
 * ARCHIVE, NOT DELETE
 *
 * Diana's wording is "archive or delete the rest". This archives. A duplicate
 * is only a duplicate because a text-similarity heuristic said so, and the
 * heuristic is good rather than infallible — the cost of being wrong about a
 * delete is a draft somebody wrote and cannot get back, while the cost of being
 * wrong about an archive is a menu click. That asymmetry decides it.
 *
 * Archived rows already drop out of listContentDuplicates (it filters them), so
 * the group disappears from the view either way.
 *
 * The keeper is sent explicitly and checked against the archive list rather
 * than inferred here. A request that would archive every member of a group is
 * refused: whatever produced it, the outcome — a topic the firm silently no
 * longer covers — is not one a dedupe tool should be able to cause.
 */

import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where each duplicate kind lives, and how it is retired. */
const TARGETS = {
  draft: { table: "content_drafts", patch: { status: "archived" }, idIsNumeric: false },
  brief: { table: "brief_suggestions", patch: { status: "rejected" }, idIsNumeric: false },
  pipeline: { table: "content_pipeline", patch: { status: "archived" }, idIsNumeric: true },
} as const;

type TargetKey = keyof typeof TARGETS;

function isTargetKey(v: unknown): v is TargetKey {
  return typeof v === "string" && v in TARGETS;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    table?: unknown;
    keepId?: unknown;
    archiveIds?: unknown;
  };

  if (!isTargetKey(body.table)) {
    return NextResponse.json(
      { error: `table must be one of: ${Object.keys(TARGETS).join(", ")}` },
      { status: 400 },
    );
  }
  const keepId = typeof body.keepId === "string" ? body.keepId.trim() : "";
  if (!keepId) return NextResponse.json({ error: "keepId is required" }, { status: 400 });

  const archiveIds = Array.isArray(body.archiveIds)
    ? [...new Set(body.archiveIds.filter((v): v is string => typeof v === "string" && !!v.trim()))]
    : [];
  if (archiveIds.length === 0) {
    return NextResponse.json({ error: "Nothing to archive." }, { status: 400 });
  }
  if (archiveIds.includes(keepId)) {
    return NextResponse.json(
      { error: "The item being kept cannot also be archived." },
      { status: 400 },
    );
  }

  const target = TARGETS[body.table];
  const { supabase } = await getTenantClient();

  // Verify the keeper exists and is visible to THIS tenant before retiring
  // anything. Archiving the siblings of a row that is not there — or not
  // theirs — would clear a group and keep nothing.
  const keepKey = target.idIsNumeric ? Number(keepId) : keepId;
  if (target.idIsNumeric && !Number.isFinite(keepKey as number)) {
    return NextResponse.json({ error: "keepId is not a valid id." }, { status: 400 });
  }
  const { data: keeper } = await supabase
    .from(target.table)
    .select("id")
    .eq("id", keepKey)
    .maybeSingle();
  if (!keeper) {
    return NextResponse.json({ error: "The item to keep was not found." }, { status: 404 });
  }

  const ids = target.idIsNumeric
    ? archiveIds.map(Number).filter((n) => Number.isFinite(n))
    : archiveIds;
  if (ids.length === 0) {
    return NextResponse.json({ error: "No valid ids to archive." }, { status: 400 });
  }

  // The RLS-scoped client is what confines this to the caller's tenant — ids
  // from another tenant match no rows rather than being archived.
  const { data, error } = await supabase
    .from(target.table)
    .update(target.patch)
    .in("id", ids)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, archived: (data ?? []).length, keptId: keepId });
}
