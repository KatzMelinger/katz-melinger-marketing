/**
 * GET  /api/content/traps        — the trap list (?drafts=1 adds the open drafts, for the test picker)
 * POST /api/content/traps        — run the sweep across every draft
 *        body: { trapId? }  — one trap, or all of them
 *        body: { test: <trap fields>, draftId }  — try an UNSAVED trap on one draft
 * PATCH /api/content/traps       — add or edit a trap
 *        body: { id?, label, matchType, pattern, unless?, severity, note, enabled?,
 *                matchOn?, caseSensitive?, regexFlags?, scope?, appliesTo? }
 *        body: { id, enabled }  — enable or disable only
 *
 * B6, "find across all": one list showing every draft that contains a given
 * known trap, so a pattern gets fixed rather than an instance.
 *
 * The sweep is plain text matching over draft bodies — no model call, no
 * retrieval, no knowledge base. It is fast and it is cheap, and it is honest
 * about what it produces: a worklist of drafts to LOOK at, not a list of
 * errors. Most of these patterns match correct writing too.
 */

import { NextRequest, NextResponse } from "next/server";

import { matchTrap, rowToTrap, scanForTraps, type KnownTrap, type TrapContext } from "@/lib/known-traps";
import { getCurrentUser } from "@/lib/supabase-route";
import { hasWebPage } from "@/lib/draft-metadata";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MATCH_TYPES = ["phrase", "regex", "all_of", "all_of_unless", "document", "document_missing"];

