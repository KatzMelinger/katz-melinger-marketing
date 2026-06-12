"use client";

/**
 * Legal Directories page.
 *
 * A tracker for the legal + business directories where the firm should have a
 * claimed, accurate profile. Hybrid by design:
 *   - Manual: add a directory, set its status / priority / listing URL.
 *   - AI: "Suggest directories" asks Claude which directories matter for the
 *     firm's practice areas and drafts listing copy; one click adds each.
 *
 * Persists in seo_legal_directories via /api/seo/directories.
 */

import { useEffect, useMemo, useState } from "react";

import { SeoShell, formatNumber } from "@/components/seo-shell";

type Directory = {
  id: string;
  name: string;
  url: string | null;
  category: string;
  status: string;
  listing_url: string | null;
  priority: string;
  notes: string | null;
  source: string;
  updated_at: string;
};

type Suggested = {
  name: string;
  url: string;
  category: string;
  priority: string;
  reason: string;
  suggestedDescription: string;
};

const STATUSES = [
  { value: "not_listed", label: "Not listed" },
  { value: "in_progress", label: "In progress" },
  { value: "listed", label: "Listed" },
  { value: "claimed", label: "Claimed" },
  { value: "needs_update", label: "Needs update" },
];

const STATUS_CLASSES: Record<string, string> = {
  not_listed: "border-slate-300 bg-slate-50 text-slate-600",
  in_progress: "border-amber-300 bg-amber-50 text-amber-700",
  listed: "border-sky-300 bg-sky-50 text-sky-700",
  claimed: "border-emerald-300 bg-emerald-50 text-emerald-700",
  needs_update: "border-red-300 bg-red-50 text-red-700",
};

