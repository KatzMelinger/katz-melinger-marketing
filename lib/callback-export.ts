/**
 * The Needs callback list as a file (Oct 20 spec, Task A19): CSV and PDF for
 * any date range and filter, and the daily 8:00 AM email with the PDF
 * attached. Uses the same missed-lead rule as the Calls page and Lead
 * Response (needsCallback in lib/calls-stats), so the file, the page and the
 * email always agree.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { loadPaged } from "./rank-history";
import {
  FIRM_TZ,
  firmLocalDayEndExclusiveUTC,
  firmLocalDayStartUTC,
  needsCallback,
  rangeLabel,
  type CallStatsRow,
  type CallbackItem,
  type RecoveryRow,
} from "./calls-stats";
import { tableToPdf } from "./pdf-lite";

type Json = Record<string, unknown>;

const EXPORT_COLUMNS = [
  "id",
  "customer_name",
  "customer_phone_number",
  "duration",
  "answered",
  "voicemail",
  "direction",
  "start_time",
  "first_call",
  "transcription_language",
  "marketing_source:raw->>source",
].join(",");

export type CallbackFilters = {
  from: string;
  to: string;
  source?: string | null;
  /** "missed" or "voicemail": the result of the caller's last try. */
  result?: string | null;
  /** "first" or "repeat". */
  caller?: string | null;
  language?: string | null;
};

export type CallbackRow = CallbackItem & { notes: string | null; language: string | null };

/** 2124600047 -> 212-460-0047 (the firm's own format). */
export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : phone;
}

export function nyTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: FIRM_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function loadCallbacks(tenantId: string, f: CallbackFilters, nowMs = Date.now()): Promise<CallbackRow[]> {
  const sb = getSupabaseAdmin();
  const startUTC = firmLocalDayStartUTC(f.from);
  const endUTC = firmLocalDayEndExclusiveUTC(f.to);
  const calls = await loadPaged<Json>(async (lo, hi) => {
    const { data, error } = await sb
      .from("calls")
      .select(EXPORT_COLUMNS)
      .eq("tenant_id", tenantId)
      .gte("start_time", startUTC)
      .lt("start_time", endUTC)
      .order("start_time", { ascending: false })
      .order("id", { ascending: true })
      .range(lo, hi);
    return { rows: (data ?? []) as unknown as Json[], error: error?.message ?? null };
  });
  const { data: rec } = await sb
    .from("lead_recovery")
    .select("phone, status, notes, last_action_at")
    .eq("tenant_id", tenantId);
  const recovery = new Map<string, RecoveryRow>();
  const notes = new Map<string, string | null>();
  for (const r of (rec ?? []) as (RecoveryRow & { notes?: string | null })[]) {
    recovery.set(r.phone, r);
    notes.set(r.phone, r.notes ?? null);
  }
  // Language of each caller's latest call, for the language filter.
  const lang = new Map<string, string | null>();
  for (const c of calls) {
    const p = String(c.customer_phone_number ?? "").replace(/\D/g, "").slice(-10);
    if (p && !lang.has(p)) lang.set(p, (c.transcription_language as string | null) ?? null);
  }
  return needsCallback(calls as unknown as CallStatsRow[], recovery, nowMs)
    .map((c) => ({ ...c, notes: notes.get(c.phone) ?? null, language: lang.get(c.phone) ?? null }))
    .filter((c) => {
      if (f.source && f.source !== "all" && c.source !== f.source) return false;
      if (f.result === "missed" && c.lastStatus !== "Missed") return false;
      if (f.result === "voicemail" && c.lastStatus !== "Voicemail") return false;
      if (f.caller === "first" && !c.firstTime) return false;
      if (f.caller === "repeat" && c.firstTime) return false;
      if (f.language && f.language !== "all" && (c.language ?? "unknown") !== f.language) return false;
      return true;
    });
}

export function summaryLine(rows: CallbackRow[]): string {
  const vm = rows.filter((r) => r.lastStatus === "Voicemail").length;
  const first = rows.filter((r) => r.firstTime).length;
  return `${rows.length} caller${rows.length === 1 ? "" : "s"} waiting · ${vm} left a voicemail · ${first} first-time caller${first === 1 ? "" : "s"}`;
}

const HEAD = ["Name", "Phone", "Last attempt", "Result", "Tries", "Source", "Caller", "Done", "Notes"];

function cells(r: CallbackRow): string[] {
  return [
    r.name,
    formatPhone(r.phone),
    nyTime(r.lastTry),
    r.lastStatus === "Voicemail" ? "voicemail" : "missed",
    String(r.tries),
    r.source,
    r.firstTime ? "first-time" : "repeat",
    "",
    r.notes ?? "",
  ];
}

