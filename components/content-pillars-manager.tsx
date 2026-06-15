"use client";

/**
 * Content Pillars manager — the Brand Voice editor for the DB-driven pillar
 * list. Adds/edits/reorders pillars and persists them to tenant_settings via
 * /api/content/pillars. Includes an AI wizard that proposes a pillar (or a
 * whole practice-area set) with grouper keyword hints.
 *
 * Editing here updates the keyword grouper, link plan, cluster map, and the
 * SEO-content brief dropdowns — no code change needed.
 */

import { useEffect, useState } from "react";

import type { KMPillar } from "@/lib/km-content-system";

type Area = "employment" | "collections";

type Row = {
  id: string;
  label: string;
  url: string;
  practiceArea: Area;
  keywords: string; // comma-separated in the editor
};

const AREAS: { id: Area; label: string }[] = [
  { id: "employment", label: "Employment" },
  { id: "collections", label: "Collections" },
];

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function toRow(p: KMPillar): Row {
  return {
    id: p.id,
    label: p.label,
    url: p.url,
    practiceArea: p.practiceArea === "collections" ? "collections" : "employment",
    keywords: (p.keywords ?? []).join(", "),
  };
}

function toPillar(r: Row): KMPillar {
  return {
    id: slugify(r.id || r.label),
    label: r.label.trim(),
    url: r.url.trim(),
    practiceArea: r.practiceArea,
    keywords: r.keywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function ContentPillarsManager() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    fetch("/api/content/pillars")
      .then((r) => r.json())
      .then((d) =>
        setRows(Array.isArray(d?.pillars) ? d.pillars.map(toRow) : []),
      )
      .catch(() => setError("Failed to load pillars"))
      .finally(() => setLoading(false));
  }, []);

  const dirty = () => {
    setSaved(false);
    setError(null);
  };
  const update = (i: number, patch: Partial<Row>) => {
    dirty();
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const remove = (i: number) => {
    dirty();
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };
  const addBlank = () => {
    dirty();
    setRows((rs) => [
      ...rs,
      { id: "", label: "", url: "", practiceArea: "employment", keywords: "" },
    ]);
  };
  const move = (i: number, dir: -1 | 1) => {
    dirty();
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };
  const addProposed = (pillars: KMPillar[]) => {
    dirty();
    setRows((rs) => {
      const have = new Set(rs.map((r) => slugify(r.id || r.label)));
      const fresh = pillars.map(toRow).filter((r) => !have.has(slugify(r.id || r.label)));
      return [...rs, ...fresh];
    });
    setWizardOpen(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const pillars = rows.map(toPillar).filter((p) => p.id && p.label && p.url);
      const res = await fetch("/api/content/pillars", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pillars }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error ?? "Failed to save");
        return;
      }
      setRows(Array.isArray(j?.pillars) ? j.pillars.map(toRow) : rows);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Content pillars</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            The taxonomy the keyword grouper, link plan, cluster map, and SEO
            content briefs all read. Add or edit pillars here — no code change
            needed. <span className="text-slate-500">Keywords</span> are the
            hints the grouper uses to route keywords to a pillar.
          </p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="rounded-md border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5"
        >
          ✨ Create with AI
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="mt-5 space-y-2">
          {/* Header */}
          <div className="hidden grid-cols-[1.4fr_1fr_1.6fr_1fr_2fr_auto] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 md:grid">
            <span>Label</span>
            <span>Slug (id)</span>
            <span>URL</span>
            <span>Practice area</span>
            <span>Keywords (comma-sep)</span>
            <span></span>
          </div>

          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-2 md:grid-cols-[1.4fr_1fr_1.6fr_1fr_2fr_auto] md:items-center md:border-0 md:p-0"
            >
              <input
                value={r.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Wrongful Termination"
                className="rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              />
              <input
                value={r.id}
                onChange={(e) => update(i, { id: e.target.value })}
                placeholder="wrongful-termination"
                className="rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-brand focus:outline-none"
              />
              <input
                value={r.url}
                onChange={(e) => update(i, { url: e.target.value })}
                placeholder="/wrongful-termination/"
                className="rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-brand focus:outline-none"
              />
              <select
                value={r.practiceArea}
                onChange={(e) => update(i, { practiceArea: e.target.value as Area })}
                className="rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              >
                {AREAS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
              <input
                value={r.keywords}
                onChange={(e) => update(i, { keywords: e.target.value })}
                placeholder="fired, wrongful termination, retaliation firing"
                className="rounded border border-slate-200 px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
              />
              <div className="flex items-center gap-1">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30" aria-label="Move up">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30" aria-label="Move down">↓</button>
                <button onClick={() => remove(i)} className="rounded border border-red-200 px-1.5 py-1 text-xs text-red-600 hover:bg-red-50" aria-label="Remove">×</button>
              </div>
            </div>
          ))}

          <button
            onClick={addBlank}
            className="mt-1 rounded-lg border border-dashed border-brand px-3 py-2 text-sm text-brand hover:bg-brand/5"
          >
            + Add pillar
          </button>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="text-sm text-emerald-600">Saved ✓</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </div>
      )}

      {wizardOpen && (
        <PillarWizard onClose={() => setWizardOpen(false)} onAdd={addProposed} />
      )}
    </div>
  );
}

