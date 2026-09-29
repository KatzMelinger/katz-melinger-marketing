/**
 * Pure logic behind the /calls dashboard (Diana's spec section 8).
 *
 * No I/O, no React — so the stat cards, the per-source table and the
 * "needs callback" list can be checked on fixture rows by
 * scripts/check-calls-stats.ts.
 *
 * Status model:
 *   - CallRail's `call_type` (answered | missed | abandoned | in_progress |
 *     voicemail | voicemail_transcription | outbound) is used when the row has
 *     it; older rows synced before we requested it fall back to the
 *     answered / voicemail flags, exactly as before.
 *   - "In progress" is only ever shown for the first 30 minutes. A call still
 *     marked in_progress (or with no answer, no voicemail and no duration)
 *     after that is Missed: that is the row Diana saw sitting in the log as a
 *     phantom "ringing" call that nobody called back.
 *
 * Unanswered = Missed or Voicemail, matching lib/lead-response.ts, where a
 * voicemail first contact is a lead that was NOT connected.
 */

import { normalizePhone } from "@/lib/lead-response";

export const FIRM_TZ = "America/New_York";
export const IN_PROGRESS_WINDOW_MS = 30 * 60 * 1000;

export type CallStatus = "Answered" | "Voicemail" | "Missed" | "In progress";

export type CallStatsRow = {
  id: string;
  customer_name?: string | null;
  customer_phone_number?: string | null;
  /** CallRail tracker name, e.g. "Website pool". Not a marketing source. */
  source_name?: string | null;
  /** CallRail `source`, e.g. "Google Organic", "SearchGPT", "Direct". */
  marketing_source?: string | null;
  call_type?: string | null;
  duration?: number | null;
  answered: boolean;
  voicemail?: boolean | null;
  direction?: string | null;
  start_time: string;
  first_call?: boolean | null;
  score?: { overall_score: number | null } | null;
};

