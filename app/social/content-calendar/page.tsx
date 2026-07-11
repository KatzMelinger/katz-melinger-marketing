"use client";

/**
 * Social Ops Hub / Content Calendar  (Screen 1 of the six social screens)
 *
 * Monthly grid + weekly time-slot views of everything scheduled or published
 * across the firm's channels. Reads GET /api/social/calendar, which flattens
 * the social_posts table (where blog splinters, service-page posts, and manual
 * marketing alerts all land once pushed through the Ayrshare publish path).
 *
 * Posts are color-coded by channel. The two views are switchable. Data is read
 * only here — scheduling itself happens in the publish flow / scheduler.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { MarketingNav } from "@/components/marketing-nav";
import { DashCard, DashSpinner } from "@/components/dashboard-ui";
import { SocialChecklistChips } from "@/components/social-checklist-chips";

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
  // Source tag + advisory checklist from the dedicated social generator (Phase 2).
  // Present only on posts it produced; null for manual/legacy posts.
  source: { kind: string; title: string; url: string | null; id: string | null } | null;
  checklist: {
    hookFormula: boolean;
    withinCaps: boolean;
    noDashesOrBannedOpeners: boolean;
    statesSpelledOut: boolean;
    softCta: boolean;
    sensitiveToneApplied: boolean | null;
    noDuplicateThisMonth: boolean | null;
  } | null;
  // Per-post performance (Phase 4). Null until the post is live and refreshed.
  metrics: {
    impressions?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    clicks?: number;
  } | null;
  metricsUpdatedAt: string | null;
};

type View = "month" | "week";

const ACCENT = "#116AB2";

/** Channel → brand color. Falls back to slate for anything unmapped. */
const CHANNEL: Record<string, { color: string; label: string }> = {
  linkedin: { color: "#0A66C2", label: "LinkedIn" },
  instagram: { color: "#C13584", label: "Instagram" },
  facebook: { color: "#1877F2", label: "Facebook" },
  tiktok: { color: "#111827", label: "TikTok" },
  twitter: { color: "#0F172A", label: "X" },
  x: { color: "#0F172A", label: "X" },
  gmb: { color: "#34A853", label: "Google" },
  youtube: { color: "#FF0000", label: "YouTube" },
  threads: { color: "#000000", label: "Threads" },
  pinterest: { color: "#E60023", label: "Pinterest" },
  bluesky: { color: "#0285FF", label: "Bluesky" },
};

