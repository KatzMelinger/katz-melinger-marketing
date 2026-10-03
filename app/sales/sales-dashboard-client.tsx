"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { Dashboard } from "@/lib/sales-dashboard/metrics";

import {
  BarRow,
  BLUE,
  Card,
  Delta,
  fmtNum,
  fmtPct,
  PRESETS,
  QualityBar,
  QualityLegend,
  RangePicker,
  TEAM_GRAY,
  Tile,
  type DateRange,
} from "./ui";

const SPEED_LABEL: Record<string, string> = {
  live: "Answered live",
  same_day: "Same day",
  next_day: "Next day",
  later: "2+ days",
  none: "None logged",
};

export function SalesDashboardClient() {
  const [range, setRange] = useState<DateRange>(PRESETS[0].range());
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const query = useMemo(() => {
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    if (category) qs.set("category", category);
    if (source) qs.set("source", source);
    return qs.toString();
  }, [range, category, source]);
  // The data remembers which query it answers; anything else means loading.
  const [result, setResult] = useState<{ query: string; data: Dashboard | null; error: string | null } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/sales-dashboard?${query}`, { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
        setResult({ query, data: json as Dashboard, error: null });
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setResult((r) => ({ query, data: r?.data ?? null, error: (e as Error).message }));
      });
    return () => ctrl.abort();
  }, [query]);

  const data = result?.data ?? null;
  const error = result?.query === query ? result.error : null;
  const loading = result?.query !== query;
  const k = data?.kpis;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Intake &amp; Sales</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live from the Airtable intake table · leads created {range.from} to {range.to}
            {loading && data ? " · updating…" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker value={range} onChange={setRange} />
          <select
            aria-label="Case category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All case types</option>
            {data?.options.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            aria-label="Lead source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All sources</option>
            {data?.options.sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}
      {!data ? <p className="text-sm text-slate-500">{loading ? "Loading…" : null}</p> : null}

      {data && k ? (
        <>
          {data.needs_review > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span>
                {data.needs_review} signed leads were signed before credit tracking started, so who did the intake and
                sales is unknown or estimated.
              </span>
              <Link href="/sales/review" className="font-medium underline">
                Review them
              </Link>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Leads" value={fmtNum(k.leads)} sub={<Delta now={k.leads} prev={k.leads_prev} />} />
            <Tile label="Signed" value={fmtNum(k.signed)} sub={<Delta now={k.signed} prev={k.signed_prev} />} />
            <Tile
              label="Lead to signed"
              value={fmtPct(k.conversion)}
              sub={<Delta now={k.conversion} prev={k.conversion_prev} unit=" pts" />}
            />
            <Tile label="Contacted same day" value={fmtPct(k.quick_contact)} sub="live or same-day follow-up" />
            <Tile
              label="Open pipeline"
              value={fmtNum(k.open.total)}
              sub={`${k.open.High} high · ${k.open.Medium} med · ${k.open.Low} low`}
            />
            <Tile
              label="Avg call score"
              value={k.avg_call_score ?? "—"}
              sub={k.scored_calls ? `${k.scored_calls} scored calls` : "no scored calls yet"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Funnel" note="share of all leads">
              {data.funnel.map((s) => (
                <BarRow
                  key={s.stage}
                  label={s.stage}
                  value={s.count}
                  max={data.funnel[0].count}
                  right={`${fmtNum(s.count)} · ${fmtPct(data.funnel[0].count ? (s.count / data.funnel[0].count) * 100 : null)}`}
                  title={`${s.stage}: ${s.count}`}
                />
              ))}
            </Card>
            <Card title="Speed to lead" note="day-level until Vonage call times are connected">
              {data.speed.map((s) => (
                <BarRow
                  key={s.bucket}
                  label={SPEED_LABEL[s.bucket]}
                  value={s.leads}
                  max={Math.max(...data.speed.map((x) => x.leads))}
                  right={`${fmtNum(s.leads)} · ${fmtPct(s.share)}`}
                  color={s.bucket === "none" ? TEAM_GRAY : BLUE}
                  title={`${SPEED_LABEL[s.bucket]}: ${s.leads} leads`}
                />
              ))}
              <p className="mt-2 text-xs text-slate-500">
                Answered live = a CallRail call from the lead&apos;s number was answered when the lead came in. Otherwise
                the first initialed Follow-Up Notes entry.
              </p>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Intake team" note="credit: Legal Assistant # 1 before signing">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="py-2 font-normal">Name</th>
                      <th className="py-2 text-right font-normal">Leads</th>
                      <th className="py-2 text-right font-normal">Same day</th>
                      <th className="py-2 text-right font-normal">To sales call</th>
                      <th className="py-2 text-right font-normal">Signed</th>
                      <th className="py-2 text-right font-normal">Conv.</th>
                      <th className="py-2 text-right font-normal">Call score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.intake_team.map((r) => (
                      <tr key={r.staff_id} className="border-b border-slate-100">
                        <td className="py-2">
                          <Link href={`/sales/${r.staff_id}`} className="text-brand hover:underline">
                            {r.name}
                          </Link>
                        </td>
                        <td className="py-2 text-right tabular-nums">{fmtNum(r.leads)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtPct(r.quick_contact)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtPct(r.to_sales_call)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtNum(r.signed)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtPct(r.conversion)}</td>
                        <td className="py-2 text-right tabular-nums" title={`${r.scored_calls} scored intake calls`}>
                          {r.avg_call_score ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {data.intake_estimated_signed > 0
                  ? `${data.intake_estimated_signed} signed credits estimated from Follow-Up Notes. `
                  : ""}
                {data.intake_unattributed_signed > 0 ? `${data.intake_unattributed_signed} signed leads unattributed.` : ""}
              </p>
            </Card>

            <Card title="Sales / reviewers" note={<QualityLegend />}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="py-2 font-normal">Name</th>
                      <th className="py-2 text-right font-normal">Sales calls</th>
                      <th className="py-2 text-right font-normal">Signed</th>
                      <th className="py-2 text-right font-normal">Close</th>
                      <th className="py-2 pl-3 font-normal">Quality signed</th>
                      <th className="py-2 text-right font-normal">Call score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales_team.map((r) => (
                      <tr key={r.staff_id} className="border-b border-slate-100">
                        <td className="py-2">
                          <Link href={`/sales/${r.staff_id}`} className="text-brand hover:underline">
                            {r.name}
                          </Link>
                        </td>
                        <td className="py-2 text-right tabular-nums">{fmtNum(r.sales_calls)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtNum(r.signed)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtPct(r.close_rate)}</td>
                        <td className="py-2 pl-3">
                          <QualityBar {...r.quality} />
                        </td>
                        <td className="py-2 text-right tabular-nums" title={`${r.scored_calls} scored sales calls`}>
                          {r.avg_call_score ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Credit: Attorney/Reviewer before signing.
                {data.sales_unattributed_signed > 0
                  ? ` ${data.sales_unattributed_signed} signed leads unattributed until reviewed.`
                  : ""}
              </p>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="By source">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 font-normal">Source</th>
                    <th className="py-2 text-right font-normal">Leads</th>
                    <th className="py-2 text-right font-normal">Signed</th>
                    <th className="py-2 text-right font-normal">Conv.</th>
                    <th className="py-2 text-right font-normal">% high quality</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_source.map((r) => (
                    <tr key={r.source} className="border-b border-slate-100">
                      <td className="py-2">{r.source}</td>
                      <td className="py-2 text-right tabular-nums">{fmtNum(r.leads)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtNum(r.signed)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtPct(r.conversion)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtPct(r.high_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card
              title="Why leads didn't sign"
              note={
                <span className="inline-flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: TEAM_GRAY }} />
                    firm declined
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#eb6834" }} />
                    client walked away
                  </span>
                </span>
              }
            >
              {data.decline_reasons.map((r) => (
                <BarRow
                  key={r.reason}
                  label={r.reason}
                  value={r.count}
                  max={data.decline_reasons[0]?.count ?? 0}
                  right={fmtNum(r.count)}
                  color={r.side === "client" ? "#eb6834" : TEAM_GRAY}
                  title={`${r.reason}: ${r.count}`}
                />
              ))}
            </Card>
          </div>

          <Card title="Needs action now" note="all open leads, any date">
            <div className="grid gap-4 md:grid-cols-3">
              <ActionList
                tone="critical"
                label="Letters out 7+ days, not signed"
                rows={data.actions.letters_unsigned}
                daysLabel="days since letter"
              />
              <ActionList
                tone="warning"
                label="No logged contact (new this week)"
                rows={data.actions.not_contacted}
                daysLabel="days old"
              />
              <ActionList tone="warning" label="Idle 5+ days" rows={data.actions.idle} daysLabel="days idle" />
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ActionList({
  tone,
  label,
  rows,
  daysLabel,
}: {
  tone: "critical" | "warning";
  label: string;
  rows: Dashboard["actions"]["idle"];
  daysLabel: string;
}) {
  const badge = tone === "critical" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900";
  return (
    <details className="rounded-lg border border-slate-200 p-3" open={rows.length > 0 && rows.length <= 5}>
      <summary className="cursor-pointer text-sm text-slate-700">
        <span className={`mr-2 rounded px-2 py-0.5 text-xs font-medium tabular-nums ${badge}`}>
          {tone === "critical" ? "⚠ " : ""}
          {rows.length}
        </span>
        {label}
      </summary>
      <ul className="mt-2 space-y-1 text-sm">
        {rows.slice(0, 25).map((r) => (
          <li key={r.id} className="flex justify-between gap-2">
            <span className="truncate text-slate-700" title={r.status ?? undefined}>
              {r.name ?? "Unnamed"}
              {r.owner ? <span className="text-slate-400"> · {r.owner}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-slate-500" title={daysLabel}>
              {r.days ?? "—"}d
            </span>
          </li>
        ))}
        {rows.length > 25 ? <li className="text-xs text-slate-400">and {rows.length - 25} more</li> : null}
      </ul>
    </details>
  );
}
