"use client";

import { useEffect, useMemo, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";

const CARD = "#1a2540";
const BORDER = "#2a3f5f";

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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const res = await fetch("/api/callrail/forms", { cache: "no-store" });
        const j = await res.json();
        if (c) return;
        if (!res.ok) {
          setError(j.error ?? "Failed to load");
          return;
        }
        setRows(Array.isArray(j.submissions) ? j.submissions : []);
        if (j.error) setError(j.error);
      } catch {
        if (!c) setError("Network error");
      }
    })();
    return () => {
      c = true;
    };
  }, []);

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
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Form submissions</h1>
          <p className="mt-1 text-sm text-slate-400">CallRail forms</p>
        </div>

        {error ? (
          <div className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100" style={{ backgroundColor: CARD }}>
            {error}
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
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white" />
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white">
              <option value="all">All sources</option>
              {sources.map(([s]) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b text-slate-400" style={{ borderColor: BORDER }}>
                  <th className="pb-3 pr-3 font-medium">Name</th>
                  <th className="pb-3 pr-3 font-medium">Phone</th>
                  <th className="pb-3 pr-3 font-medium">Email</th>
                  <th className="pb-3 pr-3 font-medium">Form</th>
                  <th className="pb-3 pr-3 font-medium">Source</th>
                  <th className="pb-3 pr-3 font-medium">Submitted</th>
                  <th className="pb-3 font-medium">Lead status</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
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
                    <tr key={id} className="border-b border-[#2a3f5f]/60">
                      <td className="py-2 pr-3 font-medium text-white">{name}</td>
                      <td className="py-2 pr-3 tabular-nums">{phone}</td>
                      <td className="py-2 pr-3">{email}</td>
                      <td className="py-2 pr-3">{formName}</td>
                      <td className="py-2 pr-3">{source}</td>
                      <td className="py-2 pr-3 text-slate-400">{whenDisplay}</td>
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
