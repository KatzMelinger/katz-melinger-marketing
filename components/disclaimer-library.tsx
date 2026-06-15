"use client";

/**
 * Disclaimer Library — reusable required-disclaimer snippets the ad compliance
 * checker can require (general or jurisdiction-scoped).
 *
 * Lives under Content Standards (/brand-voice). Backed by
 * /api/compliance/disclaimers (CRUD) + compliance_disclaimers table.
 */

import { useCallback, useEffect, useState } from "react";

import { US_JURISDICTIONS } from "@/lib/us-jurisdictions";

type Disclaimer = {
  id: string;
  label: string;
  text: string;
  jurisdiction: string | null;
  trigger: string | null;
  practice_area: string | null;
  enabled: boolean;
  review_status: string;
  updated_at: string;
};

const REVIEW_STATUSES = ["unverified", "verified", "needs_review", "archived"];

const input =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const label = "block text-xs font-semibold text-slate-700";

function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "amber" | "red";
}) {
  const tones: Record<string, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
  };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] ${tones[tone]}`}>{children}</span>;
}

export default function DisclaimerLibrary() {
  const [rows, setRows] = useState<Disclaimer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Disclaimer> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/compliance/disclaimers", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setRows(json.disclaimers ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!editing?.label || !editing?.text) {
      setError("Label and text are required.");
      return;
    }
    setError(null);
    const res = await fetch("/api/compliance/disclaimers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error ?? "save failed");
      return;
    }
    setEditing(null);
    load();
  }

  async function del(id: string) {
    if (!confirm("Delete this disclaimer?")) return;
    await fetch(`/api/compliance/disclaimers?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {rows.length} disclaimer{rows.length === 1 ? "" : "s"}. The ad
          compliance checker requires the relevant ones when their trigger
          applies. Leave jurisdiction blank for a general disclaimer.
        </p>
        <button
          onClick={() =>
            setEditing({ enabled: true, review_status: "unverified", jurisdiction: "" })
          }
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          + Add disclaimer
        </button>
      </div>

      {editing && (
        <div className="mb-5 rounded-lg border border-slate-300 bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Label *</label>
              <input
                className={input}
                value={editing.label ?? ""}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder="Prior results"
              />
            </div>
            <div>
              <label className={label}>Jurisdiction</label>
              <select
                className={input}
                value={editing.jurisdiction ?? ""}
                onChange={(e) => setEditing({ ...editing, jurisdiction: e.target.value })}
              >
                <option value="">General (all jurisdictions)</option>
                {US_JURISDICTIONS.map((j) => (
                  <option key={j.code} value={j.code}>
                    {j.name} ({j.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Disclaimer text *</label>
              <textarea
                className={input}
                rows={3}
                value={editing.text ?? ""}
                onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                placeholder="Prior results do not guarantee a similar outcome."
              />
            </div>
            <div>
              <label className={label}>Trigger (when it's required)</label>
              <input
                className={input}
                value={editing.trigger ?? ""}
                onChange={(e) => setEditing({ ...editing, trigger: e.target.value })}
                placeholder="case results mentioned"
              />
            </div>
            <div>
              <label className={label}>Practice area</label>
              <input
                className={input}
                value={editing.practice_area ?? ""}
                onChange={(e) => setEditing({ ...editing, practice_area: e.target.value })}
                placeholder="(optional)"
              />
            </div>
            <div>
              <label className={label}>Review status</label>
              <select
                className={input}
                value={editing.review_status ?? "unverified"}
                onChange={(e) => setEditing({ ...editing, review_status: e.target.value })}
              >
                {REVIEW_STATUSES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={editing.enabled ?? true}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>
          </div>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={save}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No disclaimers yet. Add the staples: &ldquo;Attorney Advertising,&rdquo;
          &ldquo;Prior results do not guarantee a similar outcome,&rdquo;
          &ldquo;Results vary.&rdquo;
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((d) => (
            <li key={d.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{d.label}</span>
                    <Pill>{d.jurisdiction || "general"}</Pill>
                    {d.trigger && <Pill tone="amber">{d.trigger}</Pill>}
                    <Pill tone={d.review_status === "verified" ? "green" : "amber"}>
                      {d.review_status}
                    </Pill>
                    {!d.enabled && <Pill tone="red">disabled</Pill>}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{d.text}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => setEditing(d)}
                    className="text-xs text-slate-600 hover:text-slate-900"
                  >
                    Edit
                  </button>
                  <button onClick={() => del(d.id)} className="text-xs text-red-700 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
