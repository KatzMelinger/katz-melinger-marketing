/**
 * Dedicated social copy generator.
 *
 * This is a SEPARATE system from the blog generator (lib/content-multiformat.ts).
 * It does not reuse the blog prompt, structure, or length targets. It encodes the
 * social rulebook: source-required (Rule 1), one angle (Rule 2), hook formulas
 * (Rule 3), hook→value→soft-CTA structure (Rule 4), hard length caps enforced at
 * generation (Rule 5), brand-voice + no-dashes + NY/NJ spelled out (Rule 6), and
 * the sensitive-topic tone override (Rule 7). The Rule 10 quality checklist is
 * computed per post and stored for the review card (advisory — caps are the hard
 * part, enforced here; the checklist informs Diana but does not block).
 *
 * Enforcement: generate all formats in one call, then for any format that breaks
 * its caps, regenerate that one format once with a tighter instruction; if it
 * still overflows, hard-trim as a floor so nothing oversized ever persists.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { resolveTenantId } from "./tenant-context";
import { recordVendorUsage } from "./usage-meter";
import { ANTI_AI_VOICE_RULES } from "./anti-ai-voice";
import { getFirmContext } from "./firm-context";
import { buildSkillsContext } from "./content-skills";
import {
  cachedSystemPrompt,
  CONTENT_SHORT_FORM_MODEL,
  extractJSON,
  getAnthropic,
} from "./anthropic";
import { stripEmDashes, hasEmDash } from "./sanitize-content";
import { isSensitiveTopic, sensitiveToneBlock } from "./sensitive-topic";
import { checkMonthlyDuplicates, type AngleConflict } from "./social-duplicate";
import {
  SOCIAL_CAPS,
  validateSocial,
  trimSocial,
  looksLikeHook,
  hasBannedOpener,
  hasStateAbbreviation,
  hasSoftCta,
  type SocialFormatKey,
} from "./social-format-rules";

/** An approved asset a social post is generated from (Rule 1). */
export type SocialSource = {
  kind: "blog" | "case_result" | "legal_update" | "service_page" | "page";
  title: string;
  /** The approved source content the post draws its single angle from. */
  text: string;
  url?: string | null;
  /** Source draft/page id when available, for the card's source tag. */
  id?: string | null;
};

/** Rule 10 quality checklist, computed per post. Advisory on the card. */
export type SocialChecklist = {
  hookFormula: boolean;
  withinCaps: boolean;
  noDashesOrBannedOpeners: boolean;
  statesSpelledOut: boolean;
  softCta: boolean;
  /** true = applied, false = sensitive but missing, null = not a sensitive topic. */
  sensitiveToneApplied: boolean | null;
  /** Rule 8: true = no month conflict, false = conflict found, null = check didn't run. */
  noDuplicateThisMonth: boolean | null;
};

export type SocialDraft = {
  id: string;
  format: SocialFormatKey;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
  checklist: SocialChecklist;
};

export type SocialResult = { batch_id: string; drafts: SocialDraft[] };

type SocialClaudeOutput = {
  formats: Record<string, { body?: string }>;
};

function buildSocialSystemPrompt(firm: string, skillsContext: string): string {
  return `You are a social media copywriter for a law firm. This is SHORT-FORM SOCIAL copy — it is
NOT a blog post and must never read like one. One idea per post, scannable, hook-driven.

The firm's details are below — use them verbatim and never fabricate firm information.
${firm}

${ANTI_AI_VOICE_RULES}
${skillsContext ? `\n${skillsContext}\n` : ""}
NON-NEGOTIABLE SOCIAL RULES:
- Brand voice: Authoritative, Approachable, Action-Oriented.
- No em dashes or en dashes anywhere, in any format.
- "New York" and "New Jersey" always spelled out in full, never abbreviated (no NY, NYC, NJ).
- No sensational language, no outcome guarantees, no fear-based urgency.
- Use "we" and "our firm", never third person about the firm.
- Every post extracts ONE angle from the source and covers only that. A post that tries to cover
  the definition, the test, the exceptions, and the deadline at once has failed.
- Every post follows: HOOK (one line) → VALUE (the single angle, plain language, short sentences)
  → SOFT CTA (an invitation, never a hard sell or guarantee).
- The first line must use one of these hook formulas, never a topic label or a legal definition:
  question the reader is asking, a specific scenario, a myth-bust, a concrete number/stat, or
  direct address to the reader's situation.`;
}

