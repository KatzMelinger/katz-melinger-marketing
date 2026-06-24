"use client";

/**
 * Repurpose review drawer — the human-in-the-loop step the old fire-and-forget
 * "Generate 3 posts" action skipped.
 *
 * It shows every variation the repurpose run produced in one place. For each
 * one the user can edit the copy, pick the channel, set the date/time, or
 * discard it. "Schedule selected" sends only the kept posts to
 * /api/content-production/repurpose/schedule — generation and scheduling are
 * two deliberate steps, so nothing is posted sight-unseen.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

import { repurposeFormatMeta } from "@/lib/repurpose-formats";

export type RepurposeDraft = {
  id: string;
  format: string;
  title: string | null;
  body: string;
  metadata?: Record<string, unknown>;
};

/** Kick off a repurpose run. Both the Repurpose panel and the Optimize cards
 *  use this, each managing their own busy/error state. */
export async function requestRepurpose(input: {
  url?: string | null;
  title?: string | null;
  practiceArea?: string | null;
  keywords?: string[];
}): Promise<{ ok: boolean; topic?: string; drafts?: RepurposeDraft[]; error?: string }> {
  try {
    const res = await fetch("/api/content-production/repurpose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const j = await res.json();
    if (!res.ok) return { ok: false, error: j?.error || "Generation failed." };
    return { ok: true, topic: j.topic, drafts: j.drafts as RepurposeDraft[] };
  } catch {
    return { ok: false, error: "Generation failed." };
  }
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  twitter: "X / Twitter",
  tiktok: "TikTok",
  youtube: "YouTube",
  gmb: "Google Business",
};

type Row = {
  draftId: string;
  format: string;
  label: string;
  kind: "caption" | "script";
  body: string;
  platform: string;
  platformOptions: string[];
  date: string; // yyyy-mm-dd (local)
  time: string; // HH:mm (local)
  keep: boolean;
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Stagger kept posts across the next business days at 9:00am local by default. */
function buildRows(drafts: RepurposeDraft[]): Row[] {
  const cursor = new Date();
  return drafts.map((d) => {
    const meta = repurposeFormatMeta(d.format);
    const platforms = meta?.platforms ?? ["linkedin"];
    do {
      cursor.setDate(cursor.getDate() + 1);
    } while (cursor.getDay() === 0 || cursor.getDay() === 6);
    return {
      draftId: d.id,
      format: d.format,
      label: meta?.label ?? d.format,
      kind: meta?.kind ?? "caption",
      body: d.body,
      platform: platforms[0],
      platformOptions: platforms,
      date: ymd(cursor),
      time: "09:00",
      keep: true,
    };
  });
}

export function RepurposeReviewDrawer({
  topic,
  drafts,
  onClose,
  onScheduled,
}: {
  topic: string;
  drafts: RepurposeDraft[];
  onClose: () => void;
  onScheduled?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => buildRows(drafts));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const keepCount = useMemo(() => rows.filter((r) => r.keep && r.body.trim()).length, [rows]);

  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const schedule = async () => {
    const kept = rows.filter((r) => r.keep && r.body.trim());
    if (!kept.length) return;
    setBusy(true);
    setResult(null);
    try {
      const posts = kept.map((r) => ({
        draftId: r.draftId,
        format: r.format,
        platform: r.platform,
        body: r.body,
        // Local date+time → UTC ISO for Ayrshare / scheduled_at.
        scheduleDate: new Date(`${r.date}T${r.time}`).toISOString(),
      }));
      const res = await fetch("/api/content-production/repurpose/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts }),
      });
      const j = await res.json();
      if (!res.ok) {
        setResult({ tone: "warn", text: j?.error || "Scheduling failed." });
        return;
      }
      setResult({ tone: j.scheduled > 0 ? "ok" : "warn", text: j.message || "Scheduled." });
      onScheduled?.();
    } catch {
      setResult({ tone: "warn", text: "Scheduling failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Review &amp; schedule social posts</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              From <span className="font-medium text-slate-700">{topic}</span> · {rows.length}{" "}
              variation(s). Edit, pick channels and times, then schedule the ones you want.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-500 hover:border-brand hover:text-brand"
          >
            Close
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {rows.map((r, i) => (
            <div
              key={r.draftId}
              className={`rounded-lg border p-3 ${
                r.keep ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-60"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                    {r.label}
                  </span>
                  {r.kind === "script" && (
                    <span
                      className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] uppercase text-amber-700"
                      title="A production script (slides / shot list). The text below is what gets posted as the caption — add media in your channel before it goes live."
                    >
                      script
                    </span>
                  )}
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={r.keep}
                    onChange={(e) => patch(i, { keep: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[#185FA5]"
                  />
                  {r.keep ? "Scheduling" : "Skipped"}
                </label>
              </div>

              <textarea
                value={r.body}
                onChange={(e) => patch(i, { body: e.target.value })}
                disabled={!r.keep}
                rows={Math.min(14, Math.max(5, Math.ceil(r.body.length / 70)))}
                className="w-full resize-y rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none disabled:bg-slate-100"
              />

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1 text-slate-500">
                  Channel
                  <select
                    value={r.platform}
                    onChange={(e) => patch(i, { platform: e.target.value })}
                    disabled={!r.keep}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                  >
                    {r.platformOptions.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_LABEL[p] ?? p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1 text-slate-500">
                  Date
                  <input
                    type="date"
                    value={r.date}
                    onChange={(e) => patch(i, { date: e.target.value })}
                    disabled={!r.keep}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-500">
                  Time
                  <input
                    type="time"
                    value={r.time}
                    onChange={(e) => patch(i, { time: e.target.value })}
                    disabled={!r.keep}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                  />
                </label>
                <span className="ml-auto text-[11px] text-slate-400">
                  {r.body.trim().length} chars
                </span>
              </div>
            </div>
          ))}
        </div>

        <footer className="border-t border-slate-200 px-5 py-3">
          {result && (
            <p
              className={`mb-2 rounded-md border px-3 py-2 text-sm ${
                result.tone === "warn"
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-emerald-300 bg-emerald-50 text-emerald-800"
              }`}
            >
              {result.text}{" "}
              {result.tone === "ok" && (
                <Link href="/social/content-calendar" className="font-medium underline">
                  Open the Content Calendar →
                </Link>
              )}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">
              {keepCount} of {rows.length} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
              >
                {result?.tone === "ok" ? "Done" : "Cancel"}
              </button>
              <button
                onClick={schedule}
                disabled={busy || keepCount === 0}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Scheduling…" : `Schedule selected (${keepCount}) →`}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