function channelOf(platform: string) {
  return CHANNEL[platform] ?? { color: "#64748B", label: platform || "Other" };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Weekly view rows: 7 AM → 8 PM. Posts outside land in an "Other" bucket. */
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function ContentCalendarPage() {
  const [items, setItems] = useState<CalendarItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("month");
  // The month/week the user is looking at (anchored to the 1st / any day in it).
  const [cursor, setCursor] = useState<Date>(() => new Date());
  // The post whose detail/edit drawer is open.
  const [selected, setSelected] = useState<CalendarItem | null>(null);

  const load = useCallback(async (): Promise<CalendarItem[]> => {
    try {
      const res = await fetch("/api/social/calendar", { cache: "no-store" });
      const json = (await res.json()) as { items?: CalendarItem[]; error?: string };
      if (json.error) setError(json.error);
      const its = json.items ?? [];
      setItems(its);
      return its;
    } catch {
      setError("Failed to load the calendar.");
      return [];
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; setState happens in load() after the await, not synchronously.
    void (async () => {
      await load();
    })();
  }, [load]);

  // Index posts by local YYYY-MM-DD for fast cell lookups.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const it of items ?? []) {
      const d = new Date(it.date);
      if (Number.isNaN(d.getTime())) continue;
      const key = ymd(d);
      const arr = map.get(key);
      if (arr) arr.push(it);
      else map.set(key, [it]);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }
    return map;
  }, [items]);

  const channelsInUse = useMemo(() => {
    const set = new Set<string>();
    for (const it of items ?? []) set.add(it.platform);
    return [...set];
  }, [items]);

  const today = new Date();

  function shift(dir: -1 | 1) {
    setCursor((c) => {
      const x = new Date(c);
      if (view === "month") x.setMonth(x.getMonth() + dir);
      else x.setDate(x.getDate() + dir * 7);
      return x;
    });
  }

  return (
    <div
      className="min-h-full text-slate-900"
      style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">
              Social Ops Hub / Content Calendar
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Content Calendar</h1>
            <p className="mt-1 text-sm text-slate-500">
              Everything scheduled and published across your channels, in one view.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-[#e2e8f0]">
              {(["month", "week"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className="px-3 py-1.5 text-sm font-medium capitalize"
                  style={
                    view === v
                      ? { backgroundColor: ACCENT, color: "#fff" }
                      : { backgroundColor: "#fff", color: "#475569" }
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DashCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => shift(-1)}
                className="rounded-md border border-[#e2e8f0] px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                aria-label="Previous"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setCursor(new Date())}
                className="rounded-md border border-[#e2e8f0] px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => shift(1)}
                className="rounded-md border border-[#e2e8f0] px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                aria-label="Next"
              >
                ›
              </button>
              <h2 className="ml-1 text-lg font-semibold text-slate-900">
                {view === "month"
                  ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
                  : (() => {
                      const s = startOfWeek(cursor);
                      const e = new Date(s.getTime() + 6 * DAY_MS);
                      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
                    })()}
              </h2>
            </div>

            {/* Status legend. The ⚠ marker means a post needs attention: a failed
                publish, or one flagged for brand / compliance review. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full border border-slate-300 bg-white" /> Draft
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>🕒</span> Scheduled
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#0A66C2" }} /> Published
              </span>
              <span className="inline-flex items-center gap-1.5" style={{ color: "#b91c1c" }}>
                <span aria-hidden>⚠</span> Failed or flagged — needs attention
              </span>
            </div>

            {/* Channel legend (only channels actually present) */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {channelsInUse.map((p) => {
                const ch = channelOf(p);
                return (
                  <span key={p} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: ch.color }}
                    />
                    {ch.label}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            {error ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
                {error}
              </p>
            ) : items === null ? (
              <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
                <DashSpinner /> Loading calendar…
              </div>
            ) : items.length === 0 ? (
              <EmptyState />
            ) : view === "month" ? (
              <MonthGrid cursor={cursor} byDay={byDay} today={today} onSelect={setSelected} />
            ) : (
              <WeekGrid cursor={cursor} byDay={byDay} today={today} onSelect={setSelected} />
            )}
          </div>
        </DashCard>
      </main>

      {selected && (
        <PostDetailDrawer
          item={selected}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            await load();
            setSelected(null);
          }}
          onRefreshed={async () => {
            // Reload but keep the drawer open on the same post, so the freshly
            // pulled metrics are shown instead of the drawer closing.
            const its = await load();
            setSelected((cur) => (cur ? its.find((i) => i.id === cur.id) ?? null : null));
          }}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-[#cbd5e1] p-10 text-center">
      <p className="text-sm font-medium text-slate-700">No posts on the calendar yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        Scheduled and published posts appear here automatically. Generate and schedule
        content to fill the calendar.
      </p>
      <Link
        href="/content"
        className="mt-4 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white"
        style={{ backgroundColor: ACCENT }}
      >
        Create a post
      </Link>
    </div>
  );
}

function PostChip({ item, onSelect }: { item: CalendarItem; onSelect: (i: CalendarItem) => void }) {
  const ch = channelOf(item.platform);
  const scheduled = item.status === "scheduled";
  const failed = item.status === "failed";
  const draft = item.status === "draft";
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="block w-full text-left"
      title={`${ch.label} · ${item.status} — click to view / edit\n${item.body}`}
    >
      <span
        className={`flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
          draft ? "border border-dashed" : "text-white"
        }`}
        style={
          draft
            ? { backgroundColor: "#fff", color: ch.color, borderColor: ch.color }
            : { backgroundColor: failed ? "#dc2626" : ch.color, opacity: scheduled ? 0.85 : 1 }
        }
      >
        {draft ? (
          <span aria-hidden>📝</span>
        ) : failed ? (
          <span aria-hidden>⚠</span>
        ) : scheduled ? (
          <span aria-hidden>🕒</span>
        ) : null}
        <span className="truncate">{item.body || ch.label}</span>
      </span>
    </button>
  );
}

function MonthGrid({
  cursor,
  byDay,
  today,
  onSelect,
}: {
  cursor: Date;
  byDay: Map<string, CalendarItem[]>;
  today: Date;
  onSelect: (item: CalendarItem) => void;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  // Always render 6 weeks (42 cells) for a stable height.
  const cells = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getTime() + i * DAY_MS));

  return (
    <div className="overflow-hidden rounded-lg border border-[#e2e8f0]">
      <div className="grid grid-cols-7 border-b border-[#e2e8f0] bg-slate-50 text-center text-xs font-semibold text-slate-500">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          const posts = byDay.get(ymd(d)) ?? [];
          return (
            <div
              key={i}
              className="min-h-[104px] border-b border-r border-[#e2e8f0] p-1.5 last:border-r-0"
              style={{ backgroundColor: inMonth ? "#fff" : "#f8fafc" }}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium"
                  style={
                    isToday
                      ? { backgroundColor: ACCENT, color: "#fff" }
                      : { color: inMonth ? "#475569" : "#cbd5e1" }
                  }
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {posts.slice(0, 4).map((p) => (
                  <PostChip key={p.id} item={p} onSelect={onSelect} />
                ))}
                {posts.length > 4 ? (
                  <span className="block px-1 text-[11px] text-slate-400">
                    +{posts.length - 4} more
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({
  cursor,
  byDay,
  today,
  onSelect,
}: {
  cursor: Date;
  byDay: Map<string, CalendarItem[]>;
  today: Date;
  onSelect: (item: CalendarItem) => void;
}) {
  const weekStart = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS));

  // Bucket each day's posts by hour; anything outside the visible range → "other".
  const layout = days.map((d) => {
    const posts = byDay.get(ymd(d)) ?? [];
    const byHour = new Map<number, CalendarItem[]>();
    const other: CalendarItem[] = [];
    for (const p of posts) {
      const h = new Date(p.date).getHours();
      if (h >= HOURS[0] && h <= HOURS[HOURS.length - 1]) {
        const arr = byHour.get(h);
        if (arr) arr.push(p);
        else byHour.set(h, [p]);
      } else {
        other.push(p);
      }
    }
    return { date: d, byHour, other };
  });

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        {/* Header row of days */}
        <div className="grid" style={{ gridTemplateColumns: "64px repeat(7, 1fr)" }}>
          <div className="border-b border-[#e2e8f0]" />
          {days.map((d, i) => {
            const isToday = sameDay(d, today);
            return (
              <div
                key={i}
                className="border-b border-l border-[#e2e8f0] px-2 py-2 text-center text-xs"
                style={isToday ? { backgroundColor: "#eff6ff" } : undefined}
              >
                <div className="font-semibold text-slate-600">{WEEKDAYS[d.getDay()]}</div>
                <div
                  className="mx-auto mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-medium"
                  style={isToday ? { backgroundColor: ACCENT, color: "#fff" } : { color: "#94a3b8" }}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* "Other times" row for posts outside 7 AM–8 PM */}
        {layout.some((c) => c.other.length > 0) ? (
          <div className="grid" style={{ gridTemplateColumns: "64px repeat(7, 1fr)" }}>
            <div className="border-b border-[#e2e8f0] px-2 py-2 text-right text-[11px] text-slate-400">
              Other
            </div>
            {layout.map((c, i) => (
              <div key={i} className="min-h-[40px] space-y-1 border-b border-l border-[#e2e8f0] p-1">
                {c.other.map((p) => (
                  <WeekChip key={p.id} item={p} onSelect={onSelect} />
                ))}
              </div>
            ))}
          </div>
        ) : null}

        {/* Hour rows */}
        {HOURS.map((h) => (
          <div key={h} className="grid" style={{ gridTemplateColumns: "64px repeat(7, 1fr)" }}>
            <div className="border-b border-[#e2e8f0] px-2 py-2 text-right text-[11px] text-slate-400">
              {h % 12 === 0 ? 12 : h % 12} {h < 12 ? "AM" : "PM"}
            </div>
            {layout.map((c, i) => {
              const posts = c.byHour.get(h) ?? [];
              return (
                <div
                  key={i}
                  className="min-h-[44px] space-y-1 border-b border-l border-[#e2e8f0] p-1"
                >
                  {posts.map((p) => (
                    <WeekChip key={p.id} item={p} onSelect={onSelect} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Click-through detail for a calendar post: view the full caption + status, and
 * for anything not yet published, edit the caption, reschedule the date/time, or
 * delete/unschedule it. Published posts are read-only with a link out.
 */
function PostDetailDrawer({
  item,
  onClose,
  onChanged,
  onRefreshed,
}: {
  item: CalendarItem;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onRefreshed: () => void | Promise<void>;
}) {
  const ch = channelOf(item.platform);
  const editable = item.status !== "published";
  const d0 = new Date(item.date);
  const [content, setContent] = useState(item.body);
  const [date, setDate] = useState(ymd(d0));
  const [time, setTime] = useState(hhmm(d0));
  const [busy, setBusy] = useState<null | "save" | "delete" | "approve" | "metrics">(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const save = async () => {
    setBusy("save");
    setMsg(null);
    try {
      const res = await fetch(`/api/social/posts/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          scheduleDate: new Date(`${date}T${time}`).toISOString(),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg({ tone: "warn", text: j?.error || "Update failed." });
        return;
      }
      await onChanged();
    } catch {
      setMsg({ tone: "warn", text: "Update failed." });
    } finally {
      setBusy(null);
    }
  };

  // Approve a draft → send it to Ayrshare and flip it to scheduled.
  const approve = async () => {
    setBusy("approve");
    setMsg(null);
    try {
      const res = await fetch(`/api/social/posts/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: true }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg({ tone: "warn", text: j?.error || "Approve failed." });
        return;
      }
      setMsg({ tone: "ok", text: j.message || "Approved and scheduled." });
      await onChanged();
    } catch {
      setMsg({ tone: "warn", text: "Approve failed." });
    } finally {
      setBusy(null);
    }
  };

  // Pull fresh stats from Ayrshare for this one post now.
  const refreshMetrics = async () => {
    setBusy("metrics");
    setMsg(null);
    try {
      const res = await fetch("/api/social/metrics/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) {
        setMsg({ tone: "warn", text: j?.error || "Could not refresh metrics." });
        return;
      }
      setMsg({ tone: "ok", text: j.refreshed ? "Metrics updated." : "No new metrics available yet." });
      await onRefreshed();
    } catch {
      setMsg({ tone: "warn", text: "Could not refresh metrics." });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm("Unschedule and remove this post?")) return;
    setBusy("delete");
    setMsg(null);
    try {
      const res = await fetch(`/api/social/posts/${item.id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) {
        setMsg({ tone: "warn", text: j?.error || "Delete failed." });
        return;
      }
      await onChanged();
    } catch {
      setMsg({ tone: "warn", text: "Delete failed." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: ch.color }}
            />
            <div>
              <h2 className="text-base font-semibold text-slate-900">{ch.label} post</h2>
              <span
                className={`text-xs font-medium ${
                  item.status === "failed"
                    ? "text-red-600"
                    : item.status === "draft"
                      ? "text-amber-600"
                      : item.status === "scheduled"
                        ? "text-slate-500"
                        : "text-emerald-600"
                }`}
              >
                {item.status}
                {item.hasMedia ? " · has media" : ""}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-500 hover:border-slate-400"
          >
            Close
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {item.status === "failed" && item.lastError && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              <strong>Rejected:</strong> {item.lastError}
            </div>
          )}

          {item.source && (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Generated from this {item.source.kind.replace("_", " ")}:{" "}
              <span className="font-medium text-slate-800">{item.source.title}</span>
            </div>
          )}

          {item.checklist && <SocialChecklistChips checklist={item.checklist} />}

          {(item.status === "published" || item.status === "scheduled") && (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">Performance</span>
                <button
                  onClick={refreshMetrics}
                  disabled={busy !== null}
                  className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                >
                  {busy === "metrics" ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              {item.metrics ? (
                <>
                  <div className="mt-1.5 grid grid-cols-3 gap-2 text-center">
                    {(
                      [
                        ["Impressions", item.metrics.impressions],
                        ["Reach", item.metrics.reach],
                        ["Likes", item.metrics.likes],
                        ["Comments", item.metrics.comments],
                        ["Shares", item.metrics.shares],
                        ["Clicks", item.metrics.clicks],
                      ] as const
                    ).map(([label, val]) => (
                      <div key={label} className="rounded bg-slate-50 py-1.5">
                        <div className="text-sm font-semibold text-slate-800">
                          {typeof val === "number" ? val.toLocaleString() : "—"}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
                      </div>
                    ))}
                  </div>
                  {item.metricsUpdatedAt && (
                    <p className="mt-1 text-[10px] text-slate-400">
                      Updated {new Date(item.metricsUpdatedAt).toLocaleString()}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-xs text-slate-400">
                  No stats yet. They appear once the post is live and the next refresh runs.
                </p>
              )}
            </div>
          )}

          <label className="block text-sm font-medium text-slate-700">
            Caption
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={!editable}
              rows={10}
              className="mt-1 w-full resize-y rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none disabled:bg-slate-100"
            />
          </label>

          {editable && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1 text-slate-600">
                Date
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex items-center gap-1 text-slate-600">
                Time
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
            </div>
          )}

          {item.hasMedia && (
            <p className="text-xs text-slate-400">
              This post has media attached (e.g. carousel slides). Its images are kept when you
              reschedule; to change the images, re-run Repurpose.
            </p>
          )}

          {item.postUrl && (
            <a
              href={item.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm font-medium text-brand hover:underline"
            >
              View the live post →
            </a>
          )}

          {msg && (
            <p
              className={`rounded-md border px-3 py-2 text-sm ${
                msg.tone === "warn"
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-emerald-300 bg-emerald-50 text-emerald-800"
              }`}
            >
              {msg.text}
            </p>
          )}
        </div>

        {editable && (
          <footer className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
            <button
              onClick={remove}
              disabled={busy !== null}
              className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {busy === "delete" ? "Removing…" : "Delete / Unschedule"}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={busy !== null}
                className={
                  item.status === "draft"
                    ? "rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand hover:text-brand disabled:opacity-50"
                    : "rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90 disabled:opacity-50"
                }
              >
                {busy === "save" ? "Saving…" : "Save changes"}
              </button>
              {item.status === "draft" && (
                <button
                  onClick={approve}
                  disabled={busy !== null}
                  className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90 disabled:opacity-50"
                >
                  {busy === "approve" ? "Scheduling…" : "Approve & schedule"}
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

function WeekChip({ item, onSelect }: { item: CalendarItem; onSelect: (i: CalendarItem) => void }) {
  const ch = channelOf(item.platform);
  const d = new Date(item.date);
  const failed = item.status === "failed";
  const draft = item.status === "draft";
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="block w-full text-left"
      title={`${ch.label} · ${fmtTime(d)} · ${item.status} — click to view / edit\n${item.body}`}
    >
      <span
        className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
          draft ? "border border-dashed" : "text-white"
        }`}
        style={
          draft
            ? { backgroundColor: "#fff", color: ch.color, borderColor: ch.color }
            : { backgroundColor: failed ? "#dc2626" : ch.color, opacity: item.status === "scheduled" ? 0.85 : 1 }
        }
      >
        {draft ? "📝 " : failed ? "⚠ " : ""}
        {fmtTime(d)} · {item.body || ch.label}
      </span>
    </button>
  );
}
