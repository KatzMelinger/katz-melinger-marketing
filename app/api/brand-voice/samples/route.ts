/**
 * /api/brand-voice/samples
 *   GET    — list all writing samples
 *   POST   — create one. Body: { title, content, contentType, notes? }
 *   DELETE — remove one. Body: { id }
 *
 * Writing samples are example pieces of content for a given content type
 * (Blog Post, Social Media Post, Website Copy, etc.). lib/firm-context.ts
 * surfaces one excerpt per content type to the AI so it learns tone for
 * each format.
 *
 * Requires the supabase/brand_voice_v2_schema.sql migration.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantClient } from "@/lib/tenant-db";

export const runtime = "nodejs";

const MAX_TITLE = 200;
const MAX_TYPE = 100;
const MAX_NOTES = 1000;
const MAX_CONTENT = 200000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    const { supabase } = await getTenantClient();
    const { data, error } = await supabase
      .from("brand_voice_samples")
      .select("id, title, content, content_type, notes, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[brand-voice/samples GET] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to load samples" }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (err: any) {
    console.error("[brand-voice/samples GET] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to load samples" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { title, content, contentType, notes } = body || {};

    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (title.length > MAX_TITLE) {
      return NextResponse.json({ error: `title must be under ${MAX_TITLE} characters` }, { status: 400 });
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    if (content.length > MAX_CONTENT) {
      return NextResponse.json({ error: `content must be under ${MAX_CONTENT} characters` }, { status: 400 });
    }
    if (typeof contentType !== "string" || contentType.trim().length === 0) {
      return NextResponse.json({ error: "contentType is required" }, { status: 400 });
    }
    if (contentType.length > MAX_TYPE) {
      return NextResponse.json({ error: `contentType must be under ${MAX_TYPE} characters` }, { status: 400 });
    }
    if (notes !== undefined && notes !== null && notes !== "") {
      if (typeof notes !== "string") {
        return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
      }
      if (notes.length > MAX_NOTES) {
        return NextResponse.json({ error: `notes must be under ${MAX_NOTES} characters` }, { status: 400 });
      }
    }

    const { supabase, tenantId } = await getTenantClient();
    const { data, error } = await supabase
      .from("brand_voice_samples")
      .insert({
        title: title.trim(),
        content,
        content_type: contentType.trim(),
        notes: typeof notes === "string" && notes !== "" ? notes : null,
        tenant_id: tenantId,
      })
      .select("id, title, content, content_type, notes, created_at")
      .single();

    if (error) {
      console.error("[brand-voice/samples POST] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to add sample" }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (err: any) {
    console.error("[brand-voice/samples POST] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to add sample" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id } = body || {};

    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { supabase } = await getTenantClient();
    const { data, error } = await supabase
      .from("brand_voice_samples")
      .delete()
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("[brand-voice/samples DELETE] Supabase error:", error.message);
      return NextResponse.json({ error: "Failed to delete sample" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Sample not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error("[brand-voice/samples DELETE] Failed:", err?.message);
    return NextResponse.json({ error: "Failed to delete sample" }, { status: 500 });
  }
}
