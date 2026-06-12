"use client";

import { useEffect, useMemo, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";

const CARD = "#ffffff";
const BORDER = "#e2e8f0";

type FormRow = Record<string, unknown>;

function str(r: FormRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "—";
}

export default function FormsPage() {
  const [rows, setRows] = useState<FormRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");

  async function load() {
    try {
      const res = await fetch("/api/forms", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Failed to load");
        return;
      }
      setRows(Array.isArray(j.submissions) ? j.submissions : []);
      setHint(typeof j.hint === "string" ? j.hint : null);
      setError(j.error ?? null);
    } catch {
      setError("Network error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runSync() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/forms/sync", { method: "POST" });
      const j = (await res.json()) as { synced?: number; error?: string };
      if (!res.ok) setError(j.error ?? "Sync failed");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const sources = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const s =
        str(r, "source_name", "source", "utm_source", "referrer") || "Unknown";
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const src =
        str(r, "source_name", "source", "utm_source", "referrer") || "Unknown";
      if (sourceFilter !== "all" && src !== sourceFilter) return false;
      const raw =
        str(r, "submitted_at", "created_at", "timestamp") || "";
      if (raw === "—") return true;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return true;
      if (from) {
        const f = new Date(from);
        if (d < f) return false;
      }
      if (to) {
        const t = new Date(to);
        t.setHours(23, 59, 59, 999);
        if (d > t) return false;
      }
      return true;
    });
  }, [rows, from, to, sourceFilter]);

  const thisMonth = rows.filter((r) => {
    const raw = str(r, "submitted_at", "created_at", "timestamp");
    if (raw === "—") return false;
    const d = new Date(raw);
    return !Number.isNaN(d.getTime()) && d >= monthStart;
  }).length;

  const topSource = sources[0]?.[0] ?? "—";

  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Form submissions</h1>
            <p className="mt-1 text-sm text-slate-500">CallRail forms · web-form leads</p>
          </div>
          <button
            onClick={() => void runSync()}
            disabled={busy}
            className="rounded-lg bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1369c4] disabled:opacity-50"
          >
            {busy ? "Working…" : "Sync from CallRail"}
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-800" style={{ backgroundColor: CARD }}>
            {error}
          </div>
        ) : null}
        {hint ? (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-700">
            {hint}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total submissions", value: String(rows.length), bg: "#185FA5" },
            { label: "This month", value: String(thisMonth), bg: "#166534" },
            { label: "Top form source", value: topSource, bg: "#475569" },
          ].map((c) => (
            <article key={c.label} className="rounded-xl border border-white/5 p-5" style={{ backgroundColor: c.bg }}>
              <p className="text-sm text-white/90">{c.label}</p>
              <p className="mt-2 text-2xl font-semibold">{c.value}</p>
            </article>
          ))}
        </section>

        <section className="rounded-xl border p-4" style={{ backgroundColor: CARD, borderColor: BORDER }}>
          <div className="mb-4 flex flex-wrap gap-3">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-900" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-900" />
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-2 text-sm text-slate-900">
              <option value="all">All sources</option>
              {sources.map(([s]) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b text-slate-500" style={{ borderColor: BORDER }}>
                  <th className="pb-3 pr-3 font-medium">Name</th>
                  <th className="pb-3 pr-3 font-medium">Phone</th>
                  <th className="pb-3 pr-3 font-medium">Email</th>
                  <th className="pb-3 pr-3 font-medium">Form</th>
                  <th className="pb-3 pr-3 font-medium">Source</th>
                  <th className="pb-3 pr-3 font-medium">Submitted</th>
                  <th className="pb-3 font-medium">Lead status</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {filtered.map((r, i) => {
                  const id = String(r.id ?? i);
                  const name = str(r, "customer_name", "person_name", "name", "formatted_customer_name");
                  const phone = str(r, "customer_phone_number", "phone_number", "phone");
                  const email = str(r, "customer_email", "email");
                  const formName = str(r, "form_name", "form_url");
                  const source = str(r, "source_name", "source", "utm_source", "referrer");
                  const when = str(r, "submitted_at", "created_at", "timestamp");
                  const lead = str(r, "lead_status", "status");
                  const whenDisplay = when === "—" ? "—" : new Date(when).toLocaleString();
                  return (
                    <tr key={id} className="border-b border-[#e2e8f0]/60">
                      <td className="py-2 pr-3 font-medium text-slate-900">{name}</td>
                      <td className="py-2 pr-3 tabular-nums">{phone}</td>
                      <td className="py-2 pr-3">{email}</td>
                      <td className="py-2 pr-3">{formName}</td>
                      <td className="py-2 pr-3">{source}</td>
                      <td className="py-2 pr-3 text-slate-500">{whenDisplay}</td>
                      <td className="py-2">{lead}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
