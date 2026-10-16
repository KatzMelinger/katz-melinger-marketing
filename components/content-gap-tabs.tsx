"use client";

/**
 * Content gap views (Oct 6 spec, Task 18). Each item shows its data source and
 * one action: "Create brief" opens the brief wizard (which runs Task 15's
 * keyword selection), "Refresh page" starts a Redraft of that URL.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import type { GapAction, GapItem, GapResult, GapView } from "@/lib/content-gaps";

export const GAP_TABS: { id: GapView; label: string; blurb: string }[] = [
  { id: "striking", label: "Striking distance", blurb: "Queries at positions 6 to 20 with 30+ impressions in 28 days, by page. Refresh the page to move them up." },
  { id: "missing", label: "Missing target", blurb: "Tracked terms the site does not rank for whose topic belongs to a pillar page. Retarget that page instead of writing a new one." },
  { id: "clusters", label: "Cluster gaps", blurb: "Pillars with three or more open terms and no page covering them." },
  { id: "states", label: "State coverage", blurb: "New York vs New Jersey: ranking queries and pages. New Jersey is flagged under 25 percent." },
  { id: "language", label: "Language", blurb: "Spanish searches that earn impressions with no Spanish page." },
  { id: "questions", label: "Questions", blurb: "Question searches that earn clicks, and sibling questions from DataForSEO and People Also Ask." },
];

export function ContentGapTabs({
  view,
  onCreateBrief,
}: {
  view: GapView;
  onCreateBrief: (a: Extract<GapAction, { kind: "brief" }>) => void;
}) {
  const [data, setData] = useState<GapResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    setLoading(true);
    setData(null);
    fetch(`/api/seo/gaps?view=${view}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: GapResult) => live && setData(d))
      .catch(() => live && setData({ view, items: [], summary: [], error: "Could not load" }))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [view]);

  const refresh = async (key: string, a: Extract<GapAction, { kind: "refresh" }>) => {
    setBusy(key);
    try {
      const res = await fetch("/api/content-production/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: a.url, title: a.title ?? undefined, keywords: a.keywords, primaryKeyword: a.primaryKeyword }),
      });
      const j = await res.json().catch(() => ({}));
      setDone((d) => ({ ...d, [key]: res.ok ? "Redraft created on the Production Board" : j?.error ?? "Refresh failed" }));
    } finally {
      setBusy(null);
    }
  };

  const tab = GAP_TABS.find((t) => t.id === view)!;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{tab.blurb}</p>
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {data?.error && <p className="text-sm text-red-700">{data.error}</p>}
      {data?.summary.map((s) => (
        <p key={s} className="text-xs text-slate-600">{s}</p>
      ))}
      {data && !loading && data.items.length === 0 && !data.error && <p className="text-sm text-slate-500">Nothing to show.</p>}
      <ul className="space-y-2">
        {data?.items.map((it: GapItem, i) => {
          const key = `${view}:${i}:${it.title}`;
          return (
            <li key={key} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {it.title}
                    {it.flag && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{it.flag}</span>}
                  </div>
                  <div className="text-xs text-slate-600">{it.detail}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">Source: {it.source}</div>
                </div>
                <div className="shrink-0 text-xs">
                  {it.action?.kind === "brief" && (
                    <button type="button" className="rounded-md bg-brand px-3 py-1.5 font-medium text-white" onClick={() => onCreateBrief(it.action as Extract<GapAction, { kind: "brief" }>)}>
                      Create brief
                    </button>
                  )}
                  {it.action?.kind === "refresh" &&
                    (done[key] ? (
                      <Link href="/content-production" className="text-brand underline">
                        {done[key]}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === key}
                        className="rounded-md border border-brand px-3 py-1.5 font-medium text-brand disabled:opacity-50"
                        onClick={() => void refresh(key, it.action as Extract<GapAction, { kind: "refresh" }>)}
                      >
                        {busy === key ? "Starting…" : view === "missing" ? "Retarget page" : "Refresh page"}
                      </button>
                    ))}
                  {!it.action && <span className="text-slate-400">covered</span>}
                </div>
              </div>
              {it.rows && it.rows.length > 0 && (
                <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">
                  {it.rows.map((r) => (
                    <li key={`${r.label}:${r.value}`} className="flex justify-between gap-2">
                      <span className="truncate">{r.label}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">{r.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
