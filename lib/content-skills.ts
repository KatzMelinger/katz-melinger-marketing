/**
 * Skill packs the user maintains in /content/skills. Every enabled skill is
 * injected into the system prompt for content generation (draft + batch
 * routes) so the same voice rules, do/don't lists, and practice-area facts
 * propagate without the user having to re-paste them every time.
 *
 * Storage is the `content_skills` table — see
 * `supabase/content_skills_schema.sql`.
 */

import { getSupabaseServer } from "./supabase-server";

export type SkillType =
  | "voice_rule"
  | "do_dont"
  | "example_phrasing"
  | "practice_fact"
  | "compliance"
  | "other";

export type ContentSkill = {
  id: string;
  title: string;
  skillType: SkillType;
  content: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

const TYPE_LABELS: Record<SkillType, string> = {
  voice_rule: "Voice rule",
  do_dont: "Do / don't",
  example_phrasing: "Example phrasing",
  practice_fact: "Practice fact",
  compliance: "Compliance",
  other: "Other",
};

export function labelForSkillType(t: SkillType): string {
  return TYPE_LABELS[t] ?? t;
}

type SkillRow = {
  id: string;
  title: string;
  skill_type: SkillType;
  content: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function rowToSkill(r: SkillRow): ContentSkill {
  return {
    id: r.id,
    title: r.title,
    skillType: r.skill_type,
    content: r.content,
    enabled: r.enabled,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listSkills(): Promise<ContentSkill[]> {
  const supabase = getSupabaseServer();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("content_skills")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as SkillRow[]).map(rowToSkill);
}

export async function listEnabledSkills(): Promise<ContentSkill[]> {
  const all = await listSkills();
  return all.filter((s) => s.enabled);
}

/**
 * Produces the chunk of system-prompt text to inject above the user's content
 * request. Returns an empty string when there are no enabled skills, so the
 * caller can interpolate it unconditionally.
 */
export async function buildSkillsContext(): Promise<string> {
  const skills = await listEnabledSkills();
  if (skills.length === 0) return "";
  const lines: string[] = [];
  lines.push("Skills the firm has trained you on — apply ALL of these:");
  for (const s of skills) {
    lines.push(`\n[${labelForSkillType(s.skillType)}] ${s.title}\n${s.content}`);
  }
  return lines.join("\n");
}