function buildSocialUserPrompt(args: {
  source: SocialSource;
  formats: SocialFormatKey[];
  practiceArea?: string;
  sensitiveBlock: string;
}): string {
  const formatSpec = args.formats
    .map((f) => `- ${f} (${SOCIAL_CAPS[f].label}):\n    ${SOCIAL_CAPS[f].promptRules.join("\n    ")}`)
    .join("\n");

  return `${args.sensitiveBlock}Generate social posts from this ONE approved source. Draw a single, distinct angle
for each format — never summarize the whole source.

SOURCE (${args.source.kind}): ${args.source.title}
Practice area: ${args.practiceArea ?? "General"}
"""
${args.source.text.slice(0, 6000)}
"""

Produce these formats, each obeying its hard caps exactly (if it doesn't fit, the angle was too
broad — narrow it, do not cram):
${formatSpec}

Return JSON only:
{
  "formats": {
    ${args.formats.map((f) => `"${f}": { "body": "..." }`).join(",\n    ")}
  }
}`;
}

async function callSocial(system: string, user: string): Promise<SocialClaudeOutput> {
  const resp = await getAnthropic().messages.create({
    model: CONTENT_SHORT_FORM_MODEL,
    max_tokens: 4096,
    system: cachedSystemPrompt(system),
    messages: [{ role: "user", content: user }],
  });
  await recordVendorUsage("anthropic", {
    provider: "anthropic",
    endpoint: "content-social",
    units: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    detail: CONTENT_SHORT_FORM_MODEL,
  });
  const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
  try {
    return extractJSON<SocialClaudeOutput>(text);
  } catch {
    return { formats: {} };
  }
}

/** Regenerate a single format with an explicit note about what it violated. */
async function regenerateOne(
  system: string,
  source: SocialSource,
  format: SocialFormatKey,
  violations: string[],
): Promise<string> {
  const user = `Your previous ${format} draft broke its hard caps: ${violations.join("; ")}.
Rewrite it to obey EVERY cap for ${format} (${SOCIAL_CAPS[format].label}):
    ${SOCIAL_CAPS[format].promptRules.join("\n    ")}
Narrow the angle rather than trimming after the fact.

SOURCE: ${source.title}
"""
${source.text.slice(0, 6000)}
"""
Return JSON only: { "formats": { "${format}": { "body": "..." } } }`;
  const out = await callSocial(system, user);
  return out.formats?.[format]?.body ?? "";
}

function computeChecklist(
  body: string,
  format: SocialFormatKey,
  sensitive: boolean,
  noDuplicateThisMonth: boolean | null,
): SocialChecklist {
  const hookSource = format === "carousel" ? body.replace(/^\s*(?:\*\*)?slide\s*1\s*[:\-.)]/i, "") : body;
  return {
    hookFormula: looksLikeHook(hookSource),
    withinCaps: validateSocial(format, body).length === 0,
    noDashesOrBannedOpeners: !hasEmDash(body) && !hasBannedOpener(body),
    statesSpelledOut: !hasStateAbbreviation(body),
    softCta: hasSoftCta(body),
    sensitiveToneApplied: sensitive ? true : null,
    noDuplicateThisMonth,
  };
}

