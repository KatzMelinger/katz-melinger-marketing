/**
 * Pending Intakes report: every intake that hasn't signed, declined, or been
 * referred out (outcomeOf === "active") — the leads still sitting in the
 * funnel — with an aging bucket and a health tier so the team can triage
 * what's on track vs. stalling without reading every record.
 *
 * Health tiers use the day boundaries the sales team actually talks in:
 *   on_track  — touched within the last 7 days
 *   watch     — 7-13 days since the last touch
 *   stalling  — 14-29 days since the last touch (or a letter out 7-13 days)
 *   critical  — 30+ days since the last touch, a letter out 14+ days, or
 *               60+ days old with no sales call and no letter ever sent
 * "Last touch" is Airtable's Last Stage Change; cases with no stage-change
 * value fall back to how old the record itself is.
 */

import { parseNoteEntries } from "./credit";
import { outcomeOf } from "./intakes";
import type { Lead } from "./metrics";

const DAY = 24 * 60 * 60 * 1000;

export type AgeBucket = "0-29" | "30-59" | "60-89" | "90+";

export const AGE_BUCKETS: { key: AgeBucket; label: string }[] = [
  { key: "0-29", label: "Under 30 days" },
  { key: "30-59", label: "30-59 days" },
  { key: "60-89", label: "60-89 days" },
  { key: "90+", label: "90+ days" },
];

export function ageBucketOf(daysOld: number): AgeBucket {
  if (daysOld < 30) return "0-29";
  if (daysOld < 60) return "30-59";
  if (daysOld < 90) return "60-89";
  return "90+";
}

export type Health = "on_track" | "watch" | "stalling" | "critical";

export const HEALTH_LABEL: Record<Health, string> = {
  on_track: "On track",
  watch: "Watch",
  stalling: "Stalling",
  critical: "Critical",
};

/** Worst-first, for sorting and rollups. */
export const HEALTH_ORDER: Health[] = ["critical", "stalling", "watch", "on_track"];

const HEALTH_RANK: Record<Health, number> = { on_track: 0, watch: 1, stalling: 2, critical: 3 };
function worseOf(a: Health, b: Health): Health {
  return HEALTH_RANK[b] > HEALTH_RANK[a] ? b : a;
}

/**
 * Case Quality shifts the day thresholds instead of just riding along as a
 * column: a High-priority case reaches "stalling" in ~10 days where a Low one
 * takes ~18 — the same staleness means a bigger problem on a better case.
 */
const PRIORITY_SCALE: Record<"High" | "Medium" | "Low", number> = { High: 0.7, Medium: 1, Low: 1.3 };

function tierFromDays(days: number, scale: number): Health {
  if (days >= 30 * scale) return "critical";
  if (days >= 14 * scale) return "stalling";
  if (days >= 7 * scale) return "watch";
  return "on_track";
}

/** Stage in the pipeline, independent of health — where the case sits, not how stale it is. */
export type Stage = "not_contacted" | "sales_call_done" | "letter_out";

export const STAGE_LABEL: Record<Stage, string> = {
  not_contacted: "Not yet contacted",
  sales_call_done: "Sales call done, no letter",
  letter_out: "Letter out, awaiting signature",
};

function stageOf(l: Pick<Lead, "letterSentAt" | "hadSalesCall">): Stage {
  if (l.letterSentAt) return "letter_out";
  if (l.hadSalesCall) return "sales_call_done";
  return "not_contacted";
}

export type PendingRow = {
  id: string;
  name: string | null;
  status: string | null;
  category: string | null;
  /** Case Quality, reused as this report's priority signal. */
  priority: "High" | "Medium" | "Low" | null;
  source: string | null;
  owner: string | null;
  createdAt: string;
  daysOld: number;
  ageBucket: AgeBucket;
  stage: Stage;
  lastModifiedAt: string | null;
  daysSinceModified: number | null;
  letterSentAt: string | null;
  /** Days the engagement letter has been out, only while still unsigned. */
  letterPendingDays: number | null;
  lastNoteAt: string | null;
  daysSinceNote: number | null;
  lastNoteText: string | null;
  health: Health;
  reasons: string[];
};

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((now - t) / DAY);
}

function lastNoteLine(notes: string | null): string | null {
  if (!notes) return null;
  const lines = notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1) ?? null;
}

