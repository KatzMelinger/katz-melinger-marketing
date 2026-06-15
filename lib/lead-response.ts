/**
 * Lead-response analysis — turns the raw call log into the numbers a CMO
 * actually manages on: how many inbound leads we fail to connect with on first
 * contact, how many of those we never recover, and what that leakage is
 * costing in signed-case value.
 *
 * Why "leakage/recovery" and not literal "speed-to-answer": the synced CallRail
 * data carries no ring-time field, so seconds-to-pickup isn't recoverable. But
 * by grouping calls on phone number we can tell whether a missed/voicemail
 * first contact ever connected on a later attempt (recovered) or was lost for
 * good — which is the metric that ties to revenue.
 *
 * Pure functions only (no I/O) so this is unit-testable and reusable.
 */

export const DEFAULT_TZ = "America/New_York"; // firm is NY/NJ; bucket hours in firm-local time
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 18; // 6pm
const CONNECT_MIN_SECONDS = 0; // answered && !voicemail counts as a connection

export type LeadCall = {
  id: string;
  customer_phone_number: string | null;
  source_name: string | null;
  duration: number | null;
  answered: boolean;
  voicemail: boolean;
  first_call: boolean;
  direction?: string | null;
  start_time: string | null;
};

export type LeadResponseOptions = {
  /** Average signed-case value, used to dollarize lost leads. */
  avgCaseValue: number;
  /** Expected lead→signed rate (0–1) applied to lost leads for the $ estimate. */
  expectedSignRate: number;
  timeZone?: string;
};

export type SourceLeakage = {
  source: string;
  leads: number;
  missedFirstContact: number;
  recovered: number;
  lost: number;
  lostRatePct: number;
};

export type HourLeakage = {
  hour: number; // 0–23, firm-local
  firstContacts: number;
  missed: number;
  missRatePct: number;
};

export type LostLead = {
  phone: string;
  source: string;
  firstContactAt: string;
  firstContactStatus: "Missed" | "Voicemail";
  firstTimeCaller: boolean;
  attempts: number;
};

export type LeadResponseReport = {
  totalLeads: number;
  leadsConnected: number;
  connectRatePct: number;
  missedFirstContact: number;
  recovered: number;
  recoveredRatePct: number;
  lost: number;
  lostRatePct: number;
  firstTimeCallerLost: number;
  afterHoursLost: number;
  estimatedLostValue: number;
  avgCaseValue: number;
  expectedSignRate: number;
  bySource: SourceLeakage[];
  byHour: HourLeakage[];
  lostLeads: LostLead[];
};

/** Normalize to the last 10 digits so formatting variants group together. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

type CallStatus = "Answered" | "Voicemail" | "Missed";

function statusOf(c: LeadCall): CallStatus {
  if (c.voicemail === true) return "Voicemail";
  if (c.answered === true && (c.duration ?? 0) >= CONNECT_MIN_SECONDS) return "Answered";
  return "Missed";
}

function isInbound(c: LeadCall): boolean {
  // Treat null/unknown direction as inbound; only exclude explicit outbound.
  return (c.direction ?? "inbound").toLowerCase() !== "outbound";
}

function localHour(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  // Intl can emit "24" for midnight in hour12:false — fold to 0.
  return h === 24 ? 0 : h;
}

function localWeekday(iso: string, tz: string): number {
  // 0 = Sunday … 6 = Saturday, in firm-local time.
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(
    new Date(iso),
  );
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

function isAfterHours(iso: string, tz: string): boolean {
  const hour = localHour(iso, tz);
  const wd = localWeekday(iso, tz);
  const weekend = wd === 0 || wd === 6;
  return weekend || hour < BUSINESS_START_HOUR || hour >= BUSINESS_END_HOUR;
}

/**
 * Group inbound calls by caller phone and classify each lead by what happened
 * on first contact and whether it was ever recovered.
 */
