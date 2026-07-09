"use client";

/**
 * Social Ops Hub / Trends & Performance  (Screen 3)
 *
 * AUTO sections (Metricool): best-performing formats, top posts, content-type
 * breakdown. EDITABLE sections (saved to social_insights): audience demographics
 * (age groups / top cities), Hot/Warm/Growing topics, and the monthly content
 * suggestion — the parts Metricool's API doesn't expose, entered in-system here.
 * Plus deep-links to each platform's native analytics.
 */

import { useEffect, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";
import { DashCard, DashSpinner } from "@/components/dashboard-ui";

type AgeGroup = { label: string; pct: number };
type City = { name: string; pct: number };
type Topic = { topic: string; status: string };
type Payload = {
  connected: boolean;
  autoError?: string | null;
  topPosts: Array<{ network: string; content: string; engagement: number; reach: number; url: string | null }>;
  bestFormats: Array<{ format: string; avgEngagement: number; count: number }>;
  contentBreakdown: Array<{ format: string; count: number }>;
  reportLinks: Array<{ network: string; url: string }>;
  audience: { ageGroups: AgeGroup[]; topCities: City[] };
  topics: Topic[];
  suggestion: string;
};

const ACCENT = "#116AB2";
const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  hot: { bg: "#fee2e2", fg: "#b91c1c", label: "Hot" },
  warm: { bg: "#fef3c7", fg: "#b45309", label: "Warm" },
  growing: { bg: "#d1fae5", fg: "#047857", label: "Growing" },
};

function fmt(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}

