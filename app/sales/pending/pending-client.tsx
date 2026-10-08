"use client";

import { useEffect, useMemo, useState } from "react";

import {
  AGE_BUCKETS,
  HEALTH_LABEL,
  HEALTH_ORDER,
  STAGE_LABEL,
  type AgeBucket,
  type Health,
  type OwnerRollup,
  type PendingRow,
  type Stage,
  type StageRollup,
} from "@/lib/sales-dashboard/pending";

import { Card, fmtNum, Tile } from "../ui";

type ApiResult = {
  rows: PendingRow[];
  byStage: StageRollup[];
  byOwner: OwnerRollup[];
  options: { categories: string[]; sources: string[] };
};

const HEALTH_BADGE: Record<Health, string> = {
  on_track: "bg-emerald-100 text-emerald-800",
  watch: "bg-amber-100 text-amber-900",
  stalling: "bg-orange-100 text-orange-900",
  critical: "bg-rose-100 text-rose-800",
};

const HEALTH_TEXT: Record<Health, string> = {
  on_track: "text-emerald-700",
  watch: "text-amber-700",
  stalling: "text-orange-700",
  critical: "text-rose-700",
};

const PRIORITY_BADGE: Record<string, string> = {
  High: "bg-blue-100 text-blue-900",
  Medium: "bg-sky-50 text-sky-800",
  Low: "bg-slate-100 text-slate-600",
};

const STAGES: Stage[] = ["not_contacted", "sales_call_done", "letter_out"];

/** Compact "3 critical · 2 stalling" summary, worst tiers first, zeros omitted. */
function HealthCounts({ counts }: { counts: Record<Health, number> }) {
  const parts = HEALTH_ORDER.filter((h) => counts[h] > 0);
  if (!parts.length) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
      {parts.map((h) => (
        <span key={h} className={`tabular-nums ${HEALTH_TEXT[h]}`}>
          {counts[h]} {HEALTH_LABEL[h].toLowerCase()}
        </span>
      ))}
    </span>
  );
}