function PillarWizard({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (pillars: KMPillar[]) => void;
}) {
  const [mode, setMode] = useState<"single" | "set">("single");
  const [practiceArea, setPracticeArea] = useState<Area>("employment");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<KMPillar[] | null>(null);

  const suggest = async () => {
    setBusy(true);
    setError(null);
    setProposed(null);
    try {
      const res = await fetch("/api/content/pillars/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, practiceArea, name, description }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error ?? "Suggestion failed");
        return;
      }
      setProposed(Array.isArray(j?.pillars) ? j.pillars : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggestion failed");
    } finally {
      setBusy(false);
    }
  };

  const canSuggest = mode === "set" || name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-base font-semibold text-slate-900">Create pillars with AI</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex gap-2">
            <button
              onClick={() => { setMode("single"); setProposed(null); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "single" ? "bg-brand text-white" : "border border-slate-200 text-slate-600"}`}
            >
              One pillar
            </button>
            <button
              onClick={() => { setMode("set"); setProposed(null); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "set" ? "bg-brand text-white" : "border border-slate-200 text-slate-600"}`}
            >
              A whole practice-area set
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            <label className="block text-sm">
              <span className="text-xs text-slate-500">Practice area</span>
              <select
                value={practiceArea}
                onChange={(e) => setPracticeArea(e.target.value as Area)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              >
                {AREAS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </label>

            {mode === "single" ? (
              <label className="block text-sm">
                <span className="text-xs text-slate-500">Pillar topic</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Whistleblower Protection"
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </label>
            ) : (
              <label className="block text-sm">
                <span className="text-xs text-slate-500">Describe the practice area (optional)</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this practice area cover? The AI proposes 3–8 pillars."
                  className="mt-1 min-h-[64px] w-full rounded border border-slate-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </label>
            )}

            <div>
              <button
                onClick={suggest}
                disabled={busy || !canSuggest}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {busy ? "Thinking…" : "Suggest pillars"}
              </button>
              {error && <span className="ml-3 text-sm text-red-600">{error}</span>}
            </div>
          </div>

          {proposed && proposed.length > 0 && (
            <div className="mt-5">
              <p className="text-sm font-medium text-slate-700">Proposed ({proposed.length})</p>
              <ul className="mt-2 space-y-2">
                {proposed.map((p) => (
                  <li key={p.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-slate-900">{p.label}</span>
                      <span className="font-mono text-[11px] text-slate-400">{p.url}</span>
                    </div>
                    {p.keywords && p.keywords.length > 0 && (
                      <p className="mt-1 text-xs text-slate-500">{p.keywords.join(", ")}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {proposed && proposed.length === 0 && (
            <p className="mt-4 text-sm text-slate-500">No pillars proposed — try a different topic.</p>
          )}
        </div>

        {proposed && proposed.length > 0 && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              onClick={() => onAdd(proposed)}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Add to list →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
