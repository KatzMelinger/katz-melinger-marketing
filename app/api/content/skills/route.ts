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
  "prompt",
  "direction",
  "structure",
  "other",
];

function readStringArray(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const cleaned = input
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

function readPositiveInt(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

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

    // Structure skills can omit free-text content (they carry sections/elements
    // in dedicated columns) but they still need a title.
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
    if (!content && skillType !== "structure") {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const platforms = readStringArray(b?.platforms);
    const contentTypes = readStringArray(b?.contentTypes);
    const audiences = readStringArray(b?.audiences);
    const practiceAreas = readStringArray(b?.practiceAreas);
    const maxWords = readPositiveInt(b?.maxWords);
    const sections = readStringArray(b?.sections);
    const requiredElements = readStringArray(b?.requiredElements);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("content_skills")
      .insert({
        title,
        content,
        skill_type: skillType,
        enabled,
        sort_order: sortOrder,
        platforms,
        content_types: contentTypes,
        audiences,
        practice_areas: practiceAreas,
        max_words: maxWords,
        sections,
        required_elements: requiredElements,
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
