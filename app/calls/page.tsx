"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CallRow = {
  id: string;
  customer_name: string | null;
  customer_phone_number: string | null;
  source_name: string | null;
  duration: number | null;
  answered: boolean;
  start_time: string;
  lead_status: string | null;
};

function formatDurationSeconds(total: number): string {
  if (!Number.isFinite(total) || total < 0) return "—";
  const rounded = Math.round(total);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatStartTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

const navItems = [
  { label: "Dashboard", href: "/" },
  { label: "Calls", href: "/calls" },
  { label: "SEO", href: "/seo" },
  { label: "Reviews", href: "/reviews" },
  { label: "Attribution", href: "/attribution" },
] as const;

export default function CallsPage() {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState<"all" | "answered" | "missed">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/callrail/calls", { cache: "no-store" });
        const data = (await res.json()) as {
          calls?: CallRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Failed to load calls");
          return;
        }
        setCalls(Array.isArray(data.calls) ? data.calls : []);
        if (data.error) setError(data.error);
      } catch {
        if (!cancelled) setError("Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sources = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of calls) {
      const s = c.source_name?.trim() || "Unknown";
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return [...m.keys()].sort((a, b) => a.localeCompare(b));
  }, [calls]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const fromD = from ? new Date(`${from}T00:00:00`) : null;
    const toD = to ? new Date(`${to}T23:59:59`) : null;
    return calls.filter((c) => {
      if (status === "answered" && !c.answered) return false;
      if (status === "missed" && c.answered) return false;
      if (source !== "all") {
        const s = c.source_name?.trim() || "Unknown";
        if (s !== source) return false;
      }
      const t = new Date(c.start_time);
      if (fromD && !Number.isNaN(fromD.getTime()) && t < fromD) return false;
      if (toD && !Number.isNaN(toD.getTime()) && t > toD) return false;
      if (!qq) return true;
      const name = (c.customer_name ?? "").toLowerCase();
      const phone = (c.customer_phone_number ?? "").toLowerCase();
      return name.includes(qq) || phone.includes(qq);
    });
  }, [calls, q, from, to, source, status]);

  const totalCalls = filtered.length;
  const answered = filtered.filter((c) => c.answered).length;
  const answeredRate = totalCalls ? Math.round((answered / totalCalls) * 1000) / 10 : 0;
  const durSum = filtered.reduce((s, c) => s + (c.duration ?? 0), 0);
  const avgDuration = totalCalls ? durSum / totalCalls : 0;

  const header = (
    <header
      className="sticky top-0 z-10 border-b border-[#2a3f5f]"
      style={{ backgroundColor: "#0f1729" }}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight"
          style={{ color: "#185FA5" }}
        >
          KatzMelinger Marketing
        </Link>
        <nav className="flex flex-wrap items-center gap-1 sm:gap-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm transition-colors hover:bg-[#1a2540] hover:text-white ${
                item.href === "/calls"
                  ? "bg-[#1a2540] text-white"
                  : "text-slate-300"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );

  return (
    <div
      className="min-h-full text-white"
      style={{
        backgroundColor: "#0f1729",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {header}
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Call tracking
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Full CallRail list with filters
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-3">
          <article
            className="rounded-xl border border-white/5 p-5 shadow-sm"
            style={{ backgroundColor: "#185FA5" }}
          >
            <p className="text-sm font-medium text-white/90">Total calls (filtered)</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{totalCalls}</p>
          </article>
          <article
            className="rounded-xl border border-white/5 p-5 shadow-sm"
            style={{ backgroundColor: "#166534" }}
          >
            <p className="text-sm font-medium text-white/90">Answered rate</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{answeredRate}%</p>
          </article>
          <article
            className="rounded-xl border border-white/5 p-5 shadow-sm"
            style={{ backgroundColor: "#475569" }}
          >
            <p className="text-sm font-medium text-white/90">Avg duration</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">
              {formatDurationSeconds(avgDuration)}
            </p>
          </article>
        </section>

        <section
          className="rounded-xl border border-[#2a3f5f] p-4 shadow-sm sm:p-6"
          style={{ backgroundColor: "#1a2540" }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input
              className="rounded-lg border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white placeholder:text-slate-500"
              placeholder="Search name or phone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <input
              type="date"
              className="rounded-lg border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              type="date"
              className="rounded-lg border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <select
              className="rounded-lg border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="all">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-white"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "all" | "answered" | "missed")
              }
            >
              <option value="all">All statuses</option>
              <option value="answered">Answered</option>
              <option value="missed">Missed</option>
            </select>
          </div>
        </section>

        <section
          className="rounded-xl border border-[#2a3f5f] p-6 shadow-sm"
          style={{ backgroundColor: "#1a2540" }}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#2a3f5f] text-slate-400">
                  <th className="pb-3 pr-4 font-medium">Caller</th>
                  <th className="pb-3 pr-4 font-medium">Phone</th>
                  <th className="pb-3 pr-4 font-medium">Source</th>
                  <th className="pb-3 pr-4 font-medium">Duration</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 pr-4 font-medium">Lead</th>
                  <th className="pb-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {filtered.map((row) => {
                  const callerName = row.customer_name?.trim() || "Unknown caller";
                  const callerNumber = row.customer_phone_number?.trim() || "—";
                  const src = row.source_name?.trim() || "—";
                  const duration =
                    row.duration == null || row.duration < 0
                      ? "—"
                      : formatDurationSeconds(row.duration);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-[#2a3f5f]/60 last:border-0"
                    >
                      <td className="py-3 pr-4 font-medium text-white">
                        {callerName}
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-slate-300">
                        {callerNumber}
                      </td>
                      <td className="py-3 pr-4">{src}</td>
                      <td className="py-3 pr-4 tabular-nums">{duration}</td>
                      <td className="py-3 pr-4">
                        {row.answered ? (
                          <span className="inline-flex rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                            Answered
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-medium text-rose-300 ring-1 ring-rose-500/30">
                            Missed
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-slate-400">
                        {row.lead_status?.trim() || "—"}
                      </td>
                      <td className="py-3 text-slate-400">
                        {formatStartTime(row.start_time)}
                      </td>
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
