/**
 * Rule 3, extended — validate a law's NAME, not only its facts (spec 3.12).
 *
 * The trap that motivated this: a wage-theft repurpose stated "The Wage Theft
 * Accountability Act now classifies unpaid wages as criminal larceny." No
 * such act exists — the real 2023 change was an amendment to New York's
 * larceny statute by Senate Bill S2832A. Nothing else in the legal layer
 * catches this: it names no formal citation (lib/legal-citation.ts finds
 * nothing to retrieve), so it never reaches Rule 3's fetch-and-compare path,
 * and it may not even read as an "interpretation" the classifier routes to a
 * human — a firm, factual-sounding sentence naming a specific act can look
 * exactly like a checkable claim.
 *
 * This is a narrower, purely textual check: find phrases shaped like a named
 * act or law, and flag any that don't match a real entry in the knowledge
 * base (lib/legal-knowledge-base.ts, entry_type='named_act') or one of its
 * aliases. A miss here is a SUSPICION like content_known_traps' patterns, not
 * a verdict — the knowledge base is a starter list (spec 3.1's note), so a
 * real act it hasn't caught up to yet will also get flagged. That is the
 * correct, safe failure direction: ambiguous defaults to human (3.5).
 */

import { getKnownActs, type KbActEntry } from "./legal-knowledge-base";
import type { NormalizedFinding } from "./content-findings";
import { fingerprintFinding } from "./content-findings";

/**
 * A phrase shaped like a named act or law: starts with a capitalized word,
 * runs through 1-8 more words (capitalized, or a small set of lowercase
 * connectors a real act name commonly contains — "of", "the", "and", "for"),
 * and ends on "Act" or "Law". Requiring 2+ meaningful words before the
 * trailing keyword is what keeps this from matching a bare back-reference
 * like "the Act" or "state law".
 */
const ACT_NAME_RE =
  /\b[A-Z][\w.'-]*(?:\s+(?:[A-Z][\w.'-]*|of|the|and|for|on|in))+\s+(?:Act|Law)\b/g;

/**
 * Spanish equivalent (spec 5.2): "la Ley de X", "Ley Federal de X". Spanish
 * puts the keyword FIRST ("Ley...") rather than last ("...Act"), so this is a
 * separate pattern, not a language option added to ACT_NAME_RE.
 *
 * The knowledge base's named-act entries only carry English labels/aliases
 * today (spec 3.1 is explicit that populating it is a legal task, not an
 * engineering one — guessing Spanish legal terminology here would be exactly
 * the kind of invented "fact" this layer exists to catch). So a CORRECTLY
 * translated real act name will also fail to match until an attorney adds its
 * Spanish alias — which is the same accepted failure mode already documented
 * above for an English act the knowledge base "hasn't caught up to yet": a
 * miss routes to a human, it is never treated as a verdict.
 */
const ACT_NAME_RE_ES =
  /\b(?:la |el )?(?:Ley|Acta)\s+(?:Federal\s+|Estatal\s+)?(?:de\s+|del\s+)?[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.'-]*(?:\s+(?:[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.'-]*|de|del|y|para|en|la|el|por|con|sobre|a))*\b/g;

const STOPWORD_PREFIX = /^(the|a|an)\s+/i;
const TRAILING_YEAR = /\s+of\s+\d{4}$/i;

function normalize(s: string): string {
  return s
    .replace(STOPWORD_PREFIX, "")
    .replace(TRAILING_YEAR, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `a` and `b` plausibly name the same act — substring containment
 *  either direction, after stripping articles/years. Tolerant on purpose:
 *  "Title VII of the Civil Rights Act" naming "Title VII" (an alias) should
 *  match without demanding an exact string. */
function samePlausibleAct(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export type UnverifiedAct = { name: string; index: number };

/** The matching logic, pure and DB-free — split out from findUnverifiedActs
 *  so it's directly testable against a fixture list instead of the live
 *  knowledge base. Every act-shaped phrase in the body that doesn't match
 *  anything in `known` (name or alias). Deduplicated by normalized name — a
 *  fabricated act repeated three times in one post is one error, not three. */
export function unverifiedActsAgainst(body: string, known: KbActEntry[]): UnverifiedAct[] {
  if (!body?.trim() || known.length === 0) return [];
  const seen = new Set<string>();
  const out: UnverifiedAct[] = [];
  for (const m of [...body.matchAll(ACT_NAME_RE), ...body.matchAll(ACT_NAME_RE_ES)]) {
    const name = m[0];
    const key = normalize(name);
    if (!key || seen.has(key)) continue;
    const isKnown = known.some(
      (act) => samePlausibleAct(name, act.label) || act.aliases.some((alias) => samePlausibleAct(name, alias)),
    );
    if (isKnown) continue;
    seen.add(key);
    out.push({ name, index: m.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Every act-shaped phrase in the body that doesn't match anything in the
 *  knowledge base (name or alias). */
export async function findUnverifiedActs(
  body: string,
  tenantId?: string,
): Promise<UnverifiedAct[]> {
  if (!body?.trim()) return [];
  const known = await getKnownActs(tenantId);
  if (known.length === 0) {
    // The knowledge base itself is unreadable — degrade to "nothing flagged"
    // rather than flagging every act name in the draft as unverified, which
    // would make a Supabase hiccup look like the draft invented a dozen laws.
    return [];
  }
  return unverifiedActsAgainst(body, known);
}

/** Turn unverified-act hits into findings for lib/legal-verify.ts to merge in. */
export function unverifiedActFindings(body: string, hits: UnverifiedAct[]): NormalizedFinding[] {
  return hits.map((hit) => {
    // A little surrounding context, not just the bare name, so a reviewer
    // sees the claim the name was doing work in.
    const start = Math.max(0, hit.index - 40);
    const end = Math.min(body.length, hit.index + hit.name.length + 80);
    const excerpt = body.slice(start, end).trim();
    return {
      fingerprint: fingerprintFinding("legal", "named_act_unverified", hit.name),
      source: "legal",
      ruleId: "named_act_unverified",
      // Not itself proven wrong — the knowledge base is a starter list — so
      // this routes to a human without hard-blocking Approve the way a
      // confirmed contradiction does (same posture as every other
      // "cannot verify, ambiguous defaults to human" finding in this layer).
      severity: "important",
      title: `Named act could not be verified: "${hit.name}"`,
      detail:
        `This name doesn't match anything in the legal knowledge base or its aliases. ` +
        `Confirm it's a real act — and if it's real but new, add it to legal_knowledge_base — ` +
        `or if it isn't, cite the actual statute or amendment.`,
      excerpt,
      fix: "An attorney should confirm this act name is real before this claim can clear.",
      sourceChecked: null,
      jurisdiction: null,
    };
  });
}
