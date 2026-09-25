/**
 * The known-traps gate: the deterministic floor under the legal layer.
 *
 * The matcher (lib/known-traps.ts) and the seeded traps
 * (supabase/content_known_traps_schema.sql) have both existed since August,
 * but the only thing that ever ran them was the manual sweep on /content/traps.
 * A trap that fires nowhere near an approval cannot hold a draft, which is how
 * the pregnancy set went out stating a New York employer minimum of four
 * employees — a trap seeded, verbatim, months earlier.
 *
 * WHY THIS IS SEPARATE FROM runLegalCheck
 *
 * They fail in opposite directions and cost opposite amounts.
 *
 * runLegalCheck (lib/legal-verify.ts) reasons: it classifies claims, retrieves
 * the cited authority and compares. That costs a classification call plus up to
 * two verification calls per claim, each carrying statute text, and it can only
 * reach a claim that CITES something. "New York requires four or more
 * employees" cites nothing, so the expensive layer never had a route to it.
 *
 * This gate does not reason at all. It asks whether a shape of text that was
 * wrong before appears again. No model call, no retrieval, no flag — so it runs
 * on every asset, always, and costs nothing to leave on.
 *
 * The division of labour that follows: traps catch the known errors (cheaply,
 * every time), and the authority loop is spent only where a citation actually
 * needs verifying. That is what makes it affordable to check a blog properly
 * without paying to re-check its five repurposed children and their Spanish
 * companions.
 *
 * SEVERITY, AND WHY MOST TRAPS DO NOT BLOCK
 *
 * lib/known-traps.ts is emphatic that a hit is a suspicion, not a verdict —
 * most patterns match correct writing too. That stays true here. A trap's own
 * `severity` column decides: only `critical` holds the draft, and the seeded
 * rows reserve it for the handful where the matched shape is wrong outright
 * (the NYSHRL employer-size threshold is one). Everything else becomes a
 * finding a reviewer reads. Promoting every hit to a blocker would rebuild the
 * flat, unreadable panel this system is trying to get away from.
 */

import { getSupabaseAdmin } from "./supabase-server";
import { fingerprintFinding, type NormalizedFinding } from "./content-findings";
import { matchTrap, type KnownTrap } from "./known-traps";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** True when the error means the traps migration has not been run. */
function isMissingTable(message: string | undefined): boolean {
  return !!message && /content_known_traps|does not exist|schema cache/i.test(message);
}

/**
 * Enabled traps for a tenant. Returns [] when the table is missing rather than
 * throwing: an unmigrated database must not make every approval fail, and the
 * caller distinguishes "no traps" from "traps failed to load" via `ok`.
 */
export async function loadEnabledTraps(
  tenantId: string,
): Promise<{ ok: boolean; traps: KnownTrap[] }> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("content_known_traps")
      .select("id, label, match_type, pattern, unless, severity, note, enabled")
      .eq("tenant_id", tenantId)
      .eq("enabled", true);
    if (error) {
      if (isMissingTable(error.message)) return { ok: true, traps: [] };
      console.warn("[trap-gate] could not load traps:", error.message);
      return { ok: false, traps: [] };
    }
    return {
      ok: true,
      traps: (data ?? []).map((r: any) => ({
        id: r.id,
        label: r.label,
        matchType: r.match_type,
        pattern: r.pattern,
        unless: Array.isArray(r.unless) ? r.unless : [],
        severity: r.severity,
        note: r.note,
        enabled: r.enabled !== false,
      })),
    };
  } catch (e) {
    console.warn("[trap-gate] could not load traps:", e);
    return { ok: false, traps: [] };
  }
}

export type TrapCheckResult = {
  findings: NormalizedFinding[];
  /** Titles of the findings that must hold the draft (critical traps only). */
  blockingReasons: string[];
  /** True when the traps could not be loaded — an infra failure, not a pass. */
  failed: boolean;
};

/**
 * Run every enabled trap over one body.
 *
 * Findings land under source `legal` so they sit in the Legal tab beside the
 * authority-verification findings — from a reviewer's side they are the same
 * concern, and splitting them across two tabs would mean reading both to know
 * whether the law in a draft is right. `ruleId` is namespaced `trap:<id>` so
 * the two producers stay distinguishable in the data even though they share a
 * tab.
 *
 * One finding per trap, not one per hit: a trap that matches the same mistake
 * in the body and again in the FAQ is one thing to fix, and the excerpt points
 * at the first occurrence. The fingerprint is keyed on the trap plus that
 * excerpt, so editing the offending sentence retires the finding the same way
 * every other check behaves.
 */
export async function runTrapCheck(
  body: string,
  opts: { tenantId: string },
): Promise<TrapCheckResult> {
  const { ok, traps } = await loadEnabledTraps(opts.tenantId);
  if (!ok) return { findings: [], blockingReasons: [], failed: true };
  if (!traps.length || !body.trim()) {
    return { findings: [], blockingReasons: [], failed: false };
  }

  const findings: NormalizedFinding[] = [];
  const blockingReasons: string[] = [];

  for (const trap of traps) {
    const hits = matchTrap(trap, body);
    if (!hits.length) continue;

    const first = hits.reduce((a, b) => (a.index <= b.index ? a : b));
    const title =
      hits.length > 1
        ? `Known trap: ${trap.label} (${hits.length} places)`
        : `Known trap: ${trap.label}`;

    findings.push({
      fingerprint: fingerprintFinding("legal", `trap:${trap.id}`, first.excerpt),
      source: "legal",
      ruleId: `trap:${trap.id}`,
      severity: trap.severity,
      title,
      // The note is the whole point of a trap row: it says what is actually
      // wrong and what the correct statement is. A reviewer reads this, not
      // the pattern that found it.
      detail: trap.note,
      excerpt: first.excerpt,
      fix:
        trap.severity === "critical"
          ? "Correct this before the draft can be approved — see the note for the current rule."
          : "Check this passage against the note. It may well be fine; the pattern has been wrong before.",
      claimType: undefined,
      sourceChecked: null,
      jurisdiction: null,
    });

    if (trap.severity === "critical") blockingReasons.push(trap.label);
  }

  return { findings, blockingReasons, failed: false };
}
