"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Staff = { id: string; name: string; initials: string | null; roles: string[] };
type Row = {
  id: string;
  name: string | null;
  created: string;
  retained: string | null;
  category: string | null;
  quality: string | null;
  had_sales_call: boolean;
  note_authors: (string | null)[];
  intake_guess: string | null;
};
type ReviewData = { signed: number; reviewed: number; todo: Row[]; staff: Staff[] };

/**
 * Leads signed before credit tracking started: Airtable has already replaced
 * their intake person and sales reviewer with matter staff, so someone who
 * knows the cases picks them here. Saved choices are final.
 */
export function ReviewClient() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, { intake: string; sales: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sales-dashboard/review", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
        setData(json as ReviewData);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  async function save(row: Row) {
    const pick = picks[row.id] ?? { intake: row.intake_guess ?? "", sales: "" };
    setSaving(row.id);
    setError(null);
    try {
      const res = await fetch("/api/sales-dashboard/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          airtable_id: row.id,
          intake_staff_id: pick.intake || null,
          sales_staff_id: pick.sales || null,
        }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Save failed (${res.status})`);
      setData((d) => (d ? { ...d, reviewed: d.reviewed + 1, todo: d.todo.filter((r) => r.id !== row.id) } : d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  const intakeStaff = data?.staff.filter((s) => s.roles.includes("intake")) ?? [];
  const salesStaff = data?.staff.filter((s) => s.roles.includes("sales")) ?? [];

  return (
    <div className="space-y-6">
      <Link href="/sales" className="text-sm text-brand hover:underline">
        ← Intake &amp; Sales
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Review signed leads</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          When a lead is signed, Airtable replaces its Legal Assistant # 1 and Attorney/Reviewer with the matter&apos;s
          staff. From now on the dashboard records them first, but leads signed earlier need someone to say who did the
          intake and who made the sale. The initials from each lead&apos;s Follow-Up Notes (before signing) are shown to
          help. Leave a choice blank for &quot;nobody&quot;.
        </p>
        {data ? (
          <p className="mt-2 text-sm text-slate-700">
            {data.reviewed} of {data.signed} signed leads have credit recorded · {data.todo.length} to go
          </p>
        ) : null}
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}
      {!data && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}

      {data?.todo.length ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs text-slate-500">
                <th className="px-3 py-2 font-normal">Lead</th>
                <th className="px-3 py-2 font-normal">Signed</th>
                <th className="px-3 py-2 font-normal">Notes by (in order)</th>
                <th className="px-3 py-2 font-normal">Intake</th>
                <th className="px-3 py-2 font-normal">Sales</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.todo.map((r) => {
                const pick = picks[r.id] ?? { intake: r.intake_guess ?? "", sales: "" };
                const set = (k: "intake" | "sales", v: string) => setPicks((p) => ({ ...p, [r.id]: { ...pick, [k]: v } }));
                return (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <div className="text-slate-900">{r.name ?? "Unnamed"}</div>
                      <div className="text-xs text-slate-500">
                        {[r.category, r.quality ? `${r.quality} quality` : null, r.had_sales_call ? "had sales call" : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{r.retained ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {r.note_authors.length ? r.note_authors.join(" → ") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={`Intake for ${r.name ?? "lead"}`}
                        value={pick.intake}
                        onChange={(e) => set("intake", e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1"
                      >
                        <option value="">Nobody</option>
                        {intakeStaff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      {r.intake_guess && pick.intake === r.intake_guess ? (
                        <div className="mt-0.5 text-xs text-slate-400">guessed from notes</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={`Sales for ${r.name ?? "lead"}`}
                        value={pick.sales}
                        onChange={(e) => set("sales", e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1"
                      >
                        <option value="">Nobody</option>
                        {salesStaff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => void save(r)}
                        disabled={saving === r.id}
                        className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50"
                      >
                        {saving === r.id ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : data ? (
        <p className="text-sm text-emerald-700">All signed leads have credit recorded.</p>
      ) : null}
    </div>
  );
}