function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function callbacksCsv(rows: CallbackRow[]): string {
  return [HEAD, ...rows.map(cells)].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function callbacksPdf(rows: CallbackRow[], f: CallbackFilters, extraHeader: string[] = []): Buffer {
  const filters = [
    f.source && f.source !== "all" ? `source: ${f.source}` : null,
    f.result ? `result: ${f.result}` : null,
    f.caller ? `caller: ${f.caller}-time` : null,
    f.language && f.language !== "all" ? `language: ${f.language}` : null,
  ].filter(Boolean);
  return tableToPdf({
    title: `Needs callback: ${rangeLabel(f.from, f.to) || `${f.from} to ${f.to}`}`,
    headerLines: [
      summaryLine(rows),
      ...(filters.length ? [`Filtered by ${filters.join(", ")}`] : []),
      `Printed ${nyTime(new Date().toISOString())} (New York time). Newest first.`,
      ...extraHeader,
    ],
    columns: [
      { label: "Name", width: 120 },
      { label: "Phone", width: 76 },
      { label: "Last attempt", width: 108 },
      { label: "Result", width: 56 },
      { label: "Tries", width: 32 },
      { label: "Source", width: 96 },
      { label: "Caller", width: 58 },
      { label: "Done", width: 34 },
      { label: "Notes", width: 140 },
    ],
    rows: rows.map((r) => cells(r).map((c, i) => (i === 7 ? "[  ]" : c))),
    footer: "Confidential. Katz Melinger PLLC internal call list.",
  });
}

/* ------------------------------------------------------------------ */
/* Daily email                                                         */
/* ------------------------------------------------------------------ */

async function getSetting(tenantId: string, key: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from("brand_voice_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", key)
    .maybeSingle();
  return (data?.value as string | null) ?? null;
}

async function setSetting(tenantId: string, key: string, value: string): Promise<void> {
  await getSupabaseAdmin()
    .from("brand_voice_settings")
    .upsert({ tenant_id: tenantId, key, value, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,key" });
}

export function parseRecipients(v: string | null): string[] {
  const s = (v ?? "").trim();
  if (!s) return [];
  let list: unknown;
  try {
    list = JSON.parse(s);
  } catch {
    list = s.split(/[,;\n]/);
  }
  return Array.isArray(list) ? [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter((x) => /@/.test(x)))] : [];
}

/** The New York hour right now (0-23). */
export function nyHour(nowMs: number): number {
  return Number(new Date(nowMs).toLocaleString("en-US", { timeZone: FIRM_TZ, hour: "numeric", hourCycle: "h23" }));
}

function nyDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: FIRM_TZ });
}

/**
 * The 8:00 AM email. Vercel cron runs in UTC, so the route is called at both
 * 12:00 and 13:00 UTC and only sends when it is 8 in New York (daylight time
 * or not). Covers the last 14 days; anyone who called since the last email is
 * listed first.
 */
export async function sendDailyCallbackEmail(
  tenantId: string,
  opts: { nowMs?: number; force?: boolean } = {},
): Promise<{ sent: number; callers: number; skipped?: string }> {
  const nowMs = opts.nowMs ?? Date.now();
  if (!opts.force && nyHour(nowMs) !== 8) return { sent: 0, callers: 0, skipped: "not 8 AM in New York" };
  const recipients = parseRecipients(await getSetting(tenantId, "callbackEmailRecipients"));
  if (!recipients.length) return { sent: 0, callers: 0, skipped: "no recipients in Brand settings" };
  const lastSent = await getSetting(tenantId, "callbackEmailLastSentAt");
  if (!opts.force && lastSent && nyDate(new Date(lastSent).getTime()) === nyDate(nowMs)) {
    return { sent: 0, callers: 0, skipped: "already sent today" };
  }

  const f: CallbackFilters = { from: nyDate(nowMs - 13 * 86_400_000), to: nyDate(nowMs) };
  const rows = await loadCallbacks(tenantId, f, nowMs);
  const since = lastSent ? new Date(lastSent).getTime() : nowMs - 86_400_000;
  const fresh = rows.filter((r) => new Date(r.lastTry).getTime() > since);
  const ordered = [...fresh, ...rows.filter((r) => !fresh.includes(r))];

  const lines = [
    `Good morning. ${summaryLine(rows)} (last 14 days).`,
    "",
    fresh.length ? `New since the last email (${fresh.length}):` : "Nobody new since the last email.",
    ...fresh.map((r) => `  ${r.name}, ${formatPhone(r.phone)}, ${r.lastStatus.toLowerCase()} ${nyTime(r.lastTry)}, ${r.source}${r.firstTime ? ", first-time caller" : ""}`),
    "",
    rows.length ? "The full list is attached as a PDF to print or forward." : "Nobody is waiting on a callback.",
    "Mark each caller on the Calls page (Called back, Reached or Dead) so they drop off tomorrow's list.",
    `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/calls`,
  ];
  const pdf = callbacksPdf(ordered, f, fresh.length ? [`The first ${fresh.length} called since the last email.`] : []);
  const { sendEmails } = await import("./notify-shared");
  const sent = await sendEmails(
    recipients,
    `Callbacks for ${new Date(nowMs).toLocaleDateString("en-US", { timeZone: FIRM_TZ, weekday: "long", month: "short", day: "numeric" })}: ${rows.length} waiting`,
    lines.join("\n"),
    [{ filename: `needs-callback-${nyDate(nowMs)}.pdf`, content: pdf.toString("base64") }],
  );
  if (sent > 0) await setSetting(tenantId, "callbackEmailLastSentAt", new Date(nowMs).toISOString());
  return { sent, callers: rows.length };
}

/** Outcome counts for the range: how the follow-up is going (Task A19). */
export async function callbackOutcomes(tenantId: string, from: string, to: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("lead_recovery")
    .select("status, last_action_at")
    .eq("tenant_id", tenantId)
    .gte("last_action_at", firmLocalDayStartUTC(from))
    .lt("last_action_at", firmLocalDayEndExclusiveUTC(to));
  if (error) return null;
  const out = { called_back: 0, reached: 0, dead: 0, consultation: 0 };
  for (const r of data ?? []) {
    const s = r.status as keyof typeof out;
    if (s in out) out[s] += 1;
  }
  // consultation_at arrives with supabase/calls_followup_a19.sql; until then it stays 0.
  const c = await getSupabaseAdmin()
    .from("lead_recovery")
    .select("phone", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("consultation_at", firmLocalDayStartUTC(from))
    .lt("consultation_at", firmLocalDayEndExclusiveUTC(to));
  if (!c.error) out.consultation = c.count ?? 0;
  return out;
}
