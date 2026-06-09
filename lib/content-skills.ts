/**
 * Skill packs the user maintains in /brand-voice (legacy URL: /content/skills).
 * Every enabled skill is injected into the system prompt for content generation
 * (draft + batch routes) so the same voice rules, do/don't lists, prompts, and
 * practice-area facts propagate without the user having to re-paste them every
 * time.
 *
 * Each skill can be scoped to:
 *   - platforms     (blog, linkedin, twitter, facebook, instagram, email, podcast)
 *   - content_types (Blog Post, FAQ, Practice Page, Case Study, Landing Page, ...)
 *   - audiences     (free-text names matching brand_voice_avatars)
 *   - practice_areas (General, Wage & Hour, Discrimination, ...)
 *
 * Empty/null array = applies everywhere. See supabase/content_skills_scope.sql
 * and supabase/content_skills_structure.sql.
 *
 * The 'structure' skill_type carries explicit max_words / sections /
 * required_elements; buildSkillsContext renders these as a hard-enforcement
 * STRUCTURE REQUIREMENTS block at the top of the prompt.
 */

import { getSupabaseServer } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";

export type SkillType =
  | "voice_rule"
  | "do_dont"
  | "example_phrasing"
  | "practice_fact"
  | "compliance"
  | "prompt"
  | "direction"
  | "structure"
  | "other";

export type ContentSkill = {
  id: string;
  title: string;
  skillType: SkillType;
  content: string;
  enabled: boolean;
  sortOrder: number;
  platforms: string[];
  contentTypes: string[];
  audiences: string[];
  practiceAreas: string[];
  maxWords: number | null;
  sections: string[];
  requiredElements: string[];
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
  structure: "Structure",
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
  content_types: string[] | null;
  audiences: string[] | null;
  practice_areas: string[] | null;
  max_words: number | null;
  sections: string[] | null;
  required_elements: string[] | null;
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
    contentTypes: Array.isArray(r.content_types) ? r.content_types : [],
    audiences: Array.isArray(r.audiences) ? r.audiences : [],
    practiceAreas: Array.isArray(r.practice_areas) ? r.practice_areas : [],
    maxWords: typeof r.max_words === "number" ? r.max_words : null,
    sections: Array.isArray(r.sections) ? r.sections : [],
    requiredElements: Array.isArray(r.required_elements) ? r.required_elements : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listSkills(tenantId?: string): Promise<ContentSkill[]> {
  const supabase = getSupabaseServer();
  if (!supabase) return [];
  const tid = tenantId ?? (await resolveTenantId());
  const { data, error } = await supabase
    .from("content_skills")
    .select("*")
    .eq("tenant_id", tid)
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
  /** Content type being generated (e.g. "Blog Post", "FAQ", "Practice Page"). */
  contentType?: string;
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
  if (skill.contentTypes.length > 0) {
    if (!scope.contentType || !skill.contentTypes.includes(scope.contentType)) {
      return false;
    }
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

function formatStructureSkill(s: ContentSkill): string {
  const lines: string[] = [];
  const scopeBits: string[] = [];
  if (s.contentTypes.length > 0) scopeBits.push(s.contentTypes.join(", "));
  else if (s.platforms.length > 0) scopeBits.push(s.platforms.join(", "));
  const target = scopeBits.length > 0 ? ` for ${scopeBits.join(" / ")}` : "";
  lines.push(`STRUCTURE REQUIREMENT${target} — "${s.title}" (you MUST follow this):`);
  if (s.maxWords && s.maxWords > 0) {
    lines.push(`- Hard word limit: ${s.maxWords} words (do not exceed).`);
  }
  if (s.sections.length > 0) {
    lines.push(`- Required sections, in order:`);
    s.sections.forEach((sec, i) => lines.push(`    ${i + 1}. ${sec}`));
  }
  if (s.requiredElements.length > 0) {
    lines.push(`- Required elements (must appear):`);
    s.requiredElements.forEach((el) => lines.push(`    - ${el}`));
  }
  if (s.content.trim()) {
    lines.push(`- Additional notes: ${s.content.trim()}`);
  }
  return lines.join("\n");
}

/**
 * Produces the chunk of system-prompt text to inject above the user's content
 * request. Returns an empty string when there are no applicable skills, so the
 * caller can interpolate it unconditionally.
 *
 * Pass the generation scope so audience- / practice-area- / platform-scoped
 * skills only fire when their scope matches the current generation. Omitting
 * scope returns only unscoped skills.
 *
 * Structure skills are emitted first as a hard-enforcement block; everything
 * else follows under the existing "Skills the firm has trained you on" header.
 */
export async function buildSkillsContext(scope: SkillScope = {}): Promise<string> {
  const skills = await listEnabledSkills();
  const applicable = skills.filter((s) => skillMatchesScope(s, scope));
  if (applicable.length === 0) return "";

  const structureSkills = applicable.filter((s) => s.skillType === "structure");
  const otherSkills = applicable.filter((s) => s.skillType !== "structure");

  const parts: string[] = [];

  if (structureSkills.length > 0) {
    parts.push(structureSkills.map(formatStructureSkill).join("\n\n"));
  }

  if (otherSkills.length > 0) {
    const lines: string[] = [];
    lines.push("Skills the firm has trained you on — apply ALL of these:");
    for (const s of otherSkills) {
      const scopeNote: string[] = [];
      if (s.platforms.length > 0) scopeNote.push(`platforms: ${s.platforms.join(", ")}`);
      if (s.contentTypes.length > 0)
        scopeNote.push(`content type: ${s.contentTypes.join(", ")}`);
      if (s.audiences.length > 0) scopeNote.push(`audience: ${s.audiences.join(", ")}`);
      if (s.practiceAreas.length > 0)
        scopeNote.push(`practice area: ${s.practiceAreas.join(", ")}`);
      const tail = scopeNote.length > 0 ? ` (scope — ${scopeNote.join(" | ")})` : "";
      lines.push(`\n[${labelForSkillType(s.skillType)}] ${s.title}${tail}\n${s.content}`);
    }
    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}

/**
 * Post-generation validation helper. Caller can compare generated content
 * against any structure skills that fired for this scope and surface warnings
 * (e.g. word-limit exceeded). Returns an empty array if nothing tripped.
 *
 * Currently a soft check — wire into a route to log/return warnings rather
 * than block the response.
 */
export function validateAgainstStructure(
  generated: string,
  structureSkills: ContentSkill[],
): string[] {
  const warnings: string[] = [];
  const words = generated.trim() ? generated.trim().split(/\s+/).length : 0;
  for (const s of structureSkills) {
    if (s.maxWords && s.maxWords > 0 && words > s.maxWords) {
      warnings.push(
        `"${s.title}" requires ≤ ${s.maxWords} words — generated ${words}.`,
      );
    }
    for (const el of s.requiredElements) {
      if (!generated.toLowerCase().includes(el.toLowerCase())) {
        warnings.push(`"${s.title}" requires element not found in output: "${el}".`);
      }
    }
  }
  return warnings;
}