export function analyzeLeadResponse(
  calls: LeadCall[],
  opts: LeadResponseOptions,
): LeadResponseReport {
  const tz = opts.timeZone ?? DEFAULT_TZ;

  // Keep inbound calls with a usable phone + timestamp, sorted oldest→newest.
  const usable = calls
    .filter((c) => isInbound(c) && c.start_time)
    .map((c) => ({ ...c, phone: normalizePhone(c.customer_phone_number) }))
    .filter((c): c is LeadCall & { phone: string } => c.phone !== null)
    .sort((a, b) => new Date(a.start_time as string).getTime() - new Date(b.start_time as string).getTime());

  const groups = new Map<string, (LeadCall & { phone: string })[]>();
  for (const c of usable) {
    const arr = groups.get(c.phone);
    if (arr) arr.push(c);
    else groups.set(c.phone, [c]);
  }

  let totalLeads = 0;
  let leadsConnected = 0;
  let missedFirstContact = 0;
  let recovered = 0;
  let lost = 0;
  let firstTimeCallerLost = 0;
  let afterHoursLost = 0;

  const bySource = new Map<string, SourceLeakage>();
  const byHour = new Map<number, HourLeakage>();
  for (let h = 0; h < 24; h++) byHour.set(h, { hour: h, firstContacts: 0, missed: 0, missRatePct: 0 });

  const lostLeads: LostLead[] = [];

  for (const group of groups.values()) {
    totalLeads += 1;
    const first = group[0];
    const firstStatus = statusOf(first);
    const everConnected = group.some((c) => statusOf(c) === "Answered");
    const sourceKey = first.source_name?.trim() || "Unknown";
    const hour = localHour(first.start_time as string, tz);

    if (everConnected) leadsConnected += 1;

    const src =
      bySource.get(sourceKey) ??
      { source: sourceKey, leads: 0, missedFirstContact: 0, recovered: 0, lost: 0, lostRatePct: 0 };
    src.leads += 1;

    const hourBucket = byHour.get(hour)!;
    hourBucket.firstContacts += 1;

    const firstContactMissed = firstStatus !== "Answered";
    if (firstContactMissed) {
      missedFirstContact += 1;
      src.missedFirstContact += 1;
      hourBucket.missed += 1;
      if (everConnected) {
        recovered += 1;
        src.recovered += 1;
      } else {
        lost += 1;
        src.lost += 1;
        if (first.first_call === true) firstTimeCallerLost += 1;
        if (isAfterHours(first.start_time as string, tz)) afterHoursLost += 1;
        lostLeads.push({
          phone: first.phone,
          source: sourceKey,
          firstContactAt: first.start_time as string,
          firstContactStatus: firstStatus as "Missed" | "Voicemail",
          firstTimeCaller: first.first_call === true,
          attempts: group.length,
        });
      }
    }

    bySource.set(sourceKey, src);
  }

  for (const src of bySource.values()) {
    src.lostRatePct = src.leads ? round1((src.lost / src.leads) * 100) : 0;
  }
  for (const h of byHour.values()) {
    h.missRatePct = h.firstContacts ? round1((h.missed / h.firstContacts) * 100) : 0;
  }

  const estimatedLostValue = Math.round(lost * opts.avgCaseValue * opts.expectedSignRate);

  lostLeads.sort(
    (a, b) => new Date(b.firstContactAt).getTime() - new Date(a.firstContactAt).getTime(),
  );

  return {
    totalLeads,
    leadsConnected,
    connectRatePct: totalLeads ? round1((leadsConnected / totalLeads) * 100) : 0,
    missedFirstContact,
    recovered,
    recoveredRatePct: missedFirstContact ? round1((recovered / missedFirstContact) * 100) : 0,
    lost,
    lostRatePct: totalLeads ? round1((lost / totalLeads) * 100) : 0,
    firstTimeCallerLost,
    afterHoursLost,
    estimatedLostValue,
    avgCaseValue: opts.avgCaseValue,
    expectedSignRate: opts.expectedSignRate,
    bySource: [...bySource.values()].sort((a, b) => b.lost - a.lost || b.leads - a.leads),
    byHour: [...byHour.values()],
    lostLeads,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
