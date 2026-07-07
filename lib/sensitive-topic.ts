/**
 * Sensitive-topic detection + tone override.
 *
 * Brand voice was applied uniformly regardless of topic, so content about
 * harassment, retaliation, discrimination, or wrongful termination read like a
 * legal encyclopedia to a reader who is usually in a vulnerable, high-stress
 * situation. Diana flagged this on the "pushed out after reporting harassment"
 * draft: legally accurate, but tone-deaf.
 *
 * This forces calm, human language BEFORE any legal reference for that category
 * of topic — in the hook and every section opener — with a supportive (not
 * transactional) CTA. It mirrors Rule 7 of the social content spec and is
 * injected into every generator's prompt when the topic matches.
 */

const SENSITIVE_PATTERNS: RegExp[] = [
  /\bharass(ment|ing|ed)?\b/i,
  /\bsexual (harassment|misconduct|assault)\b/i,
  /\bretaliat(e|ed|es|ion|ory)\b/i,
  /\bdiscriminat(e|ed|es|ion|ory)\b/i,
  /\bwrongful(ly)?\s+(termination|terminated|discharge|dismissal|dismissed)\b/i,
  /\bfired\s+(after|for|because|when)\b/i,
  /\bpushed out\b/i,
  /\bconstructive (discharge|dismissal)\b/i,
  /\bhostile work(place| environment)\b/i,
  /\bwhistleblow(er|ing)?\b/i,
  /\breport(ing|ed)?\s+(harassment|discrimination|abuse|misconduct)\b/i,
  /\b(assault|abused?)\b/i,
];

/**
 * True if any of the provided text fragments (topic, keywords, headings, brief
 * fields) reference a sensitive, emotionally charged situation.
 */
export function isSensitiveTopic(
  ...parts: (string | null | undefined | string[])[]
): boolean {
  const text = parts
    .flat()
    .filter((p): p is string => Boolean(p))
    .join(" ");
  if (!text.trim()) return false;
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

/**
 * Prompt block that overrides the default brand voice for sensitive topics.
 * Prepend to the user prompt so it takes priority over the generic tone rules.
 */
export const SENSITIVE_TONE_OVERRIDE = `SENSITIVE TOPIC — TONE OVERRIDE (this takes priority over the default brand voice for this piece):
The reader is likely in a vulnerable, high-stress situation — they may have just been harassed, fired, retaliated against, or discriminated against. Lead with calm, human, supportive language before any legal reference.
- The opening hook and EVERY section opener must begin with plain, human acknowledgment of the reader's situation — not a legal definition, statute, or legal test. Put the person before the law.
- Legal accuracy is still required, but it comes AFTER the human framing, never as the first thing the reader encounters.
- No cold, encyclopedic, or transactional phrasing. Write the way you would talk to someone sitting across from you who is scared and unsure what to do.
- The call to action must feel supportive and low-pressure: an invitation to talk it through, not a sales push. Never guarantee an outcome.`;

/**
 * Convenience: returns the override block prefixed with a separator when the
 * topic is sensitive, or "" otherwise. Ready to concatenate into a prompt.
 */
export function sensitiveToneBlock(
  ...parts: (string | null | undefined | string[])[]
): string {
  return isSensitiveTopic(...parts) ? `${SENSITIVE_TONE_OVERRIDE}\n\n` : "";
}