export function PendingIntakesClient() {
  const [data, setData] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [ageBucket, setAgeBucket] = useState<AgeBucket | "">("");
  const [health, setHealth] = useState<Health | "">("");
  const [stage, setStage] = useState<Stage | "">("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");

  const [aiFlags, setAiFlags] = useState<Map<string, { stale: boolean; reason: string }>>(new Map());
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/sales-dashboard/pending", { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
        setData(json as ApiResult);
        setError(null);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      });
    return () => ctrl.abort();
  }, []);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (ageBucket && r.ageBucket !== ageBucket) return false;
      if (health && r.health !== health) return false;
      if (stage && r.stage !== stage) return false;
      if (ownerFilter && (r.owner ?? "Unassigned") !== ownerFilter) return false;
      if (category && (r.category ?? "(none)") !== category) return false;
      if (source && (r.source ?? "(none)") !== source) return false;
      if (needle && !(r.name ?? "").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, ageBucket, health, stage, ownerFilter, category, source, q]);

  const counts = useMemo(() => {
    const byHealth = Object.fromEntries(HEALTH_ORDER.map((h) => [h, 0])) as Record<Health, number>;
    for (const r of rows) byHealth[r.health]++;
    return byHealth;
  }, [rows]);

  async function runAiReview() {
    const ids = filtered.slice(0, 75).map((r) => r.id);
    if (!ids.length) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/sales-dashboard/pending/notes-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      setAiFlags((prev) => {
        const next = new Map(prev);
        for (const f of json.flags as { id: string; stale: boolean; reason: string }[]) {
          next.set(f.id, { stale: f.stale, reason: f.reason });
        }
        return next;
      });
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pending Intakes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every open intake — not signed, declined, or referred out — any creation date.
          </p>
        </div>
      </header>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
      {!data && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Open pending" value={fmtNum(rows.length)} />
            <Tile label="Critical" value={fmtNum(counts.critical)} sub="30+ days stale, letter 14+ days, or 60+ days untouched" />
            <Tile label="Stalling" value={fmtNum(counts.stalling)} sub="14+ days since last update" />
            <Tile label="On track" value={fmtNum(counts.on_track + counts.watch)} sub="touched within 2 weeks" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Where it's stalling in the funnel" note="click a stage to filter the table">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="py-2 font-normal">Stage</th>
                      <th className="py-2 text-right font-normal">Open</th>
                      <th className="py-2 pl-3 font-normal">Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byStage.map((s) => (
                      <tr
                        key={s.stage}
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                        onClick={() => setStage((cur) => (cur === s.stage ? "" : s.stage))}
                      >
                        <td className={`py-2 pr-2 ${stage === s.stage ? "font-medium text-brand" : ""}`}>{s.label}</td>
                        <td className="py-2 text-right tabular-nums">{fmtNum(s.total)}</td>
                        <td className="py-2 pl-3">
                          <HealthCounts counts={s.counts} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="By owner" note="click a name to filter the table">
              <div className="max-h-64 overflow-y-auto overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="py-2 font-normal">Owner</th>
                      <th className="py-2 text-right font-normal">Open</th>
                      <th className="py-2 pl-3 font-normal">Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byOwner.map((o) => (
                      <tr
                        key={o.owner}
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                        onClick={() => setOwnerFilter((cur) => (cur === o.owner ? "" : o.owner))}
                      >
                        <td className={`py-2 pr-2 ${ownerFilter === o.owner ? "font-medium text-brand" : ""}`}>{o.owner}</td>
                        <td className="py-2 text-right tabular-nums">{fmtNum(o.total)}</td>
                        <td className="py-2 pl-3">
                          <HealthCounts counts={o.counts} />
                        </td>
                      </tr>
                    ))}
                    {data.byOwner.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-4 text-center text-slate-400">
                          No open intakes.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card title="Filters">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Age"
                value={ageBucket}
                onChange={(e) => setAgeBucket(e.target.value as AgeBucket | "")}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Any age</option>
                {AGE_BUCKETS.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Health"
                value={health}
                onChange={(e) => setHealth(e.target.value as Health | "")}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Any status</option>
                {HEALTH_ORDER.map((h) => (
                  <option key={h} value={h}>
                    {HEALTH_LABEL[h]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Pipeline stage"
                value={stage}
                onChange={(e) => setStage(e.target.value as Stage | "")}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Any stage</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Case category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">All case types</option>
                {data.options.categories.map((c) => (
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
                {data.options.sources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="search"
                placeholder="Search name…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              />
              {ownerFilter ? (
                <button
                  type="button"
                  onClick={() => setOwnerFilter("")}
                  className="rounded-md bg-slate-100 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-200"
                >
                  Owner: {ownerFilter} ✕
                </button>
              ) : null}
              <button
                type="button"
                onClick={runAiReview}
                disabled={aiLoading || filtered.length === 0}
                className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title="Ask Claude to read Follow-Up Notes on the rows below and flag any overdue promised next step"
              >
                {aiLoading ? "Reviewing notes…" : `Run AI note review (${Math.min(filtered.length, 75)} shown)`}
              </button>
            </div>
            {aiError ? <p className="mt-2 text-xs text-rose-700">{aiError}</p> : null}
          </Card>

          <Card title={`Pending intakes (${filtered.length})`} note="sorted by most urgent first">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 font-normal">Name</th>
                    <th className="py-2 font-normal">Status</th>
                    <th className="py-2 font-normal">Stage</th>
                    <th className="py-2 font-normal">Category</th>
                    <th className="py-2 font-normal">Priority</th>
                    <th className="py-2 font-normal">Owner</th>
                    <th className="py-2 text-right font-normal">Age</th>
                    <th className="py-2 text-right font-normal">Last update</th>
                    <th className="py-2 text-right font-normal">Letter pending</th>
                    <th className="py-2 font-normal">Health</th>
                    <th className="py-2 font-normal">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const ai = aiFlags.get(r.id);
                    return (
                      <tr key={r.id} className="border-b border-slate-100 align-top">
                        <td className="py-2 pr-2">{r.name ?? "Unnamed"}</td>
                        <td className="py-2 pr-2 text-slate-600">{r.status ?? "—"}</td>
                        <td className="py-2 pr-2 text-slate-600">{STAGE_LABEL[r.stage]}</td>
                        <td className="py-2 pr-2 text-slate-600">{r.category ?? "—"}</td>
                        <td className="py-2 pr-2">
                          {r.priority ? (
                            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_BADGE[r.priority]}`}>
                              {r.priority}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-2 text-slate-600">{r.owner ?? "—"}</td>
                        <td className="py-2 text-right tabular-nums">{r.daysOld}d</td>
                        <td className="py-2 text-right tabular-nums">
                          {r.daysSinceModified != null ? `${r.daysSinceModified}d` : "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {r.letterPendingDays != null ? `${r.letterPendingDays}d` : "—"}
                        </td>
                        <td className="py-2 pr-2">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${HEALTH_BADGE[r.health]}`}
                            title={r.reasons.join("; ") || undefined}
                          >
                            {HEALTH_LABEL[r.health]}
                          </span>
                          {r.reasons.length ? (
                            <p className="mt-1 max-w-[16rem] text-xs text-slate-500">{r.reasons.join(" · ")}</p>
                          ) : null}
                        </td>
                        <td className="py-2 max-w-[18rem] text-xs text-slate-600">
                          {ai ? (
                            <p className={ai.stale ? "font-medium text-rose-700" : "text-slate-500"}>
                              {ai.stale ? "⚠ " : "✓ "}
                              {ai.reason || (ai.stale ? "Looks overdue per notes" : "No overdue step found")}
                            </p>
                          ) : null}
                          <p className="truncate text-slate-500" title={r.lastNoteText ?? undefined}>
                            {r.lastNoteText ?? "—"}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-6 text-center text-slate-400">
                        No pending intakes match these filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
