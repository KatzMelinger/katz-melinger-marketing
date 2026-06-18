"use client";

/**
 * Social Ops Hub / Best Time to Post  (Screen 4)
 *
 * Per-channel engagement heatmap (weekday × hour, New York time) computed from
 * post history via GET /api/social/best-time. The top two slots are highlighted
 * automatically. Cell `count` is surfaced so single-post slots read as
 * low-confidence rather than gospel.
 */

import { useEffect, useMemo, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";
import { DashCard, DashSpinner } from "@/components/dashboard-ui";

type Cell = { day: number; hour: number; count: number; avgEngagement: number };
type NetData = { key: string; totalPosts: number; placed: number; cells: Cell[]; top: Cell[] };
type Payload = { connected: boolean; error?: string; windowDays?: number; timezone?: string; networks: NetData[] };

const ACCENT = "#185FA5";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NET_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
};

function hourLabel(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}
function slotLabel(c: Cell): string {
  return `${DAYS[c.day]} ${hourLabel(c.hour)}`;
}

export default function BestTimePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [net, setNet] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/social/best-time", { cache: "no-store" });
        const json = (await res.json()) as Payload;
        if (cancelled) return;
        if (json.error) setError(json.error);
        setData(json);
        // default to the channel with the most placed posts
        const best = [...(json.networks ?? [])].sort((a, b) => b.placed - a.placed)[0];
        if (best) setNet(best.key);
      } catch {
        if (!cancelled) setError("Failed to load best-time data.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = data?.networks.find((n) => n.key === net) ?? null;

  const { cellMap, hours, max, topKeys } = useMemo(() => {
    const map = new Map<string, Cell>();
    let mx = 0;
    const hourSet = new Set<number>();
    for (let h = 7; h <= 20; h++) hourSet.add(h); // default visible band
    for (const c of current?.cells ?? []) {
      map.set(`${c.day}-${c.hour}`, c);
      hourSet.add(c.hour);
      if (c.avgEngagement > mx) mx = c.avgEngagement;
    }
    const tk = new Set((current?.top ?? []).map((c) => `${c.day}-${c.hour}`));
    return { cellMap: map, hours: [...hourSet].sort((a, b) => a - b), max: mx, topKeys: tk };
  }, [current]);

  return (
    <div className="min-h-full text-slate-900" style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}>
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">Social Ops Hub / Best Time to Post</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Best Time to Post</h1>
            <p className="mt-1 text-sm text-slate-500">
              When your audience engages most, by day and hour (New York time)
              {data?.windowDays ? ` — last ${data.windowDays} days` : ""}.
            </p>
          </div>
          {data && data.networks.length > 0 ? (
            <div className="inline-flex overflow-hidden rounded-lg border border-[#e2e8f0]">
              {data.networks
                .filter((n) => n.placed > 0)
                .map((n) => (
                  <button
                    key={n.key}
                    type="button"
                    onClick={() => setNet(n.key)}
                    className="px-3 py-1.5 text-sm font-medium"
                    style={net === n.key ? { backgroundColor: ACCENT, color: "#fff" } : { backgroundColor: "#fff", color: "#475569" }}
                  >
                    {NET_LABEL[n.key] ?? n.key}
                  </button>
                ))}
            </div>
          ) : null}
        </div>

        {error ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{error}</p> : null}

        {data === null ? (
          <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
            <DashSpinner /> Loading heatmap…
          </div>
        ) : !current || current.placed === 0 ? (
          <DashCard>
            <p className="text-sm text-slate-500">
              Not enough post history on this channel yet to compute a heatmap. Publish more, or pick another channel.
            </p>
          </DashCard>
        ) : (
          <>
            {/* Top slots callout */}
            {current.top.length > 0 ? (
              <div className="rounded-xl border-l-4 p-4" style={{ borderColor: ACCENT, backgroundColor: "#f8fafc" }}>
                <p className="text-sm font-semibold text-slate-800">Top {current.top.length} slot{current.top.length > 1 ? "s" : ""}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {current.top.map((c, i) => (
                    <span key={`${c.day}-${c.hour}`}>
                      {i > 0 ? " · " : ""}
                      <span className="font-semibold">{slotLabel(c)}</span>
                      <span className="text-slate-400"> ({c.avgEngagement} avg eng · {c.count} post{c.count > 1 ? "s" : ""})</span>
                    </span>
                  ))}
                </p>
              </div>
            ) : null}

            <DashCard>
              <div className="overflow-x-auto">
                <div className="min-w-[680px]">
                  {/* header */}
                  <div className="grid" style={{ gridTemplateColumns: "72px repeat(7, 1fr)" }}>
                    <div />
                    {DAYS.map((d) => (
                      <div key={d} className="px-1 pb-2 text-center text-xs font-semibold text-slate-500">
                        {d}
                      </div>
                    ))}
                  </div>
                  {/* rows */}
                  {hours.map((h) => (
                    <div key={h} className="grid items-stretch" style={{ gridTemplateColumns: "72px repeat(7, 1fr)" }}>
                      <div className="py-1 pr-2 text-right text-[11px] text-slate-400">{hourLabel(h)}</div>
                      {DAYS.map((_, day) => {
                        const cell = cellMap.get(`${day}-${h}`);
                        const isTop = topKeys.has(`${day}-${h}`);
                        const intensity = cell && max > 0 ? 0.12 + 0.88 * (cell.avgEngagement / max) : 0;
                        return (
                          <div
                            key={day}
                            title={
                              cell
                                ? `${DAYS[day]} ${hourLabel(h)} — ${cell.avgEngagement} avg engagement across ${cell.count} post(s)`
                                : `${DAYS[day]} ${hourLabel(h)} — no posts`
                            }
                            className="m-0.5 flex h-8 items-center justify-center rounded text-[11px] font-medium"
                            style={{
                              backgroundColor: cell ? `rgba(24,95,165,${intensity})` : "#f1f5f9",
                              color: cell && intensity > 0.55 ? "#fff" : "#475569",
                              outline: isTop ? "2px solid #F59E0B" : "none",
                              outlineOffset: isTop ? "-2px" : undefined,
                            }}
                          >
                            {cell ? (isTop ? `★ ${cell.avgEngagement}` : cell.avgEngagement) : ""}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Color = average engagement per post in that slot. ★ marks the top two. Based on {current.placed} posts;
                slots backed by a single post are weak signals.
              </p>
            </DashCard>
          </>
        )}
      </main>
    </div>
  );
}
