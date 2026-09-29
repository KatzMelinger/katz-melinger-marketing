/**
 * The "Changes made" log (Diana's Sept 28 spec, section 9).
 *
 * Every automatic change to a draft is recorded here, on the draft, in the
 * same shape as the seven drafts corrected by hand on September 28:
 * metadata.legal_fix_log = { previous_title, previous_body, changes: [...] }.
 * The panel reads it, each change can be undone on its own, and Approve waits
 * until a person has marked the log "Reviewed".
 *
 * Pure: no IO, so the undo logic is testable and the same code runs in the
 * API routes, the backfill and the generators.
 */

export type ChangeSource = "knowledge base" | "statute table" | "firm fact" | "brand rule" | "required element";

export type FixChange = {
  id: string;
  /** Where in the draft: the nearest heading, or "Top" / "End" / "Title". */
  where: string;
  from: string;
  to: string;
  reason: string;
  source: ChangeSource;
  /** Which rule or entry, e.g. "constant_mismatch", "nyll-196d". */
  source_ref?: string;
  /** Text immediately before the change, so a deletion can be put back. */
  anchor_before?: string;
  at: string;
  undone_at?: string;
  undone_by?: string;
};

export type FixLog = {
  previous_title?: string | null;
  previous_body?: string;
  /** Earlier versions, newest first, capped — the "save the full previous version" rule. */
  versions?: { at: string; title: string | null; body: string }[];
  changes: FixChange[];
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  /** Set when the rewrite found problems it must not patch. */
  full_redraft_needed?: string | null;
};

const MAX_VERSIONS = 5;

export function readFixLog(meta: Record<string, unknown> | null | undefined): FixLog {
  const raw = (meta?.legal_fix_log as Partial<FixLog> | undefined) ?? undefined;
  if (!raw) return { changes: [] };
  const changes = Array.isArray(raw.changes)
    ? raw.changes.map((c, i) => {
        const x = c as Partial<FixChange>;
        // The hand-corrected drafts have no ids or dates; give them stable ones.
        return {
          ...x,
          id: x.id ?? `legacy-${i}`,
          at: x.at ?? "2026-09-28T00:00:00.000Z",
          where: x.where ?? "",
          from: x.from ?? "",
          to: x.to ?? "",
          reason: x.reason ?? "",
          source: (x.source ?? "knowledge base") as ChangeSource,
        };
      })
    : [];
  return { ...raw, changes } as FixLog;
}

/** Live (not undone) changes made since the log was last marked reviewed. */
export function unreviewedChanges(log: FixLog): FixChange[] {
  const reviewedAt = log.reviewed_at ? Date.parse(log.reviewed_at) : 0;
  return log.changes.filter((c) => !c.undone_at && Date.parse(c.at) > reviewedAt);
}

export function needsReview(log: FixLog): boolean {
  return unreviewedChanges(log).length > 0;
}

/** Merge a new run's changes into the stored log, saving the pre-run version. */
export function appendRun(
  log: FixLog,
  run: { previousTitle: string | null; previousBody: string; changes: FixChange[]; fullRedraft?: string | null },
): FixLog {
  if (run.changes.length === 0 && !run.fullRedraft) return log;
  const at = run.changes[0]?.at ?? new Date().toISOString();
  const versions = [
    { at, title: run.previousTitle, body: run.previousBody },
    ...(log.versions ?? []),
  ].slice(0, MAX_VERSIONS);
  return {
    ...log,
    previous_title: run.previousTitle,
    previous_body: run.previousBody,
    versions,
    changes: [...log.changes, ...run.changes],
    full_redraft_needed: run.fullRedraft ?? log.full_redraft_needed ?? null,
  };
}

export type UndoResult = { ok: true; body: string; title: string | null } | { ok: false; error: string };

/**
 * Put one change back, leaving every other change in place (section 9's
 * "undoing one change restores only that sentence").
 */
export function undoChange(body: string, title: string | null, change: FixChange): UndoResult {
  if (change.where === "Title") {
    if ((title ?? "") !== change.to) return { ok: false, error: "The title has been edited since this change." };
    return { ok: true, body, title: change.from };
  }
  // Insertion or replacement: the new text must still be there, exactly once.
  if (change.to) {
    const first = body.indexOf(change.to);
    if (first === -1) return { ok: false, error: "The changed text is no longer in the draft (it was edited since)." };
    if (body.indexOf(change.to, first + 1) !== -1 && !change.anchor_before) {
      return { ok: false, error: "The changed text appears more than once, so the right one cannot be picked." };
    }
    let at = first;
    if (change.anchor_before) {
      const anchored = body.indexOf(change.anchor_before + change.to);
      if (anchored !== -1) at = anchored + change.anchor_before.length;
    }
    const next = body.slice(0, at) + change.from + body.slice(at + change.to.length);
    return { ok: true, body: tidy(next), title };
  }
  // Deletion: put the removed text back after its anchor.
  if (!change.anchor_before) return { ok: false, error: "No position was recorded for this deletion." };
  const pos = body.indexOf(change.anchor_before);
  if (pos === -1) return { ok: false, error: "The text around this deletion was edited, so it cannot be put back." };
  const at = pos + change.anchor_before.length;
  return { ok: true, body: tidy(body.slice(0, at) + change.from + body.slice(at)), title };
}

function tidy(s: string): string {
  return s.replace(/\n{3,}/g, "\n\n");
}

/** Nearest heading above an offset, for the "where" column. */
export function whereIs(body: string, index: number): string {
  const before = body.slice(0, Math.max(0, index));
  const headings = [...before.matchAll(/^#{1,4}\s+(.+)$/gm)];
  const last = headings[headings.length - 1];
  return last ? last[1].replace(/[*_`]/g, "").trim().slice(0, 80) : "Top";
}

let seq = 0;
export function changeId(): string {
  seq = (seq + 1) % 1_000_000;
  return `c${Date.now().toString(36)}${seq.toString(36)}`;
}
