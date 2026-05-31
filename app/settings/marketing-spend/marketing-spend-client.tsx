"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SpendRow = {
  id: string;
  source: string;
  period_month: string; // YYYY-MM-DD (first of month)
  amount: number;
  notes: string | null;
  updated_at: string;
};

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtMonth(iso: string): string {
  // iso is YYYY-MM-DD; render as "May 2026" without TZ drift.
  const [y, m] = iso.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
}

function currentMonthInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function MarketingSpendClient() {
  const [rows, setRows] = useState<SpendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [source, setSource] = useState("");
  const [month, setMonth] = useState(currentMonthInput());
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/marketing/spend", { cache: "no-store" });
      const j = (await res.json()) as { rows?: SpendRow[]; error?: string };
      if (!res.ok) {
        setError(j.error ?? `Load failed (${res.status})`);
        return;
      }
      setRows(j.rows ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!source.trim()) {
      setError("Channel/source is required.");
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/spend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: source.trim(),
          period_month: month,
          amount: amt,
          notes: notes.trim() || null,
        }),
      });
      const j = (await res.json()) as { rows?: SpendRow[]; error?: string };
      if (!res.ok) {
        setError(j.error ?? "Save failed");
        return;
      }
      setRows(j.rows ?? []);
      setAmount("");
      setNotes("");
    } catch (e) {
      setError((e as Error).message ?? "Network error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/marketing/spend?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const j = (await res.json()) as { rows?: SpendRow[]; error?: string };
      if (!res.ok) {
        setError(j.error ?? "Delete failed");
        return;
      }
      setRows(j.rows ?? []);
    } finally {
      setSaving(false);
    }
  }

  const knownSources = useMemo(
    () => [...new Set(rows.map((r) => r.source))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const total = useMemo(() => rows.reduce((s, r) => s + (r.amount ?? 0), 0), [rows]);

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      ) : null}

      <section className="rounded-xl border border-[#e2e8f0] p-5" style={{ backgroundColor: "#ffffff" }}>
        <h2 className="text-sm font-semibold text-slate-900">Add or update spend</h2>
        <p className="mt-1 text-xs text-slate-500">
          Saving a channel + month that already exists overwrites it.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 text-xs text-slate-500 lg:col-span-2">
            Channel / source
            <input
              list="known-sources"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. Google Ads"
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-2 py-1.5 text-sm text-slate-900"
            />
            <datalist id="known-sources">
              {knownSources.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Amount (USD)
            <input
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <div className="flex items-end">
            <button
              onClick={save}
              disabled={saving}
              className="w-full rounded-lg bg-[#185FA5] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <label className="mt-3 flex flex-col gap-1 text-xs text-slate-500">
          Notes (optional)
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. includes $500 LSA credit"
            className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-2 py-1.5 text-sm text-slate-900"
          />
        </label>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] p-5" style={{ backgroundColor: "#ffffff" }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Entered spend</h2>
          <span className="text-xs text-slate-500">Total: {fmtUsd(total)}</span>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No spend entered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0] text-slate-500">
                  <th className="pb-2 pr-4 font-medium">Channel</th>
                  <th className="pb-2 pr-4 font-medium">Month</th>
                  <th className="pb-2 pr-4 font-medium">Amount</th>
                  <th className="pb-2 pr-4 font-medium">Notes</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[#e2e8f0]/60 last:border-0">
                    <td className="py-2 pr-4 font-medium text-slate-900">{r.source}</td>
                    <td className="py-2 pr-4">{fmtMonth(r.period_month)}</td>
                    <td className="py-2 pr-4 tabular-nums">{fmtUsd(r.amount)}</td>
                    <td className="py-2 pr-4 text-slate-500">{r.notes ?? "—"}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => void remove(r.id)}
                        disabled={saving}
                        className="rounded-lg px-2 py-1 text-xs text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
