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

const HEALTH_RANK: Record<Health, number> = { on_track: 0, watch: 1, stalling: 2, critical: 3 };
function worseOf(a: Health, b: Health): Health {
  return HEALTH_RANK[b] > HEALTH_RANK[a] ? b : a;
}
function tierFromDays(days: number): Health {
  if (days >= 30) return "critical";
  if (days >= 14) return "stalling";
  if (days >= 7) return "watch";
  return "on_track";
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

      const staleness = daysSinceModified ?? daysOld;
      const reasons: string[] = [];
      let health = tierFromDays(staleness);
      if (staleness >= 7) reasons.push(`No update in ${staleness}d`);

      if (letterPendingDays != null) {
        if (letterPendingDays >= 14) {
          health = worseOf(health, "critical");
          reasons.push(`Engagement letter pending ${letterPendingDays}d`);
        } else if (letterPendingDays >= 7) {
          health = worseOf(health, "stalling");
          reasons.push(`Engagement letter pending ${letterPendingDays}d`);
        }
      }

      if (daysOld >= 60 && !l.hadSalesCall && !l.letterSentAt) {
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
