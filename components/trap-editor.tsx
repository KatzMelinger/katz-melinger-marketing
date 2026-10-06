"use client";

/**
 * Add / edit a known trap, and try it on a draft before saving (Diana's Oct 6
 * spec, Task 9). The test runs the exact matcher the gates use, on the server,
 * against the unsaved form — so what it shows is what the trap will catch.
 */

import { useState } from "react";

import { DashButton, DashCard, DashInput, DashSelect, DashSpinner } from "@/components/dashboard-ui";
import type { KnownTrap } from "@/lib/known-traps";

type Draft = { id: string; title: string; status: string };

type Form = {
  id?: string;
  label: string;
  matchType: KnownTrap["matchType"];
  pattern: string;
  unless: string;
  scope: string;
  matchOn: "" | "sentences" | "raw_body";
  caseSensitive: boolean;
  appliesTo: "all" | "web";
  severity: KnownTrap["severity"];
  note: string;
  enabled: boolean;
};

const EMPTY: Form = {
  label: "",
  matchType: "regex",
  pattern: "",
  unless: "",
  scope: "",
  matchOn: "sentences",
  caseSensitive: false,
  appliesTo: "all",
  severity: "important",
  note: "",
  enabled: true,
};

export function formFromTrap(t: KnownTrap): Form {
  return {
    id: t.id,
    label: t.label,
    matchType: t.matchType,
    pattern: t.pattern,
    unless: t.unless.join("\n"),
    scope: t.scope ?? "",
    matchOn: t.matchOn ?? "",
    caseSensitive: t.caseSensitive === true,
    appliesTo: t.appliesTo ?? "all",
    severity: t.severity,
    note: t.note,
    enabled: t.enabled,
  };
}

const MATCH_HELP: Record<KnownTrap["matchType"], string> = {
  regex: "A regular expression.",
  phrase: "Exact words (not case sensitive).",
  all_of: 'Every term must appear. Terms as ["term one", "term two"] or comma separated.',
  all_of_unless: "Every term must appear, and none of the Unless terms.",
  document: "One sentence matches the pattern, and the whole draft has none of the Unless terms.",
  document_missing: "Fires when the pattern (a regular expression) is NOT in the draft.",
};

function payload(f: Form) {
  return {
    id: f.id,
    label: f.label,
    matchType: f.matchType,
    pattern: f.pattern,
    unless: f.unless,
    scope: f.scope,
    matchOn: f.matchOn || null,
    caseSensitive: f.caseSensitive,
    regexFlags: /\\u\{/.test(f.pattern) ? "u" : "",
    appliesTo: f.appliesTo,
    severity: f.severity,
    note: f.note,
    enabled: f.enabled,
  };
}

export function TrapEditor({
  initial,
  drafts,
  onSaved,
  onCancel,
}: {
  initial?: KnownTrap | null;
  drafts: Draft[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<Form>(initial ? formFromTrap(initial) : EMPTY);
  const [draftId, setDraftId] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hits, setHits] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setHits(null);
  };

  const test = async () => {
    setTesting(true);
    setError(null);
    try {
      const res = await fetch("/api/content/traps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: payload(f), draftId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data?.error ?? "Test failed.");
      else setHits(data.hits ?? []);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/content/traps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(f)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data?.error ?? "Save failed.");
      else onSaved();
    } finally {
      setSaving(false);
    }
  };

  const field = "block text-xs font-medium text-slate-700";
  return (
    <DashCard className="space-y-3 border-brand/30">
      <h3 className="text-base font-semibold text-slate-900">{f.id ? "Edit trap" : "Add trap"}</h3>

      <label className={field}>
        Label
        <DashInput className="mt-1 w-full" value={f.label} onChange={(e) => set("label", e.target.value)}
          placeholder="NYSHRL with an employer size threshold" />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={field}>
          Match type
          <DashSelect className="mt-1 w-full" value={f.matchType}
            onChange={(e) => set("matchType", e.target.value as Form["matchType"])}>
            {Object.keys(MATCH_HELP).map((m) => <option key={m} value={m}>{m}</option>)}
          </DashSelect>
        </label>
        <label className={field}>
          Look in
          <DashSelect className="mt-1 w-full" value={f.matchOn}
            onChange={(e) => set("matchOn", e.target.value as Form["matchOn"])}>
            <option value="sentences">One sentence at a time</option>
            <option value="">The whole draft</option>
            <option value="raw_body">The raw text, links included</option>
          </DashSelect>
        </label>
        <label className={field}>
          Severity
          <DashSelect className="mt-1 w-full" value={f.severity}
            onChange={(e) => set("severity", e.target.value as Form["severity"])}>
            <option value="critical">critical (holds the draft)</option>
            <option value="important">important</option>
            <option value="advisory">advisory</option>
          </DashSelect>
        </label>
      </div>
      <p className="-mt-1 text-[11px] text-slate-500">{MATCH_HELP[f.matchType]}</p>

      <label className={field}>
        Pattern
        <textarea className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs" rows={2}
          value={f.pattern} onChange={(e) => set("pattern", e.target.value)} />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          Unless (one per line)
          <textarea className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs" rows={3}
            value={f.unless} onChange={(e) => set("unless", e.target.value)}
            placeholder={"all employers\nregardless of size"} />
        </label>
        <div className="space-y-2">
          <label className={field}>
            Only when the title or keyword contains
            <DashInput className="mt-1 w-full" value={f.scope.replace(/^title_or_keyword_contains:/, "")}
              onChange={(e) => set("scope", e.target.value.trim() ? `title_or_keyword_contains:${e.target.value.trim()}` : "")}
              placeholder="harass (optional)" />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={f.caseSensitive} onChange={(e) => set("caseSensitive", e.target.checked)} />
            Case sensitive
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={f.appliesTo === "web"} onChange={(e) => set("appliesTo", e.target.checked ? "web" : "all")} />
            Blogs and web pages only (never social posts)
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={f.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            Enabled
          </label>
        </div>
      </div>

      <label className={field}>
        Note: what is wrong, and the correct statement
        <textarea className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs" rows={2}
          value={f.note} onChange={(e) => set("note", e.target.value)} />
      </label>

      <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <label className={`${field} min-w-[16rem] flex-1`}>
          Test against a draft
          <DashSelect className="mt-1 w-full" value={draftId} onChange={(e) => { setDraftId(e.target.value); setHits(null); }}>
            <option value="">Choose a draft…</option>
            {drafts.map((d) => <option key={d.id} value={d.id}>{d.title} ({d.status})</option>)}
          </DashSelect>
        </label>
        <DashButton variant="outline" onClick={test} disabled={!draftId || testing || !f.pattern.trim()}>
          {testing ? <DashSpinner /> : "Test"}
        </DashButton>
      </div>

      {hits && (
        <div className={`rounded-md border p-2 text-xs ${hits.length ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
          {hits.length === 0 ? (
            <span className="text-slate-600">No match in this draft.</span>
          ) : (
            <>
              <div className="mb-1 font-medium text-amber-900">
                {hits.length} match{hits.length === 1 ? "" : "es"}:
              </div>
              <ul className="space-y-1">
                {hits.slice(0, 20).map((h, i) => <li key={i} className="italic text-slate-700">“{h}”</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}

      <div className="flex gap-2">
        <DashButton onClick={save} disabled={saving}>{saving ? <DashSpinner /> : f.id ? "Save changes" : "Add trap"}</DashButton>
        <DashButton variant="ghost" onClick={onCancel}>Cancel</DashButton>
      </div>
    </DashCard>
  );
}