export default function TrendsPerformancePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // editable copies
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [topCities, setTopCities] = useState<City[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [suggestion, setSuggestion] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/social/trends-performance", { cache: "no-store" });
        const json = (await res.json()) as Payload;
        if (cancelled) return;
        setData(json);
        setAgeGroups(json.audience?.ageGroups ?? []);
        setTopCities(json.audience?.topCities ?? []);
        setTopics(json.topics ?? []);
        setSuggestion(json.suggestion ?? "");
      } catch {
        if (!cancelled) setError("Failed to load Trends & Performance.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function suggest() {
    setSuggesting(true);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/social/trends-performance/suggest", { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setSavedMsg(j.error ?? "Suggestion failed.");
        return;
      }
      if (Array.isArray(j.topics) && j.topics.length) setTopics(j.topics as Topic[]);
      if (typeof j.suggestion === "string" && j.suggestion) setSuggestion(j.suggestion);
      setSavedMsg("Drafted by Claude — review and Save.");
    } catch {
      setSavedMsg("Suggestion failed.");
    } finally {
      setSuggesting(false);
      setTimeout(() => setSavedMsg(null), 4000);
    }
  }

  async function save() {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/social/trends-performance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audience: { ageGroups, topCities }, topics, suggestion }),
      });
      const j = await res.json();
      setSavedMsg(res.ok ? "Saved." : j.error ?? "Save failed.");
    } catch {
      setSavedMsg("Save failed.");
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMsg(null), 2500);
    }
  }

  const maxFormat = Math.max(1, ...(data?.bestFormats ?? []).map((f) => f.avgEngagement));
  const totalBreakdown = (data?.contentBreakdown ?? []).reduce((s, b) => s + b.count, 0) || 1;

  return (
    <div className="min-h-full text-slate-900" style={{ backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" }}>
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">Social Ops Hub / Trends & Performance</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Trends & Performance</h1>
          <p className="mt-1 text-sm text-slate-500">
            What&apos;s working from your own data, plus audience and topic intel you curate.
          </p>
        </div>

        {error ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{error}</p> : null}

        {data === null ? (
          <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
            <DashSpinner /> Loading…
          </div>
        ) : (
          <>
            {/* AUTO: formats + breakdown */}
            <div className="grid gap-6 lg:grid-cols-2">
              <DashCard>
                <h2 className="text-lg font-semibold text-slate-900">Best performing formats</h2>
                <p className="mt-1 text-sm text-slate-500">Average engagement per post, by format.</p>
                <div className="mt-4 space-y-2.5">
                  {data.bestFormats.length === 0 ? (
                    <p className="text-sm text-slate-500">No post data available.</p>
                  ) : (
                    data.bestFormats.map((f) => (
                      <div key={f.format}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{f.format}</span>
                          <span className="tabular-nums text-slate-500">{f.avgEngagement} avg · {f.count} posts</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100">
                          <div className="h-full rounded" style={{ width: `${(f.avgEngagement / maxFormat) * 100}%`, backgroundColor: ACCENT }} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </DashCard>

              <DashCard>
                <h2 className="text-lg font-semibold text-slate-900">Content type breakdown</h2>
                <p className="mt-1 text-sm text-slate-500">Share of posts published, by format.</p>
                <div className="mt-4 space-y-2">
                  {data.contentBreakdown.map((b) => (
                    <div key={b.format} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">{b.format}</span>
                      <span className="tabular-nums text-slate-500">
                        {b.count} ({Math.round((b.count / totalBreakdown) * 100)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </DashCard>
            </div>

            {/* AUTO: top posts */}
            <DashCard>
              <h2 className="text-lg font-semibold text-slate-900">Top posts</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.topPosts.length === 0 ? (
                  <p className="text-sm text-slate-500">No posts found.</p>
                ) : (
                  data.topPosts.map((p, i) => (
                    <article key={i} className="rounded-lg border border-[#e2e8f0] p-4 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{p.network}</p>
                      <p className="mt-1 line-clamp-3 text-slate-700">{p.content}</p>
                      <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                        <span className="rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{p.engagement} eng</span>
                        <span>Reach {fmt(p.reach)}</span>
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-brand underline">
                            View
                          </a>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </DashCard>

            {/* EDITABLE: audience + topics + suggestion */}
            <DashCard>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Audience & editorial intel</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Add the info Metricool&apos;s API doesn&apos;t provide — demographics, trending topics, and next month&apos;s focus.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {savedMsg ? <span className="text-sm text-emerald-600">{savedMsg}</span> : null}
                  <button
                    type="button"
                    onClick={() => void suggest()}
                    disabled={suggesting || saving}
                    className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    style={{ borderColor: ACCENT, color: ACCENT }}
                    title="Draft trending topics + a next-month suggestion with Claude — you review and Save"
                  >
                    {suggesting ? "Thinking…" : "✦ Suggest with Claude"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ backgroundColor: ACCENT }}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-6 lg:grid-cols-2">
                {/* Age groups */}
                <EditList
                  title="Audience age groups"
                  rows={ageGroups}
                  onAdd={() => setAgeGroups([...ageGroups, { label: "", pct: 0 }])}
                  render={(row, i) => (
                    <>
                      <input
                        className="w-full rounded border border-[#e2e8f0] px-2 py-1.5 text-sm"
                        placeholder="e.g. 25–34"
                        value={row.label}
                        onChange={(e) => setAgeGroups(upd(ageGroups, i, { label: e.target.value }))}
                      />
                      <PctInput value={row.pct} onChange={(v) => setAgeGroups(upd(ageGroups, i, { pct: v }))} />
                      <RemoveBtn onClick={() => setAgeGroups(ageGroups.filter((_, j) => j !== i))} />
                    </>
                  )}
                />

                {/* Top cities */}
                <EditList
                  title="Top cities"
                  rows={topCities}
                  onAdd={() => setTopCities([...topCities, { name: "", pct: 0 }])}
                  render={(row, i) => (
                    <>
                      <input
                        className="w-full rounded border border-[#e2e8f0] px-2 py-1.5 text-sm"
                        placeholder="e.g. New York"
                        value={row.name}
                        onChange={(e) => setTopCities(upd(topCities, i, { name: e.target.value }))}
                      />
                      <PctInput value={row.pct} onChange={(v) => setTopCities(upd(topCities, i, { pct: v }))} />
                      <RemoveBtn onClick={() => setTopCities(topCities.filter((_, j) => j !== i))} />
                    </>
                  )}
                />
              </div>

              {/* Topics */}
              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700">Trending topics</h3>
                  <button
                    type="button"
                    onClick={() => setTopics([...topics, { topic: "", status: "warm" }])}
                    className="text-sm font-medium text-brand"
                  >
                    + Add topic
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {topics.length === 0 ? (
                    <p className="text-sm text-slate-400">No topics yet.</p>
                  ) : (
                    topics.map((t, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          className="w-full rounded border border-[#e2e8f0] px-2 py-1.5 text-sm"
                          placeholder="e.g. Return-to-office accommodations"
                          value={t.topic}
                          onChange={(e) => setTopics(upd(topics, i, { topic: e.target.value }))}
                        />
                        <select
                          className="rounded border border-[#e2e8f0] px-2 py-1.5 text-sm"
                          value={t.status}
                          onChange={(e) => setTopics(upd(topics, i, { status: e.target.value }))}
                          style={{ backgroundColor: STATUS_STYLE[t.status]?.bg, color: STATUS_STYLE[t.status]?.fg }}
                        >
                          <option value="hot">Hot</option>
                          <option value="warm">Warm</option>
                          <option value="growing">Growing</option>
                        </select>
                        <RemoveBtn onClick={() => setTopics(topics.filter((_, j) => j !== i))} />
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Suggestion */}
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-slate-700">Smart content suggestion (next month)</h3>
                <textarea
                  className="mt-2 w-full rounded-lg border border-[#e2e8f0] p-3 text-sm"
                  rows={3}
                  placeholder="What should the firm focus on next month, and why?"
                  value={suggestion}
                  onChange={(e) => setSuggestion(e.target.value)}
                />
              </div>
            </DashCard>

            {/* Native report links */}
            <DashCard>
              <h2 className="text-lg font-semibold text-slate-900">Open native analytics</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.reportLinks.map((l) => (
                  <a
                    key={l.network}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {l.network} ↗
                  </a>
                ))}
              </div>
            </DashCard>
          </>
        )}
      </main>
    </div>
  );
}

function upd<T>(arr: T[], i: number, patch: Partial<T>): T[] {
  return arr.map((r, j) => (j === i ? { ...r, ...patch } : r));
}

function EditList<T>({
  title,
  rows,
  onAdd,
  render,
}: {
  title: string;
  rows: T[];
  onAdd: () => void;
  render: (row: T, i: number) => React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <button type="button" onClick={onAdd} className="text-sm font-medium text-brand">
          + Add
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing added yet.</p>
        ) : (
          rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              {render(row, i)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PctInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <input
        type="number"
        min={0}
        max={100}
        className="w-16 rounded border border-[#e2e8f0] px-2 py-1.5 text-sm tabular-nums"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      <span className="text-sm text-slate-400">%</span>
    </div>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded border border-[#e2e8f0] px-2 py-1.5 text-sm text-slate-400 hover:text-rose-600"
      aria-label="Remove"
    >
      ✕
    </button>
  );
}
