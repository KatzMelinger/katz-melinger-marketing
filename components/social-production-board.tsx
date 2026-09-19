"use client";

/**
 * The Social view of the Production Board — spec 2.16, Diana's ask (Sept 18).
 *
 * Before this, website blogs and social posts sat in the same Kanban columns
 * (Opportunity/Draft/Approve/Published), so an Instagram carousel could sit
 * right next to a blog post. This is a SEPARATE funnel, reading only from
 * social_posts (via the existing /api/social/calendar, already used by the
 * Content Calendar) — by construction it can never mix in a blog, since blogs
 * are never rows in that table.
 *
 * Column mapping, against the ACTUAL persisted lifecycle (not an idealized
 * one): social_posts has no separate "approved but not yet scheduled" status
 * — approving a draft schedules it in the same action (see
 * app/api/social/posts/[id]/route.ts). So "Approve" here means "flagged or
 * failed — needs a reviewer's decision before it can move", which is what an
 * Approve column is actually FOR, even though the underlying status name
 * isn't literally "approved". Draft / Scheduled / Published map directly.
 *
 * Scope boundary, stated plainly: a social post generated but never saved as
 * a draft or scheduled (still sitting only in the composer) has no
 * social_posts row yet, so it won't appear here until someone acts on it at
 * least once. That's the Repurpose review drawer's job, not this board's.
 */

import { useEffect, useMemo, useState } from "react";

type CalendarItem = {
  id: string;
  platform: string;
  body: string;
  status: string;
  date: string;
  postUrl: string | null;
  sourceDraftId: string | null;
  lastError: string | null;
  hasMedia: boolean;
  source: { title: string; url?: string | null } | null;
};

type Column = "draft" | "approve" | "scheduled" | "published";

const COLUMNS: { id: Column; label: string; hint: string }[] = [
  { id: "draft", label: "Draft", hint: "Drafted, not yet submitted" },
  { id: "approve", label: "Approve", hint: "Flagged or failed — needs a decision" },
  { id: "scheduled", label: "Scheduled", hint: "On the calendar, not live yet" },
  { id: "published", label: "Published", hint: "Live" },
];

function columnFor(status: string): Column {
  if (status === "scheduled") return "scheduled";
  if (status === "published") return "published";
  if (status === "flagged" || status === "failed") return "approve";
  return "draft"; // default/unknown statuses read as needing a look, same as a fresh draft
}

function platformLabel(p: string): string {
  const map: Record<string, string> = {
    linkedin: "LinkedIn",
    facebook: "Facebook",
    instagram: "Instagram",
    tiktok: "TikTok",
    gmb: "Google",
    twitter: "X",
    threads: "Threads",
    pinterest: "Pinterest",
    youtube: "YouTube",
  };
  return map[p] ?? p;
}

export function SocialProductionBoard({ onSwitchToWebsite }: { onSwitchToWebsite: () => void }) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/social/calendar", { cache: "no-store" });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Failed to load");
        if (!cancelled) setItems((j.items ?? []) as CalendarItem[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const channels = useMemo(
    () => [...new Set(items.map((i) => i.platform).filter(Boolean))].sort(),
    [items],
  );
  const sourceBlogs = useMemo(
    () => [...new Set(items.map((i) => i.source?.title).filter((t): t is string => !!t))].sort(),
    [items],
  );

  const filtered = items.filter(
    (i) =>
      (channelFilter === "all" || i.platform === channelFilter) &&
      (sourceFilter === "all" || i.source?.title === sourceFilter),
  );

  const byColumn = new Map<Column, CalendarItem[]>(COLUMNS.map((c) => [c.id, []]));
  for (const item of filtered) byColumn.get(columnFor(item.status))!.push(item);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          Social posts only — Draft, Approve, Scheduled, and Published, with no blogs mixed in.
        </p>
        <button
          onClick={onSwitchToWebsite}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brand hover:text-brand"
        >
          ← Back to Website board
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        {channels.length > 0 && (
          <label className="flex items-center gap-1">
            <span className="text-slate-400">Channel:</span>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
            >
              <option value="all">All</option>
              {channels.map((c) => (
                <option key={c} value={c}>
                  {platformLabel(c)}
                </option>
              ))}
            </select>
          </label>
        )}
        {sourceBlogs.length > 0 && (
          <label className="flex items-center gap-1">
            <span className="text-slate-400">Source blog:</span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="max-w-[220px] rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
            >
              <option value="all">All</option>
              {sourceBlogs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading && <p className="text-sm text-slate-500">Loading social posts…</p>}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-semibold text-slate-700" title={col.hint}>
                  {col.label}
                </span>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {byColumn.get(col.id)?.length ?? 0}
                </span>
              </div>
              <div className="space-y-2">
                {(byColumn.get(col.id) ?? []).map((item) => (
                  <a
                    key={item.id}
                    href="/social/content-calendar"
                    className="block rounded-md border border-slate-200 bg-white p-2.5 text-xs shadow-sm hover:border-brand"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-700">{platformLabel(item.platform)}</span>
                      <span className="text-slate-400">
                        {new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <p className="line-clamp-3 text-slate-600">{item.body || "(no text)"}</p>
                    {item.source?.title && (
                      <p className="mt-1 truncate text-slate-400">from: {item.source.title}</p>
                    )}
                    {(col.id === "approve") && item.lastError && (
                      <p className="mt-1 text-amber-700">⚠ {item.lastError}</p>
                    )}
                  </a>
                ))}
                {(byColumn.get(col.id) ?? []).length === 0 && (
                  <p className="px-1 py-3 text-center text-xs text-slate-400">Nothing here</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