function startMs(row: Pick<CallStatsRow, "start_time">): number {
  const t = new Date(row.start_time).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function callStatus(
  row: Pick<CallStatsRow, "answered" | "voicemail" | "call_type" | "duration" | "start_time">,
  nowMs: number,
): CallStatus {
  const type = (row.call_type ?? "").trim().toLowerCase();
  const fresh = nowMs - startMs(row) < IN_PROGRESS_WINDOW_MS;
  if (row.voicemail === true) return "Voicemail";
  if (row.answered === true) return "Answered";
  if (type) {
    if (type === "voicemail" || type === "voicemail_transcription") return "Voicemail";
    if (type === "answered") return "Answered";
    if (type === "in_progress") return fresh ? "In progress" : "Missed";
    // missed, abandoned (CallRail's docs spell it "abandonded"), outbound, anything else
    return "Missed";
  }
  // No call_type on this row: derive. No answer, no voicemail, no duration and
  // started under 30 minutes ago is most likely still ringing.
  if (!row.duration && fresh) return "In progress";
  return "Missed";
}

export function isUnanswered(status: CallStatus): boolean {
  return status === "Missed" || status === "Voicemail";
}

export function isInbound(row: Pick<CallStatsRow, "direction">): boolean {
  return (row.direction ?? "inbound").toLowerCase() !== "outbound";
}

/** Label for the Source column and filter. Marketing source first. */
export function sourceLabel(row: Pick<CallStatsRow, "marketing_source" | "source_name">): string {
  const m = row.marketing_source?.trim();
  if (m) return m;
  const s = row.source_name?.trim();
  if (s) return `(tracking line) ${s}`;
  return "Unknown";
}

export type CallStats = {
  total: number;
  answered: number;
  voicemail: number;
  missed: number;
  inProgress: number;
  /** Answered / total, one decimal. */
  answeredRatePct: number;
  avgDurationSeconds: number;
  scored: number;
  avgScore: number | null;
};

/**
 * Stat cards. Callers must pass EVERY call in the selected date range, not the
 * table-filtered list: the status / source / language / search filters narrow
 * the table only (spec 8.1).
 */
export function computeCallStats(rows: CallStatsRow[], nowMs: number): CallStats {
  let answered = 0;
  let voicemail = 0;
  let missed = 0;
  let inProgress = 0;
  let durSum = 0;
  let scored = 0;
  let scoreSum = 0;
  for (const r of rows) {
    const st = callStatus(r, nowMs);
    if (st === "Answered") answered++;
    else if (st === "Voicemail") voicemail++;
    else if (st === "Missed") missed++;
    else inProgress++;
    durSum += r.duration ?? 0;
    const s = r.score?.overall_score;
    if (s != null) {
      scored++;
      scoreSum += s;
    }
  }
  const total = rows.length;
  return {
    total,
    answered,
    voicemail,
    missed,
    inProgress,
    answeredRatePct: total ? Math.round((answered / total) * 1000) / 10 : 0,
    avgDurationSeconds: total ? durSum / total : 0,
    scored,
    avgScore: scored ? Math.round(scoreSum / scored) : null,
  };
}

export type SourceRow = {
  source: string;
  calls: number;
  answered: number;
  unanswered: number;
  unansweredPct: number;
};

/** "Calls and share unanswered by source" — inbound calls only. */
export function bySource(rows: CallStatsRow[], nowMs: number): SourceRow[] {
  const m = new Map<string, SourceRow>();
  for (const r of rows) {
    if (!isInbound(r)) continue;
    const key = sourceLabel(r);
    const cur = m.get(key) ?? { source: key, calls: 0, answered: 0, unanswered: 0, unansweredPct: 0 };
    cur.calls++;
    const st = callStatus(r, nowMs);
    if (st === "Answered") cur.answered++;
    else if (isUnanswered(st)) cur.unanswered++;
    m.set(key, cur);
  }
  const out = [...m.values()];
  for (const s of out) s.unansweredPct = s.calls ? Math.round((s.unanswered / s.calls) * 1000) / 10 : 0;
  return out.sort((a, b) => b.calls - a.calls || a.source.localeCompare(b.source));
}

export type RecoveryStatus = "new" | "called_back" | "reached" | "dead";
export type RecoveryRow = {
  phone: string;
  status: RecoveryStatus;
  last_action_at?: string | null;
};

/** Statuses that take a caller off the list (the /lead-response worklist's). */
export const WORKED_STATUSES: ReadonlySet<RecoveryStatus> = new Set(["called_back", "reached", "dead"]);

export type CallbackItem = {
  /** Normalized 10-digit phone — the key /api/leads/recovery uses. */
  phone: string;
  displayPhone: string;
  name: string;
  lastTry: string;
  /** Unanswered inbound calls since this caller last connected (or ever). */
  tries: number;
  source: string;
  firstTime: boolean;
  lastStatus: "Missed" | "Voicemail";
};

/**
 * Everyone whose most recent unanswered inbound call has not been followed by
 * an answered call (inbound, or an answered outbound callback), minus callers
 * already worked on /lead-response. A worked status only counts if it was set
 * AFTER the latest unanswered call — a caller marked "reached" last month who
 * rings and gets missed again is back on the list.
 */
export function needsCallback(
  rows: CallStatsRow[],
  recovery: Map<string, RecoveryRow>,
  nowMs: number,
): CallbackItem[] {
  const groups = new Map<string, CallStatsRow[]>();
  for (const r of rows) {
    const phone = normalizePhone(r.customer_phone_number);
    if (!phone || !r.start_time) continue;
    const g = groups.get(phone);
    if (g) g.push(r);
    else groups.set(phone, [r]);
  }

  const out: CallbackItem[] = [];
  for (const [phone, group] of groups) {
    group.sort((a, b) => startMs(a) - startMs(b));
    const statuses = group.map((c) => callStatus(c, nowMs));

    let lastUnanswered = -1;
    for (let i = group.length - 1; i >= 0; i--) {
      if (isInbound(group[i]) && isUnanswered(statuses[i])) {
        lastUnanswered = i;
        break;
      }
    }
    if (lastUnanswered < 0) continue;
    const answeredLater = statuses.some((s, i) => i > lastUnanswered && s === "Answered");
    if (answeredLater) continue;

    const last = group[lastUnanswered];
    const lastTry = last.start_time;
    const rec = recovery.get(phone);
    if (rec && WORKED_STATUSES.has(rec.status)) {
      const actedAt = rec.last_action_at ? new Date(rec.last_action_at).getTime() : NaN;
      // No timestamp: trust the status. Otherwise it must postdate the last try.
      if (Number.isNaN(actedAt) || actedAt >= startMs(last)) continue;
    }

    // The streak: unanswered inbound calls since the last connected call.
    let lastAnswered = -1;
    for (let i = lastUnanswered; i >= 0; i--) {
      if (statuses[i] === "Answered") {
        lastAnswered = i;
        break;
      }
    }
    let tries = 0;
    for (let i = lastAnswered + 1; i <= lastUnanswered; i++) {
      if (isInbound(group[i]) && isUnanswered(statuses[i])) tries++;
    }
    const streakStart = group.slice(lastAnswered + 1).find((c) => isInbound(c)) ?? last;
    const firstTime = lastAnswered < 0 && group[0] === streakStart && streakStart.first_call === true;

    const name =
      [...group].reverse().map((c) => c.customer_name?.trim()).find((n) => !!n) ?? "Unknown caller";

    out.push({
      phone,
      displayPhone: last.customer_phone_number?.trim() || phone,
      name,
      lastTry,
      tries,
      source: sourceLabel(last),
      firstTime,
      lastStatus: statuses[lastUnanswered] as "Missed" | "Voicemail",
    });
  }
  return out.sort((a, b) => new Date(b.lastTry).getTime() - new Date(a.lastTry).getTime());
}

// ---------------------------------------------------------------------------
// Firm-local date helpers (the date pickers are firm-local days).
// ---------------------------------------------------------------------------

/** Offset of `tz` from UTC (ms) at a given instant; positive = ahead of UTC. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  return asUTC - utcMs;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string | null | undefined): s is string {
  return !!s && DATE_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

function localMidnightUTC(y: number, m: number, d: number, tz: string): string {
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(naive - tzOffsetMs(naive, tz)).toISOString();
}

/** UTC instant of firm-local midnight at the start of `dateStr`. */
export function firmLocalDayStartUTC(dateStr: string, tz: string = FIRM_TZ): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localMidnightUTC(y, m, d, tz);
}

/** UTC instant of firm-local midnight at the END of `dateStr` (exclusive bound). */
export function firmLocalDayEndExclusiveUTC(dateStr: string, tz: string = FIRM_TZ): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localMidnightUTC(y, m, d + 1, tz);
}

/** Today's date (YYYY-MM-DD) in the firm's time zone. */
export function firmLocalToday(nowMs: number, tz: string = FIRM_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

/** Current month to date, firm-local: { from: YYYY-MM-01, to: today }. */
export function monthToDate(nowMs: number, tz: string = FIRM_TZ): { from: string; to: string } {
  const to = firmLocalToday(nowMs, tz);
  return { from: `${to.slice(0, 8)}01`, to };
}
