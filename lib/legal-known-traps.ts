/**
 * Rule 3.14/B6 — known traps: text patterns that have already been wrong once.
 *
 * "A trap is a SEARCH PATTERN, not a legal fact... it needs no knowledge base,
 * no retrieval, and no judgment about what the law says — only 'here is a
 * shape of text that has been wrong before, show me everywhere it appears.'"
 * (supabase/content_known_traps_schema.sql, which also seeded the exact traps
 * spec 3.14 names — FMLA/EEOC, FMLA/Title VII, the 198-c waiver mix-up, the
 * 2611(4) pinpoint, the NYSHRL employer-size threshold, severe-or-pervasive,
 * and the 180-day EEOC deadline.)
 *
 * The table and its admin CRUD (app/api/content/traps/route.ts) existed, but
 * nothing ever matched a draft's text against it — this is that missing
 * piece, wired into lib/legal-verify.ts's runLegalCheck.
 *
 * A hit is a SUSPICION for a human to check, never an auto-verdict — same
 * posture as every other "cannot be settled by a lookup" finding in this
 * layer (3.5's tie-breaker: ambiguous defaults to human).
 */

import { getSupabaseAdmin } from "./supabase-server";
import { fingerprintFinding, type NormalizedFinding, type FindingSeverity } from "./content-findings";

export type KnownTrap = {
  id: string;
  label: string;
  matchType: "phrase" | "regex" | "all_of" | "all_of_unless";
  pattern: string;
  unless: string[];
  severity: FindingSeverity;
  note: string;
};

/** JSON array or comma-separated list — the admin UI accepts either (schema comment). */
function parseTerms(pattern: string): string[] {
  try {
    const parsed = JSON.parse(pattern);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    /* not JSON — fall through to comma-split */
  }
  return pattern.split(",").map((s) => s.trim()).filter(Boolean);
}

/** A trailing `*` makes a term a prefix match; otherwise it's bounded on both
 *  sides so "198-c" doesn't match "198-cx" (schema comment, verbatim rule). */
function termRegex(term: string): RegExp {
  const isPrefix = term.endsWith("*");
  const base = (isPrefix ? term.slice(0, -1) : term).trim();
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return isPrefix ? new RegExp(`\\b${escaped}`, "i") : new RegExp(`\\b${escaped}\\b`, "i");
}

function matchesTrap(body: string, trap: KnownTrap): boolean {
  switch (trap.matchType) {
    case "phrase":
      return body.toLowerCase().includes(trap.pattern.toLowerCase());
    case "regex":
      try {
        return new RegExp(trap.pattern, "i").test(body);
      } catch {
        return false; // a malformed saved pattern must never crash the check
      }
    case "all_of":
    case "all_of_unless": {
      const terms = parseTerms(trap.pattern);
      if (terms.length === 0 || !terms.every((t) => termRegex(t).test(body))) return false;
      if (trap.matchType === "all_of_unless" && trap.unless.some((u) => termRegex(u).test(body))) {
        return false; // the draft already says the right thing — cleared
      }
      return true;
    }
    default:
      return false;
  }
}

/** Best-effort surrounding context for the reviewer — a trap isn't anchored
 *  to one exact span the way a single-sentence finding is, so this just
 *  points at wherever the pattern actually landed. */
function findExcerpt(body: string, trap: KnownTrap): string | null {
  let idx = -1;
  if (trap.matchType === "phrase") {
    idx = body.toLowerCase().indexOf(trap.pattern.toLowerCase());
  } else if (trap.matchType === "regex") {
    try {
      idx = new RegExp(trap.pattern, "i").exec(body)?.index ?? -1;
    } catch {
      idx = -1;
    }
  } else {
    for (const t of parseTerms(trap.pattern)) {
      const m = termRegex(t).exec(body);
      if (m) {
        idx = m.index;
        break;
      }
    }
  }
  if (idx < 0) return null;
  return body.slice(Math.max(0, idx - 40), Math.min(body.length, idx + 100)).trim();
}

export async function listEnabledTraps(tenantId: string): Promise<KnownTrap[]> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("content_known_traps")
      .select("id, label, match_type, pattern, unless, severity, note")
      .eq("tenant_id", tenantId)
      .eq("enabled", true);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      label: r.label as string,
      matchType: r.match_type as KnownTrap["matchType"],
      pattern: r.pattern as string,
      unless: Array.isArray(r.unless) ? (r.unless as string[]) : [],
      severity: r.severity as FindingSeverity,
      note: r.note as string,
    }));
  } catch {
    return [];
  }
}

export function findKnownTrapHits(body: string, traps: KnownTrap[]): KnownTrap[] {
  return traps.filter((t) => matchesTrap(body, t));
}

export function knownTrapFindings(body: string, hits: KnownTrap[]): NormalizedFinding[] {
  return hits.map((trap) => ({
    fingerprint: fingerprintFinding("legal", "known_trap", trap.label),
    source: "legal",
    ruleId: "known_trap",
    severity: trap.severity,
    title: `Known trap: ${trap.label}`,
    detail: trap.note,
    excerpt: findExcerpt(body, trap),
    fix: trap.note,
    sourceChecked: null,
    jurisdiction: null,
  }));
}

/** Loads this tenant's enabled traps and checks `body` against all of them. */
export async function checkKnownTraps(body: string, tenantId: string): Promise<NormalizedFinding[]> {
  const traps = await listEnabledTraps(tenantId);
  if (traps.length === 0) return [];
  return knownTrapFindings(body, findKnownTrapHits(body, traps));
}
