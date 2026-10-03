"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { Person } from "@/lib/sales-dashboard/person";

import { BLUE, Card, fmtNum, fmtPct, PRESETS, RangePicker, TEAM_GRAY, Tile, type DateRange } from "../ui";

type ScoreBlock = NonNullable<NonNullable<Person["intake"]>["scores"]>;

const RUBRIC_LABEL: Record<string, string> = { intake: "Intake", consultation: "Sales", callback: "Callback" };

export function PersonClient({ staffId }: { staffId: string }) {
  const [range, setRange] = useState<DateRange>(PRESETS[0].range());
  const [data, setData] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"intake" | "sales" | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/sales-dashboard/person/${encodeURIComponent(staffId)}?from=${range.from}&to=${range.to}`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
        setData(json as Person);
        setError(null);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      });
    return () => ctrl.abort();
  }, [staffId, range]);

  const current = tab ?? (data?.intake ? "intake" : "sales");

  return (
    <div className="space-y-6">
      <Link href="/sales" className="text-sm text-brand hover:underline">
        ← Intake &amp; Sales
      </Link>
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}
      {!data ? (
        <p className="text-sm text-slate-500">{error ? null : "Loading…"}</p>
      ) : (
        <>
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-800">
                {data.staff.initials ?? data.staff.name.slice(0, 2)}
              </span>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">{data.staff.name}</h1>
                <p className="text-sm capitalize text-slate-500">{data.staff.roles.join(" & ")}</p>
              </div>
            </div>
            <RangePicker value={range} onChange={setRange} />
          </header>

          {data.intake && data.sales ? (
            <div className="flex gap-2" role="tablist">
              {(["intake", "sales"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={current === t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    current === t ? "bg-blue-50 font-medium text-blue-800" : "border border-slate-200 text-slate-600"
                  }`}
                >
                  {t === "intake" ? "Intake" : "Sales"}
                </button>
              ))}
            </div>
          ) : null}

          {current === "intake" && data.intake ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <Tile label="Leads handled" value={fmtNum(data.intake.leads)} sub={`${fmtPct(data.intake.share_of_team)} of team`} />
                <Tile
                  label="Lead to signed"
                  value={fmtPct(data.intake.conversion)}
                  sub={`team ${fmtPct(data.intake.team_conversion)}`}
                />
                <Tile
                  label="Contacted same day"
                  value={fmtPct(data.intake.quick_contact)}
                  sub={`team ${fmtPct(data.intake.team_quick_contact)}`}
                />
                <Tile label="Reached a sales call" value={fmtPct(data.intake.to_sales_call)} />
                <Tile
                  label="Avg intake call score"
                  value={data.intake.scores?.avg ?? "—"}
                  sub={data.intake.scores ? `team ${data.intake.scores.team_avg ?? "—"} · ${data.intake.scores.count} calls` : "no scored calls yet"}
                />
              </div>
              <Scores block={data.intake.scores} />
            </>
          ) : null}

          {current === "sales" && data.sales ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Tile label="Sales calls" value={fmtNum(data.sales.sales_calls)} />
                <Tile label="Signed" value={fmtNum(data.sales.signed)} sub={`${data.sales.high_quality_signed} high quality`} />
                <Tile
                  label="Close rate"
                  value={fmtPct(data.sales.close_rate)}
                  sub={`team ${fmtPct(data.sales.team_close_rate)}`}
                />
                <Tile
                  label="Avg sales call score"
                  value={data.sales.scores?.avg ?? "—"}
                  sub={data.sales.scores ? `team ${data.sales.scores.team_avg ?? "—"} · ${data.sales.scores.count} calls` : "no scored calls yet"}
                />
              </div>
              <Scores block={data.sales.scores} />
            </>
          ) : null}

          <Card title="Recent leads" note="credited to this person">
            {data.leads.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 font-normal">Lead</th>
                    <th className="py-2 font-normal">Created</th>
                    <th className="py-2 font-normal">Role</th>
                    <th className="py-2 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leads.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="py-2">{l.name ?? "Unnamed"}</td>
                      <td className="py-2 tabular-nums text-slate-600">{l.created.slice(0, 10)}</td>
                      <td className="py-2 text-slate-600">{l.role}</td>
                      <td className="py-2 text-slate-600">{l.status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-slate-500">No credited leads in this range.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Scores({ block }: { block: ScoreBlock | null }) {
  if (!block) {
    return (
      <Card title="Call scores">
        <p className="text-sm text-slate-500">
          No scored calls in this range yet. Calls are scored nightly once someone is identified on the call.
        </p>
      </Card>
    );
  }
  const weekly = block.weekly.map((w) => ({
    week: new Date(`${w.week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    You: w.mine,
    Team: w.team,
  }));
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Call score by week" note="0–100">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekly} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="#eceae6" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#52514e" }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#52514e" }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => (v == null ? "—" : v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="You" stroke={BLUE} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line
                  type="monotone"
                  dataKey="Team"
                  stroke={TEAM_GRAY}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Scorecard" note="bar = this person · line = team average">
          <div className="space-y-2">
            {block.dimensions.map((d) => (
              <div key={d.key} className="grid grid-cols-[minmax(0,12rem)_1fr_2.5rem] items-center gap-3 text-sm" title={`${d.name}: ${d.mine_pct}% (team ${d.team_pct ?? "—"}%) over ${d.calls} calls`}>
                <span className="truncate text-slate-700">{d.name}</span>
                <span className="relative h-3 rounded-r bg-slate-100">
                  <span className="block h-3 rounded-r" style={{ width: `${d.mine_pct}%`, backgroundColor: BLUE }} />
                  {d.team_pct != null ? (
                    <span className="absolute -top-1 h-5 w-0.5 bg-slate-800" style={{ left: `${d.team_pct}%` }} />
                  ) : null}
                </span>
                <span className="text-right tabular-nums text-slate-700">{d.mine_pct}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {block.focus.length ? (
        <section className="border-l-4 border-amber-400 bg-amber-50/50 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Coaching focus</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {block.focus.map((f) => (
              <li key={f.key}>
                <span className="font-medium text-slate-900">{f.name}</span>{" "}
                <span className="text-slate-500">
                  ({f.mine_pct}% vs team {f.team_pct ?? "—"}%)
                </span>
                {f.tip ? <span className="text-slate-700"> — {f.tip}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card title="Recent scored calls" note="open a call to hear it and read the full feedback">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 font-normal">Date</th>
              <th className="py-2 font-normal">Caller</th>
              <th className="py-2 font-normal">Type</th>
              <th className="py-2 text-right font-normal">Score</th>
              <th className="py-2 pl-4 font-normal">Biggest miss</th>
            </tr>
          </thead>
          <tbody>
            {block.recent.map((c) => (
              <tr key={c.call_id} className="border-b border-slate-100 align-top">
                <td className="py-2 tabular-nums text-slate-600">
                  <Link href={`/calls/${encodeURIComponent(c.call_id)}`} className="text-brand hover:underline">
                    {new Date(c.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </Link>
                </td>
                <td className="py-2 text-slate-700">{c.customer ?? "Unknown"}</td>
                <td className="py-2 text-slate-600">{RUBRIC_LABEL[c.rubric] ?? c.rubric}</td>
                <td className="py-2 text-right font-medium tabular-nums">{c.score}</td>
                <td className="py-2 pl-4 text-slate-600">{c.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
