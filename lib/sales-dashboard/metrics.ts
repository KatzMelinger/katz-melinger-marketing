/**
 * Intake & Sales dashboard numbers.
 *
 * Leads come live from Airtable (./intakes.ts), credit follows ./credit.ts,
 * call scores come from call_scores via calls.staff_id, and "answered live"
 * comes from CallRail calls in this app's own `calls` table.
 *
 * Speed-to-lead is day-level until the Vonage call log is connected:
 *   answered live — an answered CallRail call from the lead's number within
 *                   the 24h before (or 1h after) the lead was created
 *   same day / next day / 2+ days — first initialed Follow-Up Notes entry
 *   none logged   — neither
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePhone } from "@/lib/lead-response";
import { loadSalesStaff, type SalesStaff } from "@/lib/sales-staff";

import { creditFor, parseNoteEntries, type LeadCredit, type StaffSnapshot } from "./credit";
import { DASHBOARD_SINCE, listDashboardIntakes, outcomeOf, type IntakeRecord } from "./intakes";

export type Range = { from: string; to: string }; // YYYY-MM-DD, inclusive
export type Filters = Range & { category?: string | null; source?: string | null };

export type SpeedBucket = "live" | "same_day" | "next_day" | "later" | "none";
export const SPEED_BUCKETS: SpeedBucket[] = ["live", "same_day", "next_day", "later", "none"];

export type Lead = IntakeRecord & { credit: LeadCredit; hasSnapshot: boolean; speed: SpeedBucket };

const DAY = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

async function loadSnapshots(supabase: SupabaseClient, tenantId: string): Promise<Map<string, StaffSnapshot>> {
  const out = new Map<string, StaffSnapshot>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("intake_staff_snapshots")
      .select("airtable_id, legal_assistant, reviewer, source")
      .eq("tenant_id", tenantId)
      .range(from, from + 999);
    if (error) {
      // Before supabase/intake_staff_snapshots.sql is applied, credit for
      // signed leads falls back to Follow-Up Notes rather than failing.
      if (/does not exist|schema cache/i.test(error.message)) return out;
      throw new Error(error.message);
    }
    for (const r of data ?? []) out.set(r.airtable_id as string, r as StaffSnapshot);
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Normalized phone → start times (ms) of answered inbound calls. */
async function loadAnsweredCalls(supabase: SupabaseClient, tenantId: string): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const since = new Date(new Date(`${DASHBOARD_SINCE}T00:00:00Z`).getTime() - DAY).toISOString();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("calls")
      .select("customer_phone_number, start_time")
      .eq("tenant_id", tenantId)
      .eq("answered", true)
      .eq("voicemail", false)
      .gte("start_time", since)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const c of data ?? []) {
      const p = normalizePhone(c.customer_phone_number as string | null);
      if (!p || !c.start_time) continue;
      out.set(p, [...(out.get(p) ?? []), new Date(c.start_time as string).getTime()]);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

function speedOf(lead: IntakeRecord, answered: Map<string, number[]>): SpeedBucket {
  const created = new Date(lead.createdAt).getTime();
  const phone = normalizePhone(lead.phone);
  if (phone && (answered.get(phone) ?? []).some((t) => t >= created - DAY && t <= created + 60 * 60 * 1000)) {
    return "live";
  }
  const first = parseNoteEntries(lead.followUpNotes, lead.createdAt).find((e) => e.date)?.date;
  if (!first) return "none";
  const createdDay = Date.UTC(
    new Date(lead.createdAt).getUTCFullYear(),
    new Date(lead.createdAt).getUTCMonth(),
    new Date(lead.createdAt).getUTCDate(),
  );
  const days = Math.round((first.getTime() - createdDay) / DAY);
  if (days <= 0) return "same_day";
  if (days === 1) return "next_day";
  return "later";
}

export type DashboardContext = { leads: Lead[]; staff: SalesStaff[]; tenantId: string };

export async function loadDashboardContext(supabase: SupabaseClient, tenantId: string): Promise<DashboardContext> {
  const [intakes, staff, snapshots, answered] = await Promise.all([
    listDashboardIntakes(),
    loadSalesStaff(supabase, tenantId),
    loadSnapshots(supabase, tenantId),
    loadAnsweredCalls(supabase, tenantId),
  ]);
  const leads = intakes.map((l) => ({
    ...l,
    credit: creditFor(l, snapshots.get(l.id), staff),
    hasSnapshot: snapshots.has(l.id),
    speed: speedOf(l, answered),
  }));
  return { leads, staff, tenantId };
}

/* -------------------------------------------------------------------------- */
/* Call scores                                                                */
/* -------------------------------------------------------------------------- */

export type ScoredCall = {
  call_id: string;
  staff_id: string;
  start_time: string;
  customer_name: string | null;
  rubric_type: string;
  overall_score: number;
  dimension_scores: { dimension_key: string; dimension_name: string; score: number; max: number; do_better: string }[];
  summary_manager: string | null;
};

/** Latest current-scorer score for every attributed call in the range. */
export async function loadScoredCalls(
  supabase: SupabaseClient,
  tenantId: string,
  range: Range,
  staffId?: string,
): Promise<ScoredCall[]> {
  const calls: { id: string; staff_id: string; start_time: string; customer_name: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from("calls")
      .select("id, staff_id, start_time, customer_name")
      .eq("tenant_id", tenantId)
      .not("staff_id", "is", null)
      .gte("start_time", `${range.from}T00:00:00Z`)
      .lte("start_time", `${range.to}T23:59:59Z`)
      .range(from, from + 999);
    if (staffId) q = q.eq("staff_id", staffId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    calls.push(...((data ?? []) as typeof calls));
    if (!data || data.length < 1000) break;
  }

  const byId = new Map(calls.map((c) => [c.id, c]));
  const latest = new Map<string, ScoredCall>();
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("call_scores")
      .select("call_id, rubric_type, overall_score, dimension_scores, summary_manager, scored_at")
      .in("call_id", ids.slice(i, i + 200))
      .gte("prompt_version", 3)
      .order("scored_at", { ascending: false });
    if (error) throw new Error(error.message);
    for (const s of data ?? []) {
      const id = s.call_id as string;
      if (latest.has(id) || s.overall_score == null) continue;
      const c = byId.get(id)!;
      latest.set(id, {
        call_id: id,
        staff_id: c.staff_id,
        start_time: c.start_time,
        customer_name: c.customer_name,
        rubric_type: s.rubric_type as string,
        overall_score: s.overall_score as number,
        dimension_scores: (s.dimension_scores ?? []) as ScoredCall["dimension_scores"],
        summary_manager: (s.summary_manager as string | null) ?? null,
      });
    }
  }
  return [...latest.values()].sort((a, b) => b.start_time.localeCompare(a.start_time));
}

/** Intake-side calls are scored on the intake rubric; sales-side on consultation or callback. */
export function isSalesRubric(rubricType: string): boolean {
  return rubricType === "consultation" || rubricType === "callback";
}

function avg(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

function inRange(lead: IntakeRecord, f: Filters): boolean {
  const day = lead.createdAt.slice(0, 10);
  if (day < f.from || day > f.to) return false;
  if (f.category && (lead.category ?? "(none)") !== f.category) return false;
  if (f.source && (lead.source ?? "(none)") !== f.source) return false;
  return true;
}

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

/** The same-length period immediately before `range`, or null if it starts before the data does. */
function previousRange(range: Range): Range | null {
  const from = new Date(`${range.from}T00:00:00Z`).getTime();
  const to = new Date(`${range.to}T00:00:00Z`).getTime();
  const len = to - from + DAY;
  const prevFrom = new Date(from - len).toISOString().slice(0, 10);
  if (prevFrom < DASHBOARD_SINCE) return null;
  return { from: prevFrom, to: new Date(from - DAY).toISOString().slice(0, 10) };
}

const CLIENT_SIDE_DECLINES = new Set([
  "Decline - Client Reject",
  "Decline - Client No Show",
  "Decline - No Response to Engagement Letter",
]);

export function buildDashboard(ctx: DashboardContext, f: Filters, scored: ScoredCall[]) {
  const leads = ctx.leads.filter((l) => inRange(l, f));
  const prev = previousRange(f);
  const prevLeads = prev ? ctx.leads.filter((l) => inRange(l, { ...f, ...prev })) : null;
  const signedOf = (ls: Lead[]) => ls.filter((l) => outcomeOf(l.status) === "signed");

  const signed = signedOf(leads);
  const open = leads.filter((l) => outcomeOf(l.status) === "active");

  const speedCounts = Object.fromEntries(SPEED_BUCKETS.map((b) => [b, 0])) as Record<SpeedBucket, number>;
  for (const l of leads) speedCounts[l.speed]++;
  const quick = speedCounts.live + speedCounts.same_day;

  const funnel = [
    { stage: "Leads", count: leads.length },
    { stage: "Sales call scheduled", count: leads.filter((l) => l.hadSalesCall || outcomeOf(l.status) === "signed").length },
    { stage: "Letter sent", count: leads.filter((l) => l.letterSentAt || outcomeOf(l.status) === "signed").length },
    { stage: "Signed", count: signed.length },
  ];

  /* ---- people ---- */
  const scoresBy = (staffId: string, sales: boolean) =>
    scored.filter((s) => s.staff_id === staffId && isSalesRubric(s.rubric_type) === sales).map((s) => s.overall_score);

  const intakeTeam = ctx.staff
    .filter((s) => s.roles.includes("intake") || leads.some((l) => l.credit.intake?.id === s.id))
    .map((s) => {
      const mine = leads.filter((l) => l.credit.intake?.id === s.id);
      const scores = scoresBy(s.id, false);
      return {
        staff_id: s.id,
        name: s.full_name,
        leads: mine.length,
        to_sales_call: pct(mine.filter((l) => l.hadSalesCall || outcomeOf(l.status) === "signed").length, mine.length),
        signed: signedOf(mine).length,
        conversion: pct(signedOf(mine).length, mine.length),
        quick_contact: pct(mine.filter((l) => l.speed === "live" || l.speed === "same_day").length, mine.length),
        avg_call_score: avg(scores),
        scored_calls: scores.length,
      };
    })
    .filter((r) => r.leads > 0 || r.scored_calls > 0)
    .sort((a, b) => b.leads - a.leads);

  const salesTeam = ctx.staff
    .filter((s) => s.roles.includes("sales") || leads.some((l) => l.credit.sales?.id === s.id))
    .map((s) => {
      const mine = leads.filter((l) => l.credit.sales?.id === s.id);
      const worked = mine.filter((l) => l.hadSalesCall || outcomeOf(l.status) === "signed");
      const won = signedOf(mine);
      const scores = scoresBy(s.id, true);
      return {
        staff_id: s.id,
        name: s.full_name,
        sales_calls: worked.length,
        signed: won.length,
        close_rate: pct(won.length, worked.length),
        quality: {
          High: won.filter((l) => l.quality === "High").length,
          Medium: won.filter((l) => l.quality === "Medium").length,
          Low: won.filter((l) => l.quality === "Low").length,
        },
        avg_call_score: avg(scores),
        scored_calls: scores.length,
      };
    })
    .filter((r) => r.sales_calls > 0 || r.scored_calls > 0)
    .sort((a, b) => b.signed - a.signed);

  /* ---- sources & declines ---- */
  const sourceMap = new Map<string, Lead[]>();
  for (const l of leads) sourceMap.set(l.source ?? "(none)", [...(sourceMap.get(l.source ?? "(none)") ?? []), l]);
  const bySource = [...sourceMap.entries()]
    .map(([source, ls]) => ({
      source,
      leads: ls.length,
      signed: signedOf(ls).length,
      conversion: pct(signedOf(ls).length, ls.length),
      high_pct: pct(ls.filter((l) => l.quality === "High").length, ls.filter((l) => l.quality).length),
    }))
    .sort((a, b) => b.leads - a.leads);

  const reasonMap = new Map<string, number>();
  for (const l of leads) {
    const o = outcomeOf(l.status);
    if (o !== "declined" && o !== "referred") continue;
    const reason = l.declineReason ?? (l.status === "Declined - Notice Sent" ? "Declined (no reason recorded)" : l.status!);
    reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
  }
  const declineReasons = [...reasonMap.entries()]
    .map(([reason, count]) => ({
      reason: reason.replace(/^Decline - /, ""),
      count,
      side: CLIENT_SIDE_DECLINES.has(reason) ? ("client" as const) : ("firm" as const),
    }))
    .sort((a, b) => b.count - a.count);

  /* ---- needs action (current state, not limited to the date range) ---- */
  const now = Date.now();
  const daysSince = (iso: string | null) => (iso ? Math.floor((now - new Date(iso).getTime()) / DAY) : null);
  const scoped = ctx.leads.filter((l) => inRange(l, { ...f, from: DASHBOARD_SINCE, to: "9999-12-31" }));
  const activeAll = scoped.filter((l) => outcomeOf(l.status) === "active");
  const row = (l: Lead, days: number | null) => ({
    id: l.id,
    name: l.name,
    status: l.status,
    days,
    owner: l.credit.sales?.full_name ?? l.credit.intake?.full_name ?? null,
  });
  const actions = {
    letters_unsigned: activeAll
      .filter((l) => l.letterSentAt && (daysSince(l.letterSentAt) ?? 0) >= 7)
      .map((l) => row(l, daysSince(l.letterSentAt)))
      .sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    idle: activeAll
      .filter((l) => (daysSince(l.lastStageChange) ?? 0) >= 5 && !(l.letterSentAt && (daysSince(l.letterSentAt) ?? 0) >= 7))
      .map((l) => row(l, daysSince(l.lastStageChange)))
      .sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    not_contacted: activeAll
      .filter((l) => l.speed === "none" && (daysSince(l.createdAt) ?? 99) <= 7)
      .map((l) => row(l, daysSince(l.createdAt))),
  };

  return {
    range: { from: f.from, to: f.to },
    previous_range: prev,
    options: {
      categories: [...new Set(ctx.leads.map((l) => l.category ?? "(none)"))].sort(),
      sources: [...new Set(ctx.leads.map((l) => l.source ?? "(none)"))].sort(),
    },
    kpis: {
      leads: leads.length,
      leads_prev: prevLeads?.length ?? null,
      signed: signed.length,
      signed_prev: prevLeads ? signedOf(prevLeads).length : null,
      conversion: pct(signed.length, leads.length),
      conversion_prev: prevLeads ? pct(signedOf(prevLeads).length, prevLeads.length) : null,
      quick_contact: pct(quick, leads.length),
      open: {
        total: open.length,
        High: open.filter((l) => l.quality === "High").length,
        Medium: open.filter((l) => l.quality === "Medium").length,
        Low: open.filter((l) => l.quality === "Low").length,
      },
      avg_call_score: avg(scored.map((s) => s.overall_score)),
      scored_calls: scored.length,
    },
    funnel,
    // No "signed rate by speed" until Vonage: first logged follow-up isn't
    // first contact, and on 2026 data it ran backwards (none logged signed
    // most), which would mislead.
    speed: SPEED_BUCKETS.map((b) => ({
      bucket: b,
      leads: speedCounts[b],
      share: pct(speedCounts[b], leads.length),
    })),
    intake_team: intakeTeam,
    intake_unattributed_signed: signed.filter((l) => !l.credit.intake).length,
    intake_estimated_signed: signed.filter((l) => l.credit.intakeSource === "notes").length,
    sales_team: salesTeam,
    sales_unattributed_signed: signed.filter((l) => !l.credit.sales).length,
    needs_review: ctx.leads.filter((l) => outcomeOf(l.status) === "signed" && !l.hasSnapshot).length,
    by_source: bySource,
    decline_reasons: declineReasons,
    actions,
  };
}

export type Dashboard = ReturnType<typeof buildDashboard>;
