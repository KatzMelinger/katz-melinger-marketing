/**
 * Who gets credit for a lead:
 *   - Intake credit: the lead's Legal Assistant # 1 *before* signing.
 *   - Sales credit (changed 2026-10-05): whoever took the lead's last
 *     Scheduled Call before signing — the initials that start its Call Topic
 *     ("AM - Call w/ …"), else its KM invitee. The Attorney/Reviewer is often
 *     not the person on the call (Kenneth reviews hundreds of leads but took 2
 *     of 2026's ~300 sales calls). Leads with no scheduled call fall back to
 *     the Attorney/Reviewer before signing, below. A choice made on the review
 *     page always wins.
 *
 * Airtable overwrites both at signing ("Moved to Matters DB") with the matter's
 * legal assistant and supervising attorney, so for a signed lead we use, in
 * order:
 *   1. snapshot — the last values the hourly snapshot saw while it was
 *                 unsigned, or what someone set on the review page (manual)
 *   2. notes    — intake only, and marked estimated: the first Follow-Up Notes
 *                 entry ("AR 4/9/26 …") by an intake person before signing
 *   3. nobody   — shown as "Unattributed"
 * Unsigned leads haven't been overwritten, so their current values are used.
 *
 * Measured 2026-10-03 against unsigned leads (where the truth is still in
 * Airtable): the notes guess matched Legal Assistant # 1 58% of the time and
 * the Reviewer only 39%, so notes are never used for sales credit.
 *
 * Only people in sales_staff (credit_eligible) can be credited; anyone else
 * in those fields (matter staff, Noella, Agnes) counts as nobody.
 */

import type { SalesStaff } from "@/lib/sales-staff";

import { outcomeOf, type IntakeRecord, type ScheduledCall } from "./intakes";

export type CreditSource = "airtable" | "snapshot" | "manual" | "notes" | "call";

export type LeadCredit = {
  intake: SalesStaff | null;
  intakeSource: CreditSource | null;
  sales: SalesStaff | null;
  salesSource: CreditSource | null;
};

export type StaffSnapshot = {
  legal_assistant: string | null;
  reviewer: string | null;
  source: "snapshot" | "manual";
};

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function staffByFullName(name: string | null, staff: SalesStaff[]): SalesStaff | null {
  if (!name) return null;
  const n = fold(name);
  return staff.find((s) => fold(s.full_name) === n) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Follow-Up Notes                                                            */
/* -------------------------------------------------------------------------- */

export type NoteEntry = { initials: string; date: Date | null };

// "AR 4/9/26 …", "(AC) 5/20: …", "kk3-23", "GO. 05/18", "- GM 04/10 …"
const ENTRY = /^\s*[-•]?\s*\(?([A-Za-z]{2,3})\)?[.:]?\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/;

/** Initialed, dated entries in the order they were written. */
export function parseNoteEntries(notes: string | null, createdAt: string): NoteEntry[] {
  if (!notes) return [];
  const created = new Date(createdAt);
  const out: NoteEntry[] = [];
  for (const line of notes.split(/\r?\n/)) {
    const m = line.match(ENTRY);
    if (!m) continue;
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let year: number;
    if (m[4]) {
      year = Number(m[4]);
      if (year < 100) year += 2000;
    } else {
      // No year written: the note follows the lead's creation, so a month
      // earlier than the creation month means the following year.
      year = created.getUTCFullYear() + (month < created.getUTCMonth() + 1 ? 1 : 0);
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    out.push({ initials: m[1].toUpperCase(), date: Number.isNaN(date.getTime()) ? null : date });
  }
  return out;
}

/** Note authors before signing, in order, mapped to staff (others dropped). */
export function noteAuthorsBeforeSigning(lead: IntakeRecord, staff: SalesStaff[]): SalesStaff[] {
  const byInitials = new Map(staff.filter((s) => s.initials).map((s) => [s.initials!.toUpperCase(), s]));
  const cutoff = lead.retainedAt ? new Date(`${lead.retainedAt.slice(0, 10)}T23:59:59Z`) : null;
  return parseNoteEntries(lead.followUpNotes, lead.createdAt)
    .filter((e) => !cutoff || !e.date || e.date <= cutoff)
    .map((e) => byInitials.get(e.initials))
    .filter((s): s is SalesStaff => s != null);
}

/**
 * Best guess at the intake person from the notes: the first entry by someone
 * who only does intake, else the first by anyone who does intake (Andres and
 * Gabriel Moreno do both).
 */
export function intakeGuessFromNotes(lead: IntakeRecord, staff: SalesStaff[]): SalesStaff | null {
  const entries = noteAuthorsBeforeSigning(lead, staff);

  // Intake: the first entry by someone who only does intake; failing that,
  // the first by anyone who does intake (Andres and Gabriel Moreno do both).
  return (
    entries.find((s) => s.roles.includes("intake") && !s.roles.includes("sales")) ??
    entries.find((s) => s.roles.includes("intake")) ??
    null
  );
}

/* -------------------------------------------------------------------------- */
/* Sales calls                                                                */
/* -------------------------------------------------------------------------- */

/** The staff member who took a Scheduled Call: topic initials, else invitee email. */
export function callTaker(call: ScheduledCall, staff: SalesStaff[]): SalesStaff | null {
  if (call.takerInitials) {
    const byInitials = staff.find((s) => s.initials?.toUpperCase() === call.takerInitials);
    if (byInitials) return byInitials;
  }
  for (const email of call.inviteeEmails) {
    const byEmail = staff.find((s) => s.email && s.email.toLowerCase() === email.toLowerCase());
    if (byEmail) return byEmail;
  }
  return null;
}

/** Sales calls on or before signing (all of them for an unsigned lead), with who took each. */
export function salesCallsBeforeSigning(lead: IntakeRecord, staff: SalesStaff[]) {
  const cutoff = lead.retainedAt ? `${lead.retainedAt.slice(0, 10)}T23:59:59Z` : null;
  return lead.salesCalls
    .filter((c) => !cutoff || !c.at || c.at <= cutoff)
    .map((c) => ({ call: c, taker: callTaker(c, staff) }));
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

export function creditFor(
  lead: IntakeRecord,
  snapshot: StaffSnapshot | undefined,
  staff: SalesStaff[],
): LeadCredit {
  const lastTaker = salesCallsBeforeSigning(lead, staff)
    .map((c) => c.taker)
    .filter((s): s is SalesStaff => s != null)
    .at(-1) ?? null;

  if (outcomeOf(lead.status) !== "signed") {
    const intake = staffByFullName(lead.legalAssistant, staff);
    const sales = lastTaker ?? staffByFullName(lead.reviewer, staff);
    return {
      intake,
      intakeSource: intake ? "airtable" : null,
      sales,
      salesSource: lastTaker ? "call" : sales ? "airtable" : null,
    };
  }

  const snapIntake = staffByFullName(snapshot?.legal_assistant ?? null, staff);
  const snapSales = staffByFullName(snapshot?.reviewer ?? null, staff);
  // A manual row is a decision, including "nobody": never second-guess it.
  const manual = snapshot?.source === "manual";
  const intake = snapIntake ?? (manual ? null : intakeGuessFromNotes(lead, staff));
  return {
    intake,
    intakeSource: snapIntake ? snapshot!.source : intake ? "notes" : null,
    // Review-page choice, then the person on the last sales call, then the
    // reviewer the snapshot saw before signing.
    sales: manual ? snapSales : (lastTaker ?? snapSales),
    salesSource: manual ? (snapSales ? "manual" : null) : lastTaker ? "call" : snapSales ? snapshot!.source : null,
  };
}
