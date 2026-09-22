/**
 * S12 — Rewrite / regenerate in the social composer (Diana's top social
 * priority). Three actions per platform tab:
 *   - "rewrite"       — a distinctly different angle on the same source,
 *                       explicitly avoiding every previously-generated version.
 *   - "more_engaging" — punch up the hook/energy of the CURRENT text, same
 *                       angle, same CTA, no new source lookup.
 *   - "cta_change"    — re-run the CTA engine (S2) and rewrite only the
 *                       closing CTA, keeping the hook/body untouched.
 *
 * Each call is one new entry in a per-draft version history (kept in
 * content_drafts.metadata.social_rewrite — see RewriteState below), not a
 * silent overwrite: the reviewer can flip through past versions and revert.
 *
 * This module only generates text and manages version history. The caller
 * (app/api/content-production/social/[id]/rewrite/route.ts) is responsible
 * for persisting the result and re-running the S3 QA gate + legal check
 * (lib/social-post-gate.ts) — this module has no opinion on gating.
 */

import { getFirmContext } from "./firm-context";
import { buildSkillsContext } from "./content-skills";
import { renderFirmFactsBlock } from "./firm-facts";
import { AD_TERMS_RULE } from "./ad-terms";
import { isSensitiveTopic, sensitiveToneBlock } from "./sensitive-topic";
import { getOperatingBrief } from "./social-operating-brief";
import { chooseCta, ctaInstruction, loadRecentCtas, type CtaChoice, type CtaMechanism, type CtaType } from "./social-cta";
import { inferIntent } from "./strategy-engine";
import { stripEmDashes } from "./sanitize-content";
import { buildSocialSystemPrompt, type SocialSource } from "./content-social";
import {
  cachedSystemPrompt,
  CONTENT_SHORT_FORM_MODEL,
  extractJSON,
  getAnthropic,
  logCacheUsage,
} from "./anthropic";
import { recordVendorUsage } from "./usage-meter";
import { SOCIAL_CAPS, validateSocial, trimSocial, type SocialFormatKey } from "./social-format-rules";

export type RewriteAction = "rewrite" | "more_engaging" | "cta_change";

export type RewriteVersion = {
  version_id: string;
  text: string;
  created_at: string;
  source: "original" | RewriteAction;
};

export type RewriteState = {
  active_version_id: string;
  versions: RewriteVersion[];
};

/** Seed a fresh history from a draft's current body — used the first time any
 *  of the three actions (or a revert) touches a draft that predates this. */
export function seedRewriteState(originalText: string): RewriteState {
  const v: RewriteVersion = {
    version_id: "v1",
    text: originalText,
    created_at: new Date().toISOString(),
    source: "original",
  };
  return { active_version_id: v.version_id, versions: [v] };
}

/** Every version except the active one — the "rejected" set spec 6.1 asks
 *  for, computed rather than separately maintained so it can never drift
 *  from `versions`/`active_version_id`. */
export function rejectedVersionIds(state: RewriteState): string[] {
  return state.versions.filter((v) => v.version_id !== state.active_version_id).map((v) => v.version_id);
}

/** The id the NEXT version pushed onto this history should use. */
export function nextVersionId(state: RewriteState): string {
  return `v${state.versions.length + 1}`;
}

async function callClaude(system: string, user: string): Promise<string> {
  const resp = await getAnthropic().messages.create({
    model: CONTENT_SHORT_FORM_MODEL,
    max_tokens: 4096,
    system: cachedSystemPrompt(system, CONTENT_SHORT_FORM_MODEL),
    messages: [{ role: "user", content: user }],
  });
  logCacheUsage("social-rewrite", resp.usage);
  await recordVendorUsage("anthropic", {
    provider: "anthropic",
    endpoint: "social-rewrite",
    units: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    detail: CONTENT_SHORT_FORM_MODEL,
  });
  const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
  try {
    const parsed = extractJSON<{ body?: string }>(text);
    return typeof parsed?.body === "string" ? parsed.body : "";
  } catch {
    return "";
  }
}

function buildRewritePrompt(args: {
  format: SocialFormatKey;
  source: SocialSource;
  rejectedTexts: string[];
  cta: CtaChoice;
  socialPhone: string;
  sensitiveBlock: string;
}): string {
  const cap = SOCIAL_CAPS[args.format];
  const rejected = args.rejectedTexts
    .map(
      (t, i) =>
        `REJECTED VERSION ${i + 1} — do not reuse this angle, hook, or wording:\n"""\n${t}\n"""`,
    )
    .join("\n\n");
  return `${args.sensitiveBlock}Write a NEW ${cap.label} from a DISTINCTLY DIFFERENT angle than every rejected version below. Same approved source, same underlying facts — a different entry point into the topic (a different hook formula, a different specific detail to lead with), not a light rewording of an old one.

SOURCE (${args.source.kind}): ${args.source.title}
"""
${args.source.text.slice(0, 6000)}
"""

${rejected}

The new version must obey every hard cap for ${args.format}:
${cap.promptRules.join("\n")}
${ctaInstruction(args.cta, args.socialPhone)}

Return JSON only: { "body": "..." }`;
}

