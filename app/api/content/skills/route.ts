/**
 * GET  /api/content/skills              — list every skill (enabled or not)
 * POST /api/content/skills              — create a skill
 *
 * See app/api/content/skills/[id]/route.ts for PATCH/DELETE.
 */

import { NextRequest, NextResponse } from "next/server";

import { listSkills, type SkillType } from "@/lib/content-skills";
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

export async function GET() {
  try {
    const skills = await listSkills();
    return NextResponse.json({ skills });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load skills" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    const skillType =
      typeof body?.skillType === "string" && VALID_TYPES.includes(body.skillType as SkillType)
        ? (body.skillType as SkillType)
        : "voice_rule";
    const enabled = body?.enabled === false ? false : true;
    const sortOrder = Number.isFinite(body?.sortOrder) ? Number(body.sortOrder) : 100;

    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("content_skills")
      .insert({
        title,
        content,
        skill_type: skillType,
        enabled,
        sort_order: sortOrder,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ skill: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create skill" },
      { status: 500 },
    );
  }
}