async function loadTraps(supabase: any): Promise<KnownTrap[]> {
  const { data, error } = await supabase
    .from("content_known_traps")
    .select("*")
    .order("severity", { ascending: true })
    .order("label", { ascending: true });
  if (error) {
    if (/content_known_traps|does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(rowToTrap);
}

function draftCtx(d: any): TrapContext {
  return {
    title: d.title ?? null,
    topic: d.topic ?? null,
    primaryKeyword: String(d.metadata?.primaryKeyword ?? d.metadata?.km_brief?.primaryKeyword ?? ""),
    isWebPage: hasWebPage(d.format ?? "blog"),
  };
}

/**
 * Validate and normalise the trap form (Oct 6 spec, Task 9). Returns the row
 * to store, or an error a person can act on.
 */
function trapPayload(b: Record<string, unknown>): { row: Record<string, unknown> } | { error: string } {
  const label = typeof b.label === "string" ? b.label.trim() : "";
  const pattern = typeof b.pattern === "string" ? b.pattern.trim() : "";
  const note = typeof b.note === "string" ? b.note.trim() : "";
  const matchType = String(b.matchType ?? "all_of");
  if (!label) return { error: "label is required" };
  if (!pattern) return { error: "pattern is required" };
  // The note is what a reviewer reads when the trap fires — a trap without one
  // is a hit with no explanation, which is worse than no trap at all.
  if (!note) return { error: "note is required — say what is wrong and what the correct statement is" };
  if (!MATCH_TYPES.includes(matchType)) return { error: "Invalid matchType" };

  const matchOn = b.matchOn === "sentences" || b.matchOn === "raw_body" ? b.matchOn : null;
  const regexFlags = typeof b.regexFlags === "string" ? b.regexFlags.replace(/[^imsuy]/g, "") : "";
  const scope = typeof b.scope === "string" && b.scope.trim() ? b.scope.trim() : null;
  if (scope && !/^title_or_keyword_contains:\S/.test(scope)) {
    return { error: 'scope must look like "title_or_keyword_contains:harass"' };
  }
  const isRegex =
    matchType === "regex" ||
    matchType === "document_missing" ||
    matchOn === "raw_body" ||
    (matchType === "document" && !pattern.startsWith("["));
  if (isRegex) {
    try {
      new RegExp(pattern, regexFlags);
    } catch {
      return { error: "That regular expression does not compile" };
    }
  }
  const unless = Array.isArray(b.unless)
    ? (b.unless as unknown[]).filter((u): u is string => typeof u === "string" && u.trim().length > 0).map((u) => u.trim())
    : typeof b.unless === "string"
      ? b.unless.split(/[,\n]/).map((u) => u.trim()).filter(Boolean)
      : [];

  return {
    row: {
      label,
      match_type: matchType,
      pattern,
      unless,
      severity: ["critical", "important", "advisory"].includes(String(b.severity)) ? String(b.severity) : "important",
      note,
      enabled: b.enabled !== false,
      match_on: matchOn,
      case_sensitive: b.caseSensitive === true,
      regex_flags: regexFlags || null,
      scope,
      applies_to: b.appliesTo === "web" ? "web" : "all",
    },
  };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase } = await getTenantClient();
  try {
    const traps = await loadTraps(supabase);
    if (req.nextUrl.searchParams.get("drafts") !== "1") return NextResponse.json({ traps });
    const { data } = await supabase
      .from("content_drafts")
      .select("id, title, topic, status")
      .not("status", "in", "(archived)")
      .order("updated_at", { ascending: false })
      .limit(500);
    return NextResponse.json({
      traps,
      drafts: (data ?? []).map((d: any) => ({
        id: d.id,
        title: d.title?.trim() || d.topic?.trim() || "Untitled",
        status: d.status,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load traps" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { trapId?: unknown; test?: unknown; draftId?: unknown };
  const trapId = typeof body.trapId === "string" ? body.trapId : null;

  const { supabase } = await getTenantClient();

  // "Test against a draft": see what an unsaved trap catches before saving it.
  if (body.test && typeof body.test === "object") {
    if (typeof body.draftId !== "string") {
      return NextResponse.json({ error: "Pick a draft to test against" }, { status: 400 });
    }
    const parsed = trapPayload(body.test as Record<string, unknown>);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { data: d, error: dErr } = await supabase
      .from("content_drafts")
      .select("id, title, topic, body, format, metadata")
      .eq("id", body.draftId)
      .maybeSingle();
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
    if (!d) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    const trap = rowToTrap({ id: "test", ...parsed.row, enabled: true });
    const hits = matchTrap(trap, typeof d.body === "string" ? d.body : "", draftCtx(d));
    return NextResponse.json({ hits: hits.map((h) => h.excerpt) });
  }

  let traps: KnownTrap[];
  try {
    traps = await loadTraps(supabase);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load traps" },
      { status: 500 },
    );
  }
  if (traps.length === 0) {
    return NextResponse.json({
      results: [],
      draftsScanned: 0,
      note: "No traps configured. Run supabase/content_known_traps_schema.sql to seed them.",
    });
  }
  const selected = trapId ? traps.filter((t) => t.id === trapId) : traps;

  // Archived drafts are excluded: a trap sitting in something nobody will
  // publish is not a worklist item, and including them would make the counts
  // look worse than the actual exposure.
  const { data: drafts, error } = await supabase
    .from("content_drafts")
    .select("id, title, topic, body, status, format, metadata")
    .not("status", "in", "(archived)");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (drafts ?? []).map((d: any) => ({
    id: d.id as string,
    title: (d.title as string | null)?.trim() || (d.topic as string | null)?.trim() || "Untitled",
    status: d.status as string,
    body: typeof d.body === "string" ? d.body : "",
    ctx: draftCtx(d),
  }));

  const results = scanForTraps(selected, rows);
  return NextResponse.json({
    results,
    draftsScanned: rows.length,
    trapsRun: selected.length,
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { supabase, tenantId } = await getTenantClient();

  // Enable / disable only, without resending the whole trap.
  if (typeof b.id === "string" && Object.keys(b).every((k) => k === "id" || k === "enabled")) {
    const { data, error } = await supabase
      .from("content_known_traps")
      .update({ enabled: b.enabled !== false, updated_at: new Date().toISOString() })
      .eq("id", b.id)
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ trap: data ? rowToTrap(data) : null });
  }

  const parsed = trapPayload(b);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const payload = { tenant_id: tenantId, ...parsed.row, updated_at: new Date().toISOString() };

  const id = typeof b.id === "string" ? b.id : null;
  const q = id
    ? supabase.from("content_known_traps").update(payload).eq("id", id).select().maybeSingle()
    : supabase.from("content_known_traps").insert(payload).select().maybeSingle();
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trap: data ? rowToTrap(data) : null });
}
