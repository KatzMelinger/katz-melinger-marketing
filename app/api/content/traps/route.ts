/**
 * GET  /api/content/traps        — the trap list
 * POST /api/content/traps        — run the sweep across every draft
 *        body: { trapId? }  — one trap, or all of them
 * PATCH /api/content/traps       — add or edit a trap
 *        body: { id?, label, matchType, pattern, unless?, severity, note, enabled? }
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

import { scanForTraps, type KnownTrap } from "@/lib/known-traps";
import { getCurrentUser } from "@/lib/supabase-route";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

function rowToTrap(r: any): KnownTrap {
  return {
    id: r.id,
    label: r.label,
    matchType: r.match_type,
    pattern: r.pattern,
    unless: Array.isArray(r.unless) ? r.unless : [],
    severity: r.severity,
    note: r.note,
    enabled: r.enabled !== false,
  };
}

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

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { supabase } = await getTenantClient();
  try {
    return NextResponse.json({ traps: await loadTraps(supabase) });
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

  const body = (await req.json().catch(() => ({}))) as { trapId?: unknown };
  const trapId = typeof body.trapId === "string" ? body.trapId : null;

  const { supabase } = await getTenantClient();
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
    .select("id, title, topic, body, status")
    .not("status", "in", "(archived)");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (drafts ?? []).map((d: any) => ({
    id: d.id as string,
    title: (d.title as string | null)?.trim() || (d.topic as string | null)?.trim() || "Untitled",
    status: d.status as string,
    body: typeof d.body === "string" ? d.body : "",
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
  const label = typeof b.label === "string" ? b.label.trim() : "";
  const pattern = typeof b.pattern === "string" ? b.pattern.trim() : "";
  const note = typeof b.note === "string" ? b.note.trim() : "";
  const matchType = String(b.matchType ?? "all_of");

  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  if (!pattern) return NextResponse.json({ error: "pattern is required" }, { status: 400 });
  // The note is what a reviewer reads when the trap fires — a trap without one
  // is a hit with no explanation, which is worse than no trap at all.
  if (!note) {
    return NextResponse.json(
      { error: "note is required — say what is wrong and what the correct statement is" },
      { status: 400 },
    );
  }
  if (!["phrase", "regex", "all_of", "all_of_unless"].includes(matchType)) {
    return NextResponse.json({ error: "Invalid matchType" }, { status: 400 });
  }
  if (matchType === "regex") {
    try {
      new RegExp(pattern);
    } catch {
      return NextResponse.json({ error: "That regular expression does not compile" }, { status: 400 });
    }
  }

  const { supabase, tenantId } = await getTenantClient();
  const payload = {
    tenant_id: tenantId,
    label,
    match_type: matchType,
    pattern,
    unless: Array.isArray(b.unless) ? (b.unless as string[]).filter((u) => typeof u === "string") : [],
    severity: ["critical", "important", "advisory"].includes(String(b.severity))
      ? String(b.severity)
      : "important",
    note,
    enabled: b.enabled !== false,
    updated_at: new Date().toISOString(),
  };

  const id = typeof b.id === "string" ? b.id : null;
  const q = id
    ? supabase.from("content_known_traps").update(payload).eq("id", id).select().maybeSingle()
    : supabase.from("content_known_traps").insert(payload).select().maybeSingle();
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trap: data ? rowToTrap(data) : null });
}