export function buildPendingReport(leads: Lead[], now = Date.now()): PendingRow[] {
  const rows = leads
    .filter((l) => outcomeOf(l.status) === "active")
    .map((l): PendingRow => {
      const daysOld = daysSince(l.createdAt, now) ?? 0;
      const daysSinceModified = daysSince(l.lastStageChange, now);
      const letterPendingDays = l.letterSentAt && !l.retainedAt ? daysSince(l.letterSentAt, now) : null;
      const notes = parseNoteEntries(l.followUpNotes, l.createdAt);
      const lastNote = notes.at(-1) ?? null;
      const lastNoteAt = lastNote?.date ? lastNote.date.toISOString() : null;
      const daysSinceNote = daysSince(lastNoteAt, now);

      const scale = l.quality ? PRIORITY_SCALE[l.quality] : 1;
      const staleness = daysSinceModified ?? daysOld;
      const reasons: string[] = [];
      let health = tierFromDays(staleness, scale);
      if (staleness >= 7) reasons.push(`No update in ${staleness}d`);

      const unweighted = tierFromDays(staleness, 1);
      if (HEALTH_RANK[health] > HEALTH_RANK[unweighted]) reasons.push("High priority — escalated");
      else if (HEALTH_RANK[health] < HEALTH_RANK[unweighted]) reasons.push("Low priority — extended grace period");

      if (letterPendingDays != null) {
        if (letterPendingDays >= 14 * scale) {
          health = worseOf(health, "critical");
          reasons.push(`Engagement letter pending ${letterPendingDays}d`);
        } else if (letterPendingDays >= 7 * scale) {
          health = worseOf(health, "stalling");
          reasons.push(`Engagement letter pending ${letterPendingDays}d`);
        }
      }

      if (daysOld >= 60 * scale && !l.hadSalesCall && !l.letterSentAt) {
        health = worseOf(health, "critical");
        reasons.push(`${daysOld}d old with no sales call or letter sent`);
      }

      return {
        id: l.id,
        name: l.name,
        status: l.status,
        category: l.category,
        priority: l.quality,
        source: l.source,
        owner: l.credit.sales?.full_name ?? l.credit.intake?.full_name ?? null,
        createdAt: l.createdAt,
        daysOld,
        ageBucket: ageBucketOf(daysOld),
        stage: stageOf(l),
        lastModifiedAt: l.lastStageChange,
        daysSinceModified,
        letterSentAt: l.letterSentAt,
        letterPendingDays,
        lastNoteAt,
        daysSinceNote,
        lastNoteText: lastNoteLine(l.followUpNotes),
        health,
        reasons,
      };
    });

  return rows.sort((a, b) => {
    if (HEALTH_RANK[b.health] !== HEALTH_RANK[a.health]) return HEALTH_RANK[b.health] - HEALTH_RANK[a.health];
    return b.daysOld - a.daysOld;
  });
}

/* -------------------------------------------------------------------------- */
/* Rollups                                                                    */
/* -------------------------------------------------------------------------- */

function healthCounts(rows: PendingRow[]): Record<Health, number> {
  const out = Object.fromEntries(HEALTH_ORDER.map((h) => [h, 0])) as Record<Health, number>;
  for (const r of rows) out[r.health]++;
  return out;
}

export type StageRollup = { stage: Stage; label: string; total: number; counts: Record<Health, number> };

/** Where the stalling actually sits in the funnel — pre-contact, post-call, or letter out. */
export function byStage(rows: PendingRow[]): StageRollup[] {
  return (["not_contacted", "sales_call_done", "letter_out"] as Stage[]).map((stage) => {
    const rs = rows.filter((r) => r.stage === stage);
    return { stage, label: STAGE_LABEL[stage], total: rs.length, counts: healthCounts(rs) };
  });
}

export type OwnerRollup = { owner: string; total: number; counts: Record<Health, number> };

/** Which rep is carrying the most stalling/critical cases, worst first. */
export function byOwner(rows: PendingRow[]): OwnerRollup[] {
  const map = new Map<string, PendingRow[]>();
  for (const r of rows) {
    const key = r.owner ?? "Unassigned";
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  return [...map.entries()]
    .map(([owner, rs]) => ({ owner, total: rs.length, counts: healthCounts(rs) }))
    .sort((a, b) => b.counts.critical + b.counts.stalling - (a.counts.critical + a.counts.stalling) || b.total - a.total);
}