const CATEGORY_LABEL: Record<string, string> = {
  general: "General",
  practice: "Practice",
  local: "Local",
  bar: "Bar",
};

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export default function LegalDirectoriesPage() {
  const [directories, setDirectories] = useState<Directory[]>([]);
  const [suggestions, setSuggestions] = useState<Suggested[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/directories", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed");
        return;
      }
      setDirectories(json.directories ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const trackedNames = useMemo(
    () => new Set(directories.map((d) => d.name.toLowerCase())),
    [directories],
  );

  const sorted = useMemo(
    () =>
      [...directories].sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
          a.name.localeCompare(b.name),
      ),
    [directories],
  );

  const counts = useMemo(() => {
    const done = directories.filter((d) => d.status === "listed" || d.status === "claimed").length;
    const needsUpdate = directories.filter((d) => d.status === "needs_update").length;
    const notListed = directories.filter((d) => d.status === "not_listed").length;
    return { done, needsUpdate, notListed };
  }, [directories]);

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/directories/suggest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed to suggest");
        return;
      }
      setSuggestions(json.suggestions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to suggest");
    } finally {
      setSuggesting(false);
    }
  };

  const add = async (input: Partial<Directory> & { name: string }) => {
    setBusy(input.name);
    try {
      const res = await fetch("/api/seo/directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error ?? "Failed to add");
        return;
      }
      setNewName("");
      setNewUrl("");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    try {
      await fetch("/api/seo/directories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (d: Directory) => {
    if (!confirm(`Remove ${d.name} from tracked directories?`)) return;
    setBusy(d.id);
    try {
      await fetch(`/api/seo/directories?id=${encodeURIComponent(d.id)}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const pendingSuggestions = suggestions.filter((s) => !trackedNames.has(s.name.toLowerCase()));

  return (
    <SeoShell
      title="Legal Directories"
      subtitle="Track the legal + business directories where the firm should have a claimed, accurate profile. Use AI to find the ones that matter for your practice areas."
    >
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-4">
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Tracked</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(directories.length)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Listed / claimed</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{formatNumber(counts.done)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Needs update</p>
          <p className="mt-2 text-2xl font-semibold text-red-700">{formatNumber(counts.needsUpdate)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Not listed</p>
          <p className="mt-2 text-2xl font-semibold text-slate-500">{formatNumber(counts.notListed)}</p>
        </article>
      </section>

      {/* AI suggestions */}
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Suggested directories</h2>
            <p className="mt-1 text-xs text-slate-500">
              Claude recommends legal + business directories tailored to your practice areas and
              geography, with a draft profile blurb for each. Add the ones you want.
            </p>
          </div>
          <button
            onClick={suggest}
            disabled={suggesting}
            className="shrink-0 rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
          >
            {suggesting ? "Thinking…" : suggestions.length ? "Re-suggest" : "Suggest directories"}
          </button>
        </div>

        {pendingSuggestions.length > 0 && (
          <ul className="mt-4 space-y-2">
            {pendingSuggestions.map((s) => (
              <li
                key={s.name}
                className="rounded-md border border-[#e2e8f0] bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                        {CATEGORY_LABEL[s.category] ?? s.category}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-slate-400">
                        {s.priority} priority
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{s.reason}</p>
                    {s.suggestedDescription && (
                      <p className="mt-1 text-xs italic text-slate-500">
                        &ldquo;{s.suggestedDescription}&rdquo;
                      </p>
                    )}
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs text-[#185FA5] hover:underline"
                      >
                        {s.url}
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      add({
                        name: s.name,
                        url: s.url,
                        category: s.category,
                        priority: s.priority,
                        notes: s.suggestedDescription,
                        source: "suggested",
                      })
                    }
                    disabled={busy === s.name}
                    className="shrink-0 rounded border border-[#185FA5] px-2 py-1 text-xs text-[#185FA5] hover:bg-[#185FA5]/5 disabled:opacity-50"
                  >
                    {busy === s.name ? "…" : "+ Add"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {suggestions.length > 0 && pendingSuggestions.length === 0 && (
          <p className="mt-4 text-sm text-slate-500">All suggestions are already tracked. 🎉</p>
        )}
      </section>

      {/* Tracked directories */}
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <h2 className="text-lg font-semibold">Tracked directories</h2>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Directory name (e.g. Avvo)"
            className="flex-1 min-w-[160px] rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
          />
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://… (optional)"
            className="flex-1 min-w-[160px] rounded-md border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#185FA5] focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30"
          />
          <button
            onClick={() => newName.trim() && add({ name: newName.trim(), url: newUrl.trim() || null })}
            disabled={!newName.trim() || busy === newName.trim()}
            className="rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
          >
            Add
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {loading && directories.length === 0 && (
            <li className="text-sm text-slate-500">Loading…</li>
          )}
          {!loading && directories.length === 0 && (
            <li className="text-sm text-slate-500">
              No directories tracked yet. Click “Suggest directories” above to get started.
            </li>
          )}
          {sorted.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-[#e2e8f0] bg-white px-3 py-2"
            >
              <div className="min-w-[140px] flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{d.name}</span>
                  <span className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                    {CATEGORY_LABEL[d.category] ?? d.category}
                  </span>
                </div>
                {(d.listing_url || d.url) && (
                  <a
                    href={(d.listing_url || d.url) as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#185FA5] hover:underline"
                  >
                    {d.listing_url ? "View listing" : "Visit directory"} →
                  </a>
                )}
              </div>

              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  STATUS_CLASSES[d.status] ?? STATUS_CLASSES.not_listed
                }`}
              >
                {STATUSES.find((s) => s.value === d.status)?.label ?? d.status}
              </span>

              <select
                value={d.status}
                onChange={(e) => patch(d.id, { status: e.target.value })}
                disabled={busy === d.id}
                className="rounded-md border border-[#e2e8f0] px-2 py-1 text-xs focus:border-[#185FA5] focus:outline-none"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>

              <button
                onClick={() => remove(d)}
                disabled={busy === d.id}
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {busy === d.id ? "…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </SeoShell>
  );
}
