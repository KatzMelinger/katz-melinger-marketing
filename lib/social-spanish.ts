/**
 * Spanish companion post generation (spec: "Spanish companion posts inside the
 * flow, generated after the English version is approved and length-matched").
 *
 * Deliberately an ADAPTATION of the already-approved English copy, not a fresh
 * generation from the source — the English version already passed every gate
 * (S3 compliance, legal-accuracy, S13 inherited findings), and re-deriving from
 * source risks drifting from what was actually approved. Reuses the exact same
 * cap-enforcement pattern as lib/content-social.ts (validate → regenerate once
 * → hard-trim floor) so a Spanish caption can never violate its format's caps
 * just because the English original was near the limit.
 *
 * The result is saved as a new DRAFT (never auto-scheduled) by the caller, so
 * it still goes through the same approve/compliance/legal gates as any other
 * social post — a language variant is not a compliance shortcut.
 */

import {
  cachedSystemPrompt,
  CONTENT_SHORT_FORM_MODEL,
  extractJSON,
  getAnthropic,
  logCacheUsage,
} from "./anthropic";
import { recordVendorUsage } from "./usage-meter";
import { languageDirective } from "./content-language";
import { stripEmDashes } from "./sanitize-content";
import { ANTI_AI_VOICE_RULES } from "./anti-ai-voice";
import { SOCIAL_CAPS, validateSocial, trimSocial, type SocialFormatKey } from "./social-format-rules";

async function callSpanish(system: string, user: string): Promise<string> {
  const resp = await getAnthropic().messages.create({
    model: CONTENT_SHORT_FORM_MODEL,
    max_tokens: 4096,
    system: cachedSystemPrompt(system, CONTENT_SHORT_FORM_MODEL),
    messages: [{ role: "user", content: user }],
  });
  logCacheUsage("content-social-spanish", resp.usage);
  await recordVendorUsage("anthropic", {
    provider: "anthropic",
    endpoint: "content-social-spanish",
    units: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    detail: CONTENT_SHORT_FORM_MODEL,
  });
  const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
  try {
    return extractJSON<{ body?: string }>(text).body ?? "";
  } catch {
    return "";
  }
}

const SYSTEM = `You adapt already-approved social media copy for a law firm into Spanish. This is an
ADAPTATION of the exact approved English post, not a new piece — keep the same angle, hook,
and CTA, translated naturally, never adding or dropping a claim.

${ANTI_AI_VOICE_RULES}

Return JSON only: { "body": "..." }`;

/**
 * Adapt an approved English post into a length-matched Spanish companion.
 * Returns null if generation fails outright (never throws — this must never
 * block the English post's own approve/schedule flow).
 */
export async function generateSpanishCompanion(
  englishBody: string,
  format: SocialFormatKey,
): Promise<string | null> {
  try {
    const directive = languageDirective("es");
    const user = `${directive}

Adapt this approved ${SOCIAL_CAPS[format].label} into Spanish, matching its length and structure exactly:
    ${SOCIAL_CAPS[format].promptRules.join("\n    ")}

APPROVED ENGLISH POST:
"""
${englishBody}
"""

Return JSON only: { "body": "..." }`;

    let body = stripEmDashes(await callSpanish(SYSTEM, user));
    if (!body.trim()) return null;

    let violations = validateSocial(format, body);
    if (violations.length) {
      const retryUser = `Your Spanish adaptation broke its hard caps: ${violations.join("; ")}.
Rewrite it to obey EVERY cap for ${format}: ${SOCIAL_CAPS[format].promptRules.join("; ")}
Keep it a faithful Spanish adaptation of the same approved post:
"""
${englishBody}
"""
Return JSON only: { "body": "..." }`;
      const retry = stripEmDashes(await callSpanish(SYSTEM, retryUser));
      if (retry.trim() && validateSocial(format, retry).length <= violations.length) {
        body = retry;
        violations = validateSocial(format, body);
      }
    }
    if (violations.length) body = stripEmDashes(trimSocial(format, body)); // floor
    return body;
  } catch (e) {
    console.warn("[social-spanish] generation failed:", e);
    return null;
  }
}
