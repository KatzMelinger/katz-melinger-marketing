/**
 * One team member's page: their lead numbers next to the team's, and their
 * call scores — weekly trend, scorecard by rubric dimension against the team
 * average, the two weakest dimensions as a coaching focus, recent calls.
 *
 * Intake and sales are kept apart because Andres and Gabriel Moreno do both:
 * intake-rubric calls feed the intake side, consultation/callback the sales side.
 */

import { outcomeOf } from "./intakes";
import { isSalesRubric, type DashboardContext, type Filters, type Lead, type ScoredCall } from "./metrics";

const DAY = 24 * 60 * 60 * 1000;

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

function avg(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

/** Monday (UTC) of the week containing `iso`, as YYYY-MM-DD. */
function weekOf(iso: string): string {
  const d = new Date(iso);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY);
  return monday.toISOString().slice(0, 10);
}

function dimensionRollup(calls: ScoredCall[]) {
  const m = new Map<string, { name: string; earned: number; possible: number; calls: number; tip: string }>();
  for (const c of calls) {
    for (const d of c.dimension_scores) {
      if (!d.max) continue;
      const cur = m.get(d.dimension_key) ?? { name: d.dimension_name, earned: 0, possible: 0, calls: 0, tip: "" };
      cur.earned += d.score;
      cur.possible += d.max;
      cur.calls += 1;
      // calls are newest-first, so the first tip seen is the most recent
      if (!cur.tip && d.do_better && d.score < d.max) cur.tip = d.do_better;
      m.set(d.dimension_key, cur);
    }
  }
  return m;
}

function scoreBlock(mine: ScoredCall[], team: ScoredCall[]) {
  if (!mine.length) return null;
  const weeks = [...new Set([...mine, ...team].map((c) => weekOf(c.start_time)))].sort();
  const myDims = dimensionRollup(mine);
  const teamDims = dimensionRollup(team);
  const dimensions = [...myDims.entries()].map(([key, d]) => {
    const t = teamDims.get(key);
    return {
      key,
      name: d.name,
      mine_pct: Math.round((d.earned / d.possible) * 100),
      team_pct: t ? Math.round((t.earned / t.possible) * 100) : null,
      calls: d.calls,
      tip: d.tip,
    };
  });
  // Coaching focus: where they trail the team most (so a step everyone skips
  // doesn't crowd out what's specific to them), then lowest score.
  const gap = (d: (typeof dimensions)[number]) => d.mine_pct - (d.team_pct ?? d.mine_pct);
  const focus = dimensions
    .filter((d) => d.calls >= Math.min(3, mine.length) && d.mine_pct < 100)
    .sort((a, b) => gap(a) - gap(b) || a.mine_pct - b.mine_pct)
    .slice(0, 2);

  return {
    avg: avg(mine.map((c) => c.overall_score)),
    team_avg: avg(team.map((c) => c.overall_score)),
    count: mine.length,
    weekly: weeks.map((w) => ({
      week: w,
      mine: avg(mine.filter((c) => weekOf(c.start_time) === w).map((c) => c.overall_score)),
      team: avg(team.filter((c) => weekOf(c.start_time) === w).map((c) => c.overall_score)),
    })),
    dimensions,
    focus,
    recent: mine.slice(0, 15).map((c) => {
      const weakest = [...c.dimension_scores]
        .filter((d) => d.max > 0)
        .sort((a, b) => a.score / a.max - b.score / b.max)[0];
      return {
        call_id: c.call_id,
        date: c.start_time,
        customer: c.customer_name,
        rubric: c.rubric_type,
        score: c.overall_score,
        note: weakest && weakest.score < weakest.max ? weakest.do_better || weakest.dimension_name : null,
      };
    }),
  };
}

function inRange(l: Lead, f: Filters): boolean {
  const day = l.createdAt.slice(0, 10);
  return day >= f.from && day <= f.to;
}

export function buildPerson(ctx: DashboardContext, staffId: string, f: Filters, scored: ScoredCall[]) {
  const person = ctx.staff.find((s) => s.id === staffId);
  if (!person) return null;
  const leads = ctx.leads.filter((l) => inRange(l, f));
  const signed = (ls: Lead[]) => ls.filter((l) => outcomeOf(l.status) === "signed").length;
  const worked = (ls: Lead[]) => ls.filter((l) => l.hadSalesCall || outcomeOf(l.status) === "signed");
  const quick = (ls: Lead[]) => ls.filter((l) => l.speed === "live" || l.speed === "same_day").length;

  const myIntake = leads.filter((l) => l.credit.intake?.id === staffId);
  const mySales = leads.filter((l) => l.credit.sales?.id === staffId);
  const teamIntake = leads.filter((l) => l.credit.intake);
  const teamSales = leads.filter((l) => l.credit.sales);

  const intakeCalls = scored.filter((c) => !isSalesRubric(c.rubric_type));
  const salesCalls = scored.filter((c) => isSalesRubric(c.rubric_type));

  const doesIntake = person.roles.includes("intake") || myIntake.length > 0;
  const doesSales = person.roles.includes("sales") || mySales.length > 0;

  return {
    staff: { id: person.id, name: person.full_name, initials: person.initials, roles: person.roles },
    range: { from: f.from, to: f.to },
    intake: doesIntake
      ? {
          leads: myIntake.length,
          share_of_team: pct(myIntake.length, teamIntake.length),
          to_sales_call: pct(worked(myIntake).length, myIntake.length),
          signed: signed(myIntake),
          conversion: pct(signed(myIntake), myIntake.length),
          team_conversion: pct(signed(teamIntake), teamIntake.length),
          quick_contact: pct(quick(myIntake), myIntake.length),
          team_quick_contact: pct(quick(teamIntake), teamIntake.length),
          scores: scoreBlock(
            intakeCalls.filter((c) => c.staff_id === staffId),
            intakeCalls,
          ),
        }
      : null,
    sales: doesSales
      ? {
          sales_calls: worked(mySales).length,
          signed: signed(mySales),
          close_rate: pct(signed(mySales), worked(mySales).length),
          team_close_rate: pct(signed(teamSales), worked(teamSales).length),
          high_quality_signed: mySales.filter((l) => outcomeOf(l.status) === "signed" && l.quality === "High").length,
          scores: scoreBlock(
            salesCalls.filter((c) => c.staff_id === staffId),
            salesCalls,
          ),
        }
      : null,
    leads: [...myIntake, ...mySales]
      .filter((l, i, all) => all.findIndex((x) => x.id === l.id) === i)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 25)
      .map((l) => ({
        id: l.id,
        name: l.name,
        created: l.createdAt,
        status: l.status,
        outcome: outcomeOf(l.status),
        role: l.credit.intake?.id === staffId ? (l.credit.sales?.id === staffId ? "intake + sales" : "intake") : "sales",
      })),
  };
}

export type Person = NonNullable<ReturnType<typeof buildPerson>>;
