"use client";

/**
 * Legal Authority Library — curated, attorney-vetted legal sources (statutes,
 * regulations, agency guidance, case law) used for legal accuracy when content
 * research packets are generated.
 *
 * Lives under Content Standards (/brand-voice). Backed by the existing
 * /api/content/research/legal endpoint + legal_authority_sources table.
 */

import { useCallback, useEffect, useState } from "react";

type LegalSource = {
  id: string;
  name: string;
  url: string;
  source_type: string;
  practice_area: string | null;
  jurisdiction: string | null;
  authority_level: string;
  topics: string[];
  notes: string | null;
  review_status: string;
  updated_at: string;
};

const PRACTICE_AREAS = [
  "",
  "employment",
  "Employment Discrimination",
  "FMLA",
  "Wage & Hour Claims",
  "Wrongful Termination",
  "Sexual Harassment at Work",
  "Severance Negotiations",
  "Commercial Collections",
  "Judgment Enforcement",
];

const LEGAL_TYPES = ["statute", "regulation", "agency", "case_law", "internal_page", "other"];
const AUTHORITY_LEVELS = ["primary", "secondary", "tertiary"];
const REVIEW_STATUSES = ["unverified", "verified", "needs_review", "archived"];

const input =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const label = "block text-xs font-semibold text-slate-700";

function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green";
}) {
  const tones: Record<string, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 ${tones[tone]}`}>{children}</span>
  );
}

export default function LegalLibrary() {
  const [rows, setRows] = useState<LegalSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<LegalSource> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content/research/legal", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setRows(json.sources ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!editing?.name || !editing?.url) {
      setError("Name and URL are required.");
      return;
    }
    setError(null);
    const res = await fetch("/api/content/research/legal", {
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
    if (!confirm("Delete this legal source?")) return;
    await fetch(`/api/content/research/legal?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {rows.length} source{rows.length === 1 ? "" : "s"}. Trusted statutes,
          regulations, agency guidance and case law — referenced for legal
          accuracy when research packets and content are generated.
        </p>
        <button
          onClick={() =>
            setEditing({
              source_type: "agency",
              authority_level: "primary",
              review_status: "unverified",
              topics: [],
            })
          }
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          + Add source
        </button>
      </div>

      {editing && (
        <div className="mb-5 rounded-lg border border-slate-300 bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label}>Name *</label>
              <input
                className={input}
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="EEOC — Filing a Charge of Discrimination"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>URL *</label>
              <input
                className={input}
                value={editing.url ?? ""}
                onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                placeholder="https://www.eeoc.gov/filing-charge-discrimination"
              />
            </div>
            <div>
              <label className={label}>Source type</label>
              <select
                className={input}
                value={editing.source_type ?? "agency"}
                onChange={(e) => setEditing({ ...editing, source_type: e.target.value })}
              >
                {LEGAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Authority level</label>
              <select
                className={input}
                value={editing.authority_level ?? "primary"}
                onChange={(e) => setEditing({ ...editing, authority_level: e.target.value })}
              >
                {AUTHORITY_LEVELS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Practice area</label>
              <select
                className={input}
                value={editing.practice_area ?? ""}
                onChange={(e) => setEditing({ ...editing, practice_area: e.target.value })}
              >
                {PRACTICE_AREAS.map((p) => (
                  <option key={p} value={p}>
                    {p || "(none)"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Jurisdiction</label>
              <input
                className={input}
                value={editing.jurisdiction ?? ""}
                onChange={(e) => setEditing({ ...editing, jurisdiction: e.target.value })}
                placeholder="federal, NY, NYC, NJ…"
              />
            </div>
            <div>
              <label className={label}>Topics (comma-separated)</label>
              <input
                className={input}
                value={(editing.topics ?? []).join(", ")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    topics: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="overtime, wage theft, FLSA"
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
            <div className="sm:col-span-2">
              <label className={label}>Notes</label>
              <textarea
                className={input}
                rows={2}
                value={editing.notes ?? ""}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
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
          No legal sources yet. Add EEOC, DOL, NY DOL, eCFR, Cornell LII, etc.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-slate-900 hover:underline"
                  >
                    {s.name}
                  </a>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    <Pill>{s.source_type}</Pill>
                    <Pill>{s.authority_level}</Pill>
                    {s.practice_area && <Pill>{s.practice_area}</Pill>}
                    {s.jurisdiction && <Pill>{s.jurisdiction}</Pill>}
                    <Pill tone={s.review_status === "verified" ? "green" : "slate"}>
                      {s.review_status}
                    </Pill>
                  </div>
                  {s.notes && <p className="mt-1 text-xs text-slate-600">{s.notes}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => setEditing(s)}
                    className="text-xs text-slate-600 hover:text-slate-900"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => del(s.id)}
                    className="text-xs text-red-700 hover:underline"
                  >
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
