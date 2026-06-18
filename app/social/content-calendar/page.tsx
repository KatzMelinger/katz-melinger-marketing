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

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { MarketingNav } from "@/components/marketing-nav";
import { DashCard, DashSpinner } from "@/components/dashboard-ui";

type CalendarItem = {
  id: string;
  platform: string;
  body: string;
  status: string;
  date: string;
  postUrl: string | null;
  sourceDraftId: string | null;
};

type View = "month" | "week";

const ACCENT = "#185FA5";

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/social/calendar", { cache: "no-store" });
        const json = (await res.json()) as { items?: CalendarItem[]; error?: string };
        if (cancelled) return;
        if (json.error) setError(json.error);
        setItems(json.items ?? []);
      } catch {
        if (!cancelled) setError("Failed to load the calendar.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
              <MonthGrid cursor={cursor} byDay={byDay} today={today} />
            ) : (
              <WeekGrid cursor={cursor} byDay={byDay} today={today} />
            )}
          </div>
        </DashCard>
      </main>
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

function PostChip({ item }: { item: CalendarItem }) {
  const ch = channelOf(item.platform);
  const scheduled = item.status === "scheduled";
  const inner = (
    <span
      className="flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
      style={{ backgroundColor: ch.color, opacity: scheduled ? 0.85 : 1 }}
      title={`${ch.label} · ${item.status}\n${item.body}`}
    >
      {scheduled ? <span aria-hidden>🕒</span> : null}
      <span className="truncate">{item.body || ch.label}</span>
    </span>
  );
  return item.postUrl ? (
    <a href={item.postUrl} target="_blank" rel="noopener noreferrer" className="block">
      {inner}
    </a>
  ) : (
    inner
  );
}

function MonthGrid({
  cursor,
  byDay,
  today,
}: {
  cursor: Date;
  byDay: Map<string, CalendarItem[]>;
  today: Date;
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
                  <PostChip key={p.id} item={p} />
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
}: {
  cursor: Date;
  byDay: Map<string, CalendarItem[]>;
  today: Date;
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
                  <WeekChip key={p.id} item={p} />
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
                    <WeekChip key={p.id} item={p} />
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

function WeekChip({ item }: { item: CalendarItem }) {
  const ch = channelOf(item.platform);
  const d = new Date(item.date);
  const inner = (
    <span
      className="block truncate rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
      style={{ backgroundColor: ch.color, opacity: item.status === "scheduled" ? 0.85 : 1 }}
      title={`${ch.label} · ${fmtTime(d)} · ${item.status}\n${item.body}`}
    >
      {fmtTime(d)} · {item.body || ch.label}
    </span>
  );
  return item.postUrl ? (
    <a href={item.postUrl} target="_blank" rel="noopener noreferrer" className="block">
      {inner}
    </a>
  ) : (
    inner
  );
}
