/**
 * /api/brand-voice/avatars
 *   GET    — list all target-audience avatars
 *   POST   — create one. Body: { name, role?, description? }
 *   DELETE — remove one. Body: { id }
 *
 * Avatars represent target client personas. They feed lib/firm-context.ts
 * so the AI keyword research routes know who the firm wants to attract.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

const MAX_NAME = 100;
const MAX_ROLE = 200;
const MAX_DESC = 2000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const body = await req.json().catch(() => ({}));
    const { name, role, description } = body || {};

    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (name.length > MAX_NAME) {
      return NextResponse.json(
        { error: `name must be under ${MAX_NAME} characters` },
        { status: 400 },
      );
    }
    if (role !== undefined && role !== null && role !== "") {
      if (typeof role !== "string") {
        return NextResponse.json({ error: "role must be a string" }, { status: 400 });
      }
      if (role.length > MAX_ROLE) {
        return NextResponse.json(
          { error: `role must be under ${MAX_ROLE} characters` },
          { status: 400 },
        );
      }
    }
    if (description !== undefined && description !== null && description !== "") {
      if (typeof description !== "string") {
        return NextResponse.json(
          { error: "description must be a string" },
          { status: 400 },
        );
      }
      if (description.length > MAX_DESC) {
        return NextResponse.json(
          { error: `description must be under ${MAX_DESC} characters` },
          { status: 400 },
        );
      }
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("brand_voice_avatars")
      .insert({
        name: name.trim(),
        role: typeof role === "string" && role !== "" ? role : null,
        description:
          typeof description === "string" && description !== "" ? description : null,
      })
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
