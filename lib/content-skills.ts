/**
 * Skill packs the user maintains in /brand-voice (legacy URL: /content/skills).
 * Every enabled skill is injected into the system prompt for content generation
 * (draft + batch routes) so the same voice rules, do/don't lists, prompts, and
 * practice-area facts propagate without the user having to re-paste them every
 * time.
 *
 * Each skill can be scoped to:
 *   - platforms   (blog, linkedin, twitter, facebook, instagram, email, podcast)
 *   - audiences   (free-text names matching brand_voice_avatars)
 *   - practice_areas (General, Wage & Hour, Discrimination, ...)
 *
 * Empty/null array = applies everywhere. See supabase/content_skills_scope.sql.
 */

import { getSupabaseServer } from "./supabase-server";

export type SkillType =
  | "voice_rule"
  | "do_dont"
  | "example_phrasing"
  | "practice_fact"
  | "compliance"
  | "prompt"
  | "direction"
  | "other";

export type ContentSkill = {
  id: string;
  title: string;
  skillType: SkillType;
  content: string;
  enabled: boolean;
  sortOrder: number;
  platforms: string[];
  audiences: string[];
  practiceAreas: string[];
  createdAt: string;
  updatedAt: string;
};

const TYPE_LABELS: Record<SkillType, string> = {
  voice_rule: "Voice rule",
  do_dont: "Do / don't",
  example_phrasing: "Example phrasing",
  practice_fact: "Practice fact",
  compliance: "Compliance",
  prompt: "Prompt",
  direction: "Direction",
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
  platforms: string[] | null;
  audiences: string[] | null;
  practice_areas: string[] | null;
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
    platforms: Array.isArray(r.platforms) ? r.platforms : [],
    audiences: Array.isArray(r.audiences) ? r.audiences : [],
    practiceAreas: Array.isArray(r.practice_areas) ? r.practice_areas : [],
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

export type SkillScope = {
  /** Platforms being generated for. Multiple = batch (skill fires if any overlap). */
  platforms?: string[];
  /** Audience name (matches a brand_voice_avatar). Single value per generation. */
  audience?: string;
  /** Practice area for the generation. "General" is treated as no specific area. */
  practiceArea?: string;
};

/**
 * A skill is included only if every set scope dimension matches the current
 * generation. Unscoped dimensions on the skill are wildcards. If a skill is
 * scoped to a dimension that the current generation doesn't supply, the
 * skill is excluded — i.e., "Wage & Hour"-scoped skills don't fire for
 * "General" drafts.
 */
export function skillMatchesScope(skill: ContentSkill, scope: SkillScope): boolean {
  if (skill.platforms.length > 0) {
    const ctx = scope.platforms ?? [];
    if (ctx.length === 0) return false;
    if (!skill.platforms.some((p) => ctx.includes(p))) return false;
  }
  if (skill.audiences.length > 0) {
    if (!scope.audience || !skill.audiences.includes(scope.audience)) return false;
  }
  if (skill.practiceAreas.length > 0) {
    const pa = scope.practiceArea;
    if (!pa || pa === "General" || !skill.practiceAreas.includes(pa)) return false;
  }
  return true;
}

/**
 * Produces the chunk of system-prompt text to inject above the user's content
 * request. Returns an empty string when there are no applicable skills, so the
 * caller can interpolate it unconditionally.
 *
 * Pass the generation scope so audience- / practice-area- / platform-scoped
 * skills only fire when their scope matches the current generation. Omitting
 * scope returns only unscoped skills.
 */
export async function buildSkillsContext(scope: SkillScope = {}): Promise<string> {
  const skills = await listEnabledSkills();
  const applicable = skills.filter((s) => skillMatchesScope(s, scope));
  if (applicable.length === 0) return "";
  const lines: string[] = [];
  lines.push("Skills the firm has trained you on — apply ALL of these:");
  for (const s of applicable) {
    const scopeNote: string[] = [];
    if (s.platforms.length > 0) scopeNote.push(`platforms: ${s.platforms.join(", ")}`);
    if (s.audiences.length > 0) scopeNote.push(`audience: ${s.audiences.join(", ")}`);
    if (s.practiceAreas.length > 0)
      scopeNote.push(`practice area: ${s.practiceAreas.join(", ")}`);
    const tail = scopeNote.length > 0 ? ` (scope — ${scopeNote.join(" | ")})` : "";
    lines.push(`\n[${labelForSkillType(s.skillType)}] ${s.title}${tail}\n${s.content}`);
  }
  return lines.join("\n");
}
