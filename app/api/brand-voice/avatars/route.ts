/**
 * /api/brand-voice/avatars
 *   GET    — list all target-audience avatars
 *   POST   — create one. Body: { name, role?, description?, demographics?,
 *            painPoints?, goals?, channels? }
 *   PATCH  — update one. Body: { id, ...same fields }
 *   DELETE — remove one. Body: { id }
 *
 * Avatars represent target client personas. They feed lib/firm-context.ts
 * so the AI keyword research and content drafting routes know who the firm
 * wants to attract.
 *
 * The richer fields (demographics, pain_points, goals, channels) require
 * the supabase/brand_voice_v2_schema.sql migration.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

const MAX_NAME = 100;
const MAX_ROLE = 200;
const MAX_LONG = 40000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AvatarPayload = {
  name?: unknown;
  role?: unknown;
  description?: unknown;
  demographics?: unknown;
  painPoints?: unknown;
  goals?: unknown;
  channels?: unknown;
};

function normalizeString(
  value: unknown,
  max: number,
  field: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string` };
  if (value.length > max) return { ok: false, error: `${field} must be under ${max} characters` };
  return { ok: true, value };
}

function buildRow(
  body: AvatarPayload,
): { ok: true; row: Record<string, string | null> } | { ok: false; error: string } {
  const row: Record<string, string | null> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return { ok: false, error: "name is required" };
    }
    if (body.name.length > MAX_NAME) {
      return { ok: false, error: `name must be under ${MAX_NAME} characters` };
    }
    row.name = body.name.trim();
  }

  const checks: { key: string; col: string; max: number }[] = [
    { key: "role", col: "role", max: MAX_ROLE },
    { key: "description", col: "description", max: MAX_LONG },
    { key: "demographics", col: "demographics", max: MAX_LONG },
    { key: "painPoints", col: "pain_points", max: MAX_LONG },
    { key: "goals", col: "goals", max: MAX_LONG },
    { key: "channels", col: "channels", max: MAX_LONG },
  ];

  for (const c of checks) {
    if ((body as Record<string, unknown>)[c.key] === undefined) continue;
    const r = normalizeString((body as Record<string, unknown>)[c.key], c.max, c.key);
    if (!r.ok) return { ok: false, error: r.error };
    row[c.col] = r.value;
  }

  return { ok: true, row };
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("brand_voice_avatars")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[brand-voice/avatars GET] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to load avatars" }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (err: any) {
    console.error("[brand-voice/avatars GET] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to load avatars" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as AvatarPayload;
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const built = buildRow(body);
    if (!built.ok) {
      return NextResponse.json({ error: built.error }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("brand_voice_avatars")
      .insert(built.row)
      .select()
      .single();

    if (error) {
      console.error("[brand-voice/avatars POST] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to add avatar" }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (err: any) {
    console.error("[brand-voice/avatars POST] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to add avatar" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as AvatarPayload & { id?: unknown };
    if (typeof body.id !== "string" || !UUID_RE.test(body.id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const built = buildRow(body);
    if (!built.ok) {
      return NextResponse.json({ error: built.error }, { status: 400 });
    }
    if (Object.keys(built.row).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }
    built.row.updated_at = new Date().toISOString();

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("brand_voice_avatars")
      .update(built.row)
      .eq("id", body.id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[brand-voice/avatars PATCH] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to update avatar" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("[brand-voice/avatars PATCH] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to update avatar" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id } = body || {};

    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("brand_voice_avatars")
      .delete()
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[brand-voice/avatars DELETE] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to delete avatar" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error("[brand-voice/avatars DELETE] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to delete avatar" }, { status: 500 });
  }
}