function buildMoreEngagingPrompt(args: { format: SocialFormatKey; currentText: string }): string {
  const cap = SOCIAL_CAPS[args.format];
  return `Make this ${cap.label} MORE ENGAGING — a sharper hook, tighter language, more energy — WITHOUT changing the angle, the facts, or the closing call-to-action. This is a punch-up, not a rewrite: keep the same core message and leave the closing CTA sentence essentially as it is; only sharpen the hook and the body between them.

CURRENT VERSION:
"""
${args.currentText}
"""

Still obey every hard cap for ${args.format}:
${cap.promptRules.join("\n")}

Return JSON only: { "body": "..." }`;
}

function buildCtaChangePrompt(args: {
  format: SocialFormatKey;
  currentText: string;
  cta: CtaChoice;
  socialPhone: string;
  offerPhrase: string;
}): string {
  const cap = SOCIAL_CAPS[args.format];
  const offerLine =
    args.cta.ctaType === "consultation"
      ? `\nThe new CTA must include this exact offer phrase, verbatim: "${args.offerPhrase}".`
      : "";
  return `Keep the hook and the body of this ${cap.label} EXACTLY as they are — do not touch them. Rewrite ONLY the closing call-to-action to match this instruction:
${ctaInstruction(args.cta, args.socialPhone)}${offerLine}

CURRENT VERSION:
"""
${args.currentText}
"""

Still obey every hard cap for ${args.format}:
${cap.promptRules.join("\n")}

Return JSON only: { "body": "..." }`;
}

export type RegenerateResult = {
  body: string;
  ctaType: CtaType | null;
  ctaMechanism: CtaMechanism | null;
};

/**
 * Generate one new version of a social post's copy. Does not touch version
 * history or persistence — the caller owns that (see the route).
 */
export async function regenerateSocialCopy(args: {
  action: RewriteAction;
  format: SocialFormatKey;
  currentText: string;
  /** Only meaningful for "rewrite" — every earlier version's text. */
  rejectedTexts: string[];
  /** Only required for "rewrite"; more_engaging/cta_change never call the
   *  source back up, they work from currentText alone. */
  source?: SocialSource;
  practiceArea?: string | null;
  tenantId: string;
}): Promise<RegenerateResult> {
  if (args.action === "rewrite" && !args.source?.text?.trim()) {
    throw new Error(
      "No stored source text for this draft, so a new-angle rewrite can't run. Try More engaging or Change CTA instead.",
    );
  }

  const [firm, skillsContext, operatingBrief, recentCtas] = await Promise.all([
    getFirmContext(args.tenantId),
    buildSkillsContext({ platforms: [args.format], practiceArea: args.practiceArea ?? undefined }, args.tenantId),
    getOperatingBrief(args.tenantId),
    loadRecentCtas(args.tenantId),
  ]);

  const system = `${buildSocialSystemPrompt(firm, skillsContext, operatingBrief)}

${renderFirmFactsBlock()}

${AD_TERMS_RULE}`;

  const topicForSensitivity = args.source?.title ?? args.currentText.slice(0, 80);
  const textForSensitivity = args.source?.text ?? args.currentText;
  const sensitive = isSensitiveTopic(topicForSensitivity, textForSensitivity.slice(0, 2000));
  const sensitiveBlock = sensitiveToneBlock(topicForSensitivity, textForSensitivity.slice(0, 2000));

  const intent = inferIntent({
    clusterName: topicForSensitivity,
    primaryKeyword: topicForSensitivity,
    secondaryKeywords: [],
  });
  const cta = chooseCta({ intent, sensitive, platform: args.format, recentByPlatform: recentCtas });

  let user: string;
  if (args.action === "rewrite") {
    user = buildRewritePrompt({
      format: args.format,
      source: args.source as SocialSource,
      rejectedTexts: args.rejectedTexts,
      cta,
      socialPhone: operatingBrief.socialPhone,
      sensitiveBlock,
    });
  } else if (args.action === "more_engaging") {
    user = buildMoreEngagingPrompt({ format: args.format, currentText: args.currentText });
  } else {
    user = buildCtaChangePrompt({
      format: args.format,
      currentText: args.currentText,
      cta,
      socialPhone: operatingBrief.socialPhone,
      offerPhrase: operatingBrief.offerPhrase,
    });
  }

  let body = stripEmDashes(await callClaude(system, user));
  if (!body.trim()) throw new Error("The rewrite returned no usable text — try again.");
  if (validateSocial(args.format, body).length) body = stripEmDashes(trimSocial(args.format, body));

  const ctaTouched = args.action === "rewrite" || args.action === "cta_change";
  return {
    body,
    ctaType: ctaTouched ? cta.ctaType : null,
    ctaMechanism: ctaTouched ? cta.ctaMechanism : null,
  };
}
