"use client";

/**
 * Current-facts editor. Edits the authoritative statutory figures stored in the
 * `current_facts` table via /api/current-facts. The content generators inject
 * these (so drafts use correct values and refreshes replace stale ones) and the
 * freshness gate shows them to the reviewer. Editing here needs no code change.
 */

import { useEffect, useState } from "react";

import type { CurrentFact } from "@/lib/current-facts";

type Editable = CurrentFact;

const blank = (): Editable => ({
  id: "",
  label: "",
  value: "",
  jurisdiction: "",
  effectiveDate: "",
  keywords: [],
});

export default function CurrentFactsSettingsPage() {
  const [facts, setFacts] = useState<Editable[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/current-facts")
      .then((r) => r.json())
      .then((j) => setFacts(Array.isArray(j?.facts) ? j.facts : []))
      .catch(() => setError("Failed to load current facts"))
      .finally(() => setLoading(false));
  }, []);

  const dirtyReset = () => {
    setSaved(false);
    setError(null);
  };
  const update = (i: number, patch: Partial<Editable>) => {
    dirtyReset();
    setFacts((a) => a.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  };
  const remove = (i: number) => {
    dirtyReset();
    setFacts((a) => a.filter((_, idx) => idx !== i));
  };
  const add = () => {
    dirtyReset();
    setFacts((a) => [...a, blank()]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const cleaned = facts
        .map((f) => ({ ...f, label: f.label.trim(), value: f.value.trim() }))
        .filter((f) => f.label && f.value);
      const res = await fetch("/api/current-facts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts: cleaned }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error ?? "Failed to save");
        return;
      }
      setFacts(Array.isArray(j?.facts) ? j.facts : cleaned);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-slate-900">Current Figures</h1>
      <p className="mt-2 text-sm text-slate-600">
        The authoritative source of current statutory figures (minimum wage,
        salary thresholds, and similar). Draft generation uses these exact values,
        a refresh replaces stale numbers with them, and the review gate shows them
        to the reviewer. Keep these current — a stale value here becomes a stale
        value on the site.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="mt-6">
          <ul className="space-y-4">
            {facts.map((f, i) => (
              <li key={i} className="rounded-lg border border-[#e2e8f0] p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label="Label" value={f.label} onChange={(v) => update(i, { label: v })} placeholder="NY minimum wage (NYC)" />
                  <Field label="Current value" value={f.value} onChange={(v) => update(i, { value: v })} placeholder="$17.00 per hour" />
                  <Field label="Jurisdiction" value={f.jurisdiction} onChange={(v) => update(i, { jurisdiction: v })} placeholder="New York City, Long Island, Westchester" />
                  <Field label="Effective date" value={f.effectiveDate} onChange={(v) => update(i, { effectiveDate: v })} placeholder="2026-01-01" />
                </div>
                <div className="mt-2">
                  <Field
                    label="Keywords (comma separated)"
                    value={f.keywords.join(", ")}
                    onChange={(v) => update(i, { keywords: v.split(",").map((k) => k.trim()).filter(Boolean) })}
                    placeholder="minimum wage, min wage, hourly wage"
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => remove(i)}
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <button
            onClick={add}
            className="mt-3 rounded-lg border border-dashed border-brand px-3 py-2 text-sm text-brand hover:bg-brand/5"
          >
            + Add figure
          </button>

          <div className="mt-6 flex items-center gap-3">
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
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs text-slate-600">
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none"
      />
    </label>
  );
}
