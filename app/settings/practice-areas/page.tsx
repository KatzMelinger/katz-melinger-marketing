"use client";

/**
 * Practice-areas editor. Edits the canonical list stored in the
 * `practice_areas` table via /api/practice-areas. Every Content Studio
 * dropdown and the AI firm-context prompt read from the same list, so adding
 * or renaming an area here updates the whole app — no code change needed.
 */

import { useEffect, useState } from "react";

export default function PracticeAreasSettingsPage() {
  const [areas, setAreas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/practice-areas")
      .then((r) => r.json())
      .then((j) => setAreas(Array.isArray(j?.areas) ? j.areas : []))
      .catch(() => setError("Failed to load practice areas"))
      .finally(() => setLoading(false));
  }, []);

  const dirtyReset = () => {
    setSaved(false);
    setError(null);
  };
  const update = (i: number, v: string) => {
    dirtyReset();
    setAreas((a) => a.map((x, idx) => (idx === i ? v : x)));
  };
  const remove = (i: number) => {
    dirtyReset();
    setAreas((a) => a.filter((_, idx) => idx !== i));
  };
  const add = () => {
    dirtyReset();
    setAreas((a) => [...a, ""]);
  };
  const move = (i: number, dir: -1 | 1) => {
    dirtyReset();
    setAreas((a) => {
      const j = i + dir;
      if (j < 0 || j >= a.length) return a;
      const copy = [...a];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const cleaned = areas.map((a) => a.trim()).filter(Boolean);
      const res = await fetch("/api/practice-areas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areas: cleaned }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error ?? "Failed to save");
        return;
      }
      setAreas(Array.isArray(j?.areas) ? j.areas : cleaned);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-slate-900">Practice Areas</h1>
      <p className="mt-2 text-sm text-slate-600">
        The single source of truth for practice areas across MarketOS — Content
        Studio dropdowns, draft generation, and the AI firm context all read
        this list. Edit it here; no code change needed.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="mt-6">
          <ul className="space-y-2">
            {areas.map((area, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={area}
                  onChange={(e) => update(i, e.target.value)}
                  placeholder="Practice area name"
                  className="flex-1 rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm focus:border-[#185FA5] focus:outline-none"
                />
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded border border-[#e2e8f0] px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                  title="Move up"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === areas.length - 1}
                  className="rounded border border-[#e2e8f0] px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                  title="Move down"
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  onClick={() => remove(i)}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  title="Remove"
                  aria-label="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={add}
            className="mt-3 rounded-lg border border-dashed border-[#185FA5] px-3 py-2 text-sm text-[#185FA5] hover:bg-[#185FA5]/5"
          >
            + Add practice area
          </button>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-[#185FA5] px-4 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="text-sm text-emerald-600">Saved ✓</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </div>
      )}
    </main>
  );
}
