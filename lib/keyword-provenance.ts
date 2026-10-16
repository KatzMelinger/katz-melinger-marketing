/**
 * Data provenance on every SEO number (Oct 6 spec, Task 17).
 *
 * Keyword Research (Discover, Expand, Gaps) asks a model for keywords, and the
 * model also returned volumes and difficulties: 160, 180, 195, 220 and 290 on
 * October 2, values no Google Ads volume bucket has. So every keyword row in a
 * result is looked up in DataForSEO: a real number replaces the model's and is
 * marked "dataforseo" with the date it was fetched; a number DataForSEO does
 * not have stays, marked "ai_estimate", shown grey as an estimate and never
 * used to choose a keyword (lib/keyword-selection.ts uses DataForSEO only).
 *
 * The same screen suggested "contingency vs. hourly arrangements" for a
 * collections page. Every AI-written suggestion is checked against the fee
 * rule (lib/fee-language.ts and Trap 27) and the firm facts before display; a
 * hit is removed, and a keyword that is itself about fees is dropped.
 */
import { getKeywordMetrics } from "./dataforseo";
import { blockingFeeHits, findFeeLanguage } from "./fee-language";
import { findFirmFactClaims } from "./firm-facts";
import { matchTrap, type KnownTrap } from "./known-traps";
import { OCT6_TRAPS } from "./known-traps-oct6";

export type NumberSource = "dataforseo" | "gsc" | "ai_estimate";

/** Model-written prose fields on Keyword Research results. */
const TEXT_KEYS = new Set([
  "contentSuggestion",
  "opportunity",
  "reason",
  "strategy",
  "topic",
  "contentFormat",
  "summary",
  "angle",
  "rationale",
  "recommendation",
]);

const FEE_TRAPS: KnownTrap[] = OCT6_TRAPS.filter((t) => t.number === "27" || t.number === "27es").map((t) => ({
  ...t,
  id: `oct6-${t.number}`,
  enabled: true,
}));

/** Why this text must not be shown, or null. */
export function suggestionProblem(text: string): string | null {
  if (!text?.trim()) return null;
  if (blockingFeeHits(findFeeLanguage(text)).length) return "mentions fees (firm rule)";
  if (FEE_TRAPS.some((t) => matchTrap(t, text).length > 0)) return "mentions fees (Trap 27)";
  const ban = findFirmFactClaims(text).find((h) => h.severity === "ban");
  if (ban) return `firm rule: ${ban.rule}`;
  return null;
}

type Obj = Record<string, unknown>;

function walk(v: unknown, visit: (o: Obj) => void) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, visit));
  else if (v && typeof v === "object") {
    visit(v as Obj);
    for (const x of Object.values(v as Obj)) walk(x, visit);
  }
}

/** Drop keyword rows marked removed from every array. */
function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => !(x && typeof x === "object" && (x as Obj).removed === true)).map(prune);
  if (v && typeof v === "object") {
    const o = v as Obj;
    for (const k of Object.keys(o)) o[k] = prune(o[k]);
    return o;
  }
  return v;
}

/**
 * Tag every number with its source, replace estimates with DataForSEO where
 * it has them, and screen every suggestion. Mutates and returns `result`.
 * Never throws: on a DataForSEO failure everything is marked an estimate.
 */
export async function applyProvenance(result: unknown): Promise<unknown> {
  const rows: Obj[] = [];
  walk(result, (o) => {
    if (typeof o.keyword === "string" && o.keyword.trim()) rows.push(o);
  });
  const metrics = await getKeywordMetrics(rows.map((r) => String(r.keyword))).catch(() => new Map());
  let real = 0;
  let estimates = 0;
  let removed = 0;

  for (const r of rows) {
    const kw = String(r.keyword).toLowerCase().trim();
    if (suggestionProblem(kw)) {
      r.removed = true;
      removed++;
      continue;
    }
    const m = metrics.get(kw);
    if (m && m.volume != null) {
      if (typeof r.volume === "number" && r.volume !== m.volume) r.aiVolume = r.volume;
      r.volume = m.volume;
      r.volumeSource = "dataforseo" satisfies NumberSource;
      r.fetchedAt = m.fetchedAt;
      r.trend = m.monthly;
      if (m.difficulty != null) {
        r.difficulty = m.difficulty;
        r.difficultySource = "dataforseo" satisfies NumberSource;
      } else {
        r.difficultySource = "ai_estimate" satisfies NumberSource;
      }
      real++;
    } else {
      r.volumeSource = "ai_estimate" satisfies NumberSource;
      r.difficultySource = "ai_estimate" satisfies NumberSource;
      estimates++;
    }
  }

  // Prose and totals.
  walk(result, (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (TEXT_KEYS.has(k) && typeof v === "string") {
        const why = suggestionProblem(v);
        if (why) {
          o[k] = "";
          o[`${k}Removed`] = why;
          removed++;
        }
      }
      if (/^estimated/i.test(k) && typeof v === "number") o[`${k}Source`] = "ai_estimate" satisfies NumberSource;
    }
    if (Array.isArray(o.suggestedKeywords)) {
      o.suggestedKeywords = (o.suggestedKeywords as unknown[]).filter((s) => typeof s !== "string" || !suggestionProblem(s));
    }
  });

  const out = prune(result) as Obj;
  if (out && typeof out === "object" && !Array.isArray(out)) {
    out.provenance = { checkedAt: new Date().toISOString(), dataforseo: real, estimates, removedSuggestions: removed };
  }
  return out;
}