export async function generateSocialPosts(args: {
  source: SocialSource;
  formats: SocialFormatKey[];
  practiceArea?: string;
  tenantId?: string;
  originSource?: string | null;
  originContext?: Record<string, unknown> | null;
}): Promise<SocialResult> {
  // Rule 1 — source required. A source-less post is a manual Content Studio
  // entry, not an AI generation. Fail loudly so the caller surfaces it.
  if (!args.source?.text?.trim()) {
    throw new Error(
      "Social generation requires an approved source (a published blog, case result, legal update, or service page). Source-less posts are manual Content Studio entries.",
    );
  }
  if (!args.formats.length) throw new Error("No social formats requested.");

  const supabase = getSupabaseAdmin();
  const tid = args.tenantId ?? (await resolveTenantId());
  const [firm, skillsContext] = await Promise.all([
    getFirmContext(tid),
    buildSkillsContext({ platforms: args.formats, practiceArea: args.practiceArea }, tid),
  ]);

  const system = buildSocialSystemPrompt(firm, skillsContext);
  const sensitive = isSensitiveTopic(args.source.title, args.source.text.slice(0, 2000));
  const sensitiveBlock = sensitiveToneBlock(args.source.title, args.source.text.slice(0, 2000));

  const first = await callSocial(
    system,
    buildSocialUserPrompt({ source: args.source, formats: args.formats, practiceArea: args.practiceArea, sensitiveBlock }),
  );

  // Enforce caps per format: validate → regen once → hard-trim floor.
  const bodies: Partial<Record<SocialFormatKey, string>> = {};
  for (const format of args.formats) {
    let body = stripEmDashes(first.formats?.[format]?.body ?? "");
    if (!body.trim()) continue;
    let violations = validateSocial(format, body);
    if (violations.length) {
      const retry = stripEmDashes(await regenerateOne(system, args.source, format, violations));
      if (retry.trim() && validateSocial(format, retry).length <= violations.length) {
        body = retry;
        violations = validateSocial(format, body);
      }
    }
    if (violations.length) body = stripEmDashes(trimSocial(format, body)); // floor
    bodies[format] = body;
  }

  // Rule 8 — duplicate-angle check against this month's Content Calendar. Ordered
  // to match the generated formats so results map back by index. Advisory: we
  // flag conflicts, we don't block or auto-regenerate. Fails soft (ran=false).
  const genFormats = args.formats.filter((f) => bodies[f]);
  const dup = await checkMonthlyDuplicates({
    tenantId: tid,
    sourceTitle: args.source.title,
    candidates: genFormats.map((f) => ({ body: bodies[f] as string })),
  });
  const dupByFormat = new Map<SocialFormatKey, { noDup: boolean | null; conflicts: AngleConflict[] }>();
  genFormats.forEach((f, i) => {
    const conflicts = dup.conflicts[i] ?? [];
    dupByFormat.set(f, { noDup: dup.ran ? conflicts.length === 0 : null, conflicts });
  });

  // Persist: one batch row grouping the format drafts, mirroring the blog path.
  const { data: batchRow, error: batchErr } = await supabase
    .from("content_batches")
    .insert({
      topic: args.source.title,
      practice_area: args.practiceArea ?? null,
      formats: args.formats,
      source_id: args.source.id ?? null,
      tenant_id: tid,
    })
    .select("id")
    .single();
  if (batchErr) throw new Error(`Failed to create batch: ${batchErr.message}`);

  const drafts: SocialDraft[] = [];
  for (const format of args.formats) {
    const body = bodies[format];
    if (!body) continue;
    const dupInfo = dupByFormat.get(format) ?? { noDup: null, conflicts: [] };
    const checklist = computeChecklist(body, format, sensitive, dupInfo.noDup);
    const title = `${SOCIAL_CAPS[format].label}: ${args.source.title}`.slice(0, 120);
    const metadata: Record<string, unknown> = {
      generation_model: CONTENT_SHORT_FORM_MODEL,
      social_generator: "content-social",
      social_source: {
        kind: args.source.kind,
        title: args.source.title,
        url: args.source.url ?? null,
        id: args.source.id ?? null,
      },
      social_checklist: checklist,
    };
    if (dupInfo.conflicts.length) metadata.social_duplicate_conflicts = dupInfo.conflicts;
    if (args.originSource) metadata.origin_source = args.originSource;
    if (args.originContext) metadata.origin_context = args.originContext;

    const { data: draft, error: dErr } = await supabase
      .from("content_drafts")
      .insert({
        batch_id: batchRow.id,
        format,
        topic: args.source.title,
        practice_area: args.practiceArea ?? null,
        title,
        body,
        metadata,
        source_id: args.source.id ?? null,
        seo_brief: null,
        tenant_id: tid,
      })
      .select("id, format, title, body, metadata")
      .single();
    if (dErr || !draft) continue;
    drafts.push({
      id: draft.id as string,
      format,
      title: (draft.title as string) ?? null,
      body: draft.body as string,
      metadata: draft.metadata as Record<string, unknown>,
      checklist,
    });
  }

  return { batch_id: batchRow.id as string, drafts };
}
