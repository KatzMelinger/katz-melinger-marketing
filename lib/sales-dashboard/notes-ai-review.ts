/**
 * AI staleness check for Pending Intakes: reads each case's Follow-Up Notes
 * and flags ones where the notes imply a concrete next step or promised
 * follow-up ("will call back Monday", "waiting on signed letter") that has
 * now passed, given how long it's actually been.
 *
 * Deliberately conservative — vague notes, or ones where the latest entry
 * already resolves the open item, come back stale:false. This is a second
 * opinion layered on the deterministic day-based health tiers in pending.ts,
 * not a replacement for them, and is called on demand (not on every page
 * load) to keep it cheap: the UI only sends the rows currently in view.
 */

import { CONTENT_SHORT_FORM_MODEL, extractJSON, getAnthropic } from "@/lib/anthropic";

export type NoteReviewInput = {
  id: string;
  notes: string;
  daysOld: number;
  daysSinceModified: number | null;
};

export type NoteStallFlag = { id: string; stale: boolean; reason: string };

const SYSTEM = `You triage follow-up notes on law-firm intake cases that have not yet signed, declined, or been referred out.

Each case gives you: how many days old the case is, how many days since its last recorded stage change, and its raw Follow-Up Notes (dated, initialed entries, oldest first).

Decide whether the notes name or imply a concrete next step, promise, or deadline ("will call back Monday", "sending the letter today", "waiting on client to return signed engagement letter", "follow up in 2 weeks") that — given how much time has actually passed — now looks overdue or stalled.

Default to stale: false when:
- the notes are vague with no specific implied action or timeframe
- the most recent entry already resolves or restarts the open item
- you are not reasonably sure

Only set stale: true when a specific implied action/timeframe has clearly passed without a newer note showing it happened.

Respond with ONLY a JSON object, no prose, no markdown fences:
{"results":[{"id":"<case id>","stale":true|false,"reason":"<one short sentence, <=140 chars>"}]}
Include exactly one entry per case id given, in any order.`;

async function reviewBatch(batch: NoteReviewInput[]): Promise<NoteStallFlag[]> {
  const today = new Date().toISOString().slice(0, 10);
  const user = JSON.stringify({
    today,
    cases: batch.map((b) => ({
      id: b.id,
      days_old: b.daysOld,
      days_since_last_update: b.daysSinceModified,
      notes: b.notes,
    })),
  });

  const res = await getAnthropic().messages.create({
    model: CONTENT_SHORT_FORM_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });

  const block = res.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
  const text = block?.text ?? "";
  const parsed = extractJSON<{ results: { id: string; stale: boolean; reason: string }[] }>(text);
  const byId = new Map(parsed.results.map((r) => [r.id, r]));
  // One flag per input id, even if the model dropped one — missing means
  // "couldn't tell," which is stale:false, not an error.
  return batch.map((b) => {
    const r = byId.get(b.id);
    return { id: b.id, stale: r?.stale ?? false, reason: r?.reason ?? "" };
  });
}

const BATCH_SIZE = 20;
const CONCURRENCY = 3;

export async function reviewNotesForStaleness(items: NoteReviewInput[]): Promise<NoteStallFlag[]> {
  const withNotes = items.filter((i) => i.notes.trim().length > 0);
  if (!withNotes.length) return [];

  const batches: NoteReviewInput[][] = [];
  for (let i = 0; i < withNotes.length; i += BATCH_SIZE) batches.push(withNotes.slice(i, i + BATCH_SIZE));

  const results: NoteStallFlag[] = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(chunk.map((b) => reviewBatch(b)));
    for (const r of settled) results.push(...r);
  }
  return results;
}
