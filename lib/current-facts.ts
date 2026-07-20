/**
 * Current verified statutory figures — the authoritative source of truth the
 * generators use to REPLACE stale numbers.
 *
 * A refresh carried 2023/2024 minimum-wage and salary-threshold figures forward
 * as current because the "preserve accurate content" rule protected them and the
 * refresh path injected no reference facts. This file gives the generator the
 * current values (with effective dates) so it can overwrite superseded numbers,
 * and lets the freshness gate show the reviewer the correct value.
 *
 * Code-seeded for now (update a value = one-line change / PR). Can move to a
 * `current_facts` table + admin UI later without changing callers.
 *
 * IMPORTANT: keep these current. When the law changes, update the value AND the
 * effectiveDate. Stale entries here become stale entries on the site.
 */

export type CurrentFact = {
  id: string;
  /** Human label shown to the reviewer. */
  label: string;
  /** The authoritative current value, formatted for prose (e.g. "$17.00"). */
  value: string;
  /** Where it applies. */
  jurisdiction: string;
  /** ISO date the value took effect. */
  effectiveDate: string;
  /** Keywords used to match a draft/flag to this fact. */
  keywords: string[];
};

export const CURRENT_FACTS: CurrentFact[] = [
  {
    id: "ny-min-wage-downstate-2026",
    label: "NY minimum wage (NYC, Long Island, Westchester)",
    value: "$17.00 per hour",
    jurisdiction: "New York City, Long Island, Westchester",
    effectiveDate: "2026-01-01",
    keywords: ["minimum wage", "min wage", "hourly wage", "wage rate"],
  },
  {
    id: "ny-min-wage-upstate-2026",
    label: "NY minimum wage (rest of New York State)",
    value: "$16.00 per hour",
    jurisdiction: "Rest of New York State (outside NYC, Long Island, Westchester)",
    effectiveDate: "2026-01-01",
    keywords: ["minimum wage", "min wage", "hourly wage", "wage rate", "upstate"],
  },
  {
    id: "ny-exempt-threshold-downstate-2026",
    label: "NY executive/administrative exempt salary threshold (NYC + downstate)",
    value: "$1,275.00 per week",
    jurisdiction: "New York City and downstate counties (Nassau, Suffolk, Westchester)",
    effectiveDate: "2026-01-01",
    keywords: [
      "salary threshold", "exempt threshold", "salary basis", "exemption threshold",
      "executive exemption", "administrative exemption", "overtime exemption",
      "exempt salary", "salary level",
    ],
  },
];

const norm = (s: string) => s.toLowerCase();

/**
 * Facts whose keywords appear in the given text. `facts` defaults to the
 * code-seeded list; the DB-backed store (lib/current-facts-store.ts) passes the
 * live, staff-edited list instead.
 */
export function relevantFacts(text: string, facts: CurrentFact[] = CURRENT_FACTS): CurrentFact[] {
  const hay = norm(text ?? "");
  return facts.filter((f) => f.keywords.some((k) => hay.includes(norm(k))));
}

/**
 * Prompt block of authoritative current figures. Pass the draft body / keywords
 * to scope it to relevant facts; with no scope, includes all. `facts` defaults
 * to the code-seeded list; callers with the live list pass it explicitly.
 */
export function renderCurrentFactsBlock(
  scopeText?: string,
  facts: CurrentFact[] = CURRENT_FACTS,
): string {
  const scoped = scopeText ? relevantFacts(scopeText, facts) : facts;
  if (scoped.length === 0) return "";
  const lines = scoped.map(
    (f) => `- ${f.label}: ${f.value} (${f.jurisdiction}), effective ${f.effectiveDate}.`,
  );
  return [
    "CURRENT VERIFIED FIGURES (authoritative). Use these EXACT values where the",
    "topic calls for them. If the page states a different or older figure for the",
    "same item, REPLACE it with the value below. Never present a superseded figure",
    "as current, and never invent a figure that is not listed here.",
    ...lines,
  ].join("\n");
}

/**
 * Given a flagged token from the freshness check (e.g. a dollar amount or a
 * "minimum wage" mention) plus its sentence, return the matching current fact so
 * the reviewer sees the correct value. Matches on the sentence's keywords, not
 * the number, so an outdated "$16.50" still maps to the right fact.
 */
export function matchCurrentFact(
  flag: { match?: string; sentence?: string },
  facts: CurrentFact[] = CURRENT_FACTS,
): CurrentFact | null {
  const hay = norm(`${flag?.sentence ?? ""} ${flag?.match ?? ""}`);
  if (!hay.trim()) return null;
  // Prefer the fact with the most keyword hits in the sentence.
  let bestHits = 0;
  let winners: CurrentFact[] = [];
  for (const f of facts) {
    const hits = f.keywords.filter((k) => hay.includes(norm(k))).length;
    if (hits === 0) continue;
    if (hits > bestHits) {
      bestHits = hits;
      winners = [f];
    } else if (hits === bestHits) {
      winners.push(f);
    }
  }
  // Ambiguous — multiple facts tie at the top (e.g. NYC $17 vs rest-of-state $16
  // minimum wage, when the sentence gives no jurisdiction cue). Don't guess a
  // value the reviewer might wrongly trust; surface the flag with no suggestion.
  if (winners.length !== 1) return null;
  return winners[0];
}
