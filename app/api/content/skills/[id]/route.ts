/**
 * PATCH  /api/content/skills/[id]  — update title/content/type/enabled/order
 * DELETE /api/content/skills/[id]  — remove
 */

import { NextRequest, NextResponse } from "next/server";

import { type SkillType } from "@/lib/content-skills";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SkillType[] = [
  "voice_rule",
  "do_dont",
  "example_phrasing",
  "practice_fact",
  "compliance",
  "other",
];

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body?.title === "string") patch.title = body.title.trim();
    if (typeof body?.content === "string") patch.content = body.content.trim();
    if (
      typeof body?.skillType === "string" &&
      VALID_TYPES.includes(body.skillType as SkillType)
    ) {
      patch.skill_type = body.skillType;
    }
    if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
    if (Number.isFinite(body?.sortOrder)) patch.sort_order = Number(body.sortOrder);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("content_skills")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ skill: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update skill" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("content_skills")
      .delete()
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete skill" },
      { status: 500 },
    );
  }
}
