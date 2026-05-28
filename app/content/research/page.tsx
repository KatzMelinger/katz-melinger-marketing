"use client";

/**
 * Research Libraries + Research Layer.
 *
 * Three tabs:
 *   - Legal Authority Library      (curated, CRUD)
 *   - People Ask & Trends Library  (curated + auto-captured, CRUD)
 *   - Research Packets             (Run Research Layer → packet → feeds KM Brief)
 *
 * The packet runner pulls matching legal sources + runs the live connectors
 * (Semrush, Search Console, Autocomplete, Reddit, YouTube), has Claude
 * synthesize FAQs/statutes/angles, and stores a packet you can hand to the
 * KM Brief Generator.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Tab = "legal" | "people" | "packets";

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

type PeopleAskSource = {
  id: string;
  content: string;
  source_type: string;
  practice_area: string | null;
  topic_tags: string[];
  use_case: string | null;
  trend_signal: string | null;
  source_url: string | null;
  review_status: string;
  updated_at: string;
};

type Packet = {
  id: string;
  topic: string;
  practice_area: string | null;
  primary_keyword: string | null;
  legal_sources_found: LegalSource[];
  people_ask_sources_found: { content: string; source_type: string; source_url?: string | null }[];
  suggested_faqs: { question: string; answer_hint: string }[];
  suggested_statutes: string[];
  suggested_angles: string[];
  source_confidence: "low" | "medium" | "high";
  legal_review_required: boolean;
  status: string;
  metadata: { connector_notes?: { source: string; count: number; note: string | null }[] };
  created_at: string;
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
const LIVE_SOURCES = [
  { id: "semrush", label: "Semrush questions" },
  { id: "search_console", label: "Search Console" },
  { id: "autocomplete", label: "Google Autocomplete" },
  { id: "reddit", label: "Reddit" },
  { id: "youtube", label: "YouTube" },
];

const input =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";
const label = "block text-xs font-semibold text-slate-700";

export default function ResearchPage() {
  const [tab, setTab] = useState<Tab>("legal");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Content / Research
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          Research Libraries
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Curate trusted legal sources and real audience questions, then run
          the Research Layer to assemble a packet that feeds the KM Brief
          Generator.
        </p>
      </header>

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {(
          [
            ["legal", "Legal Authority Library"],
            ["people", "People Ask & Trends"],
            ["packets", "Research Packets"],
          ] as [Tab, string][]
        ).map(([id, lbl]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === id
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === "legal" && <LegalLibrary />}
      {tab === "people" && <PeopleAskLibrary />}
      {tab === "packets" && <Packets />}
    </div>
  );
}

// ===========================================================================
// Legal Authority Library
// ===========================================================================
function LegalLibrary() {
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
          {rows.length} source{rows.length === 1 ? "" : "s"}. These are
          referenced for legal accuracy when packets are generated.
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

// ===========================================================================
// People Ask & Trends Library
// ===========================================================================
function PeopleAskLibrary() {
  const [rows, setRows] = useState<PeopleAskSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<PeopleAskSource> | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter ? `?sourceType=${filter}` : "";
      const res = await fetch(`/api/content/research/people-ask${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setRows(json.sources ?? []);
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!editing?.content) return;
    const res = await fetch("/api/content/research/people-ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    if (res.ok) {
      setEditing(null);
      load();
    }
  }
  async function del(id: string) {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/content/research/people-ask?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">{rows.length} entries</span>
          <select
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All sources</option>
            {["manual", "semrush", "search_console", "autocomplete", "reddit", "youtube", "paa"].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </div>
        <button
          onClick={() => setEditing({ source_type: "manual", topic_tags: [], review_status: "unverified" })}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          + Add question
        </button>
      </div>

      {editing && (
        <div className="mb-5 rounded-lg border border-slate-300 bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label}>Question / topic *</label>
              <input
                className={input}
                value={editing.content ?? ""}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                placeholder="How long do I have to file a wage claim in NY?"
              />
            </div>
            <div>
              <label className={label}>Source type</label>
              <select
                className={input}
                value={editing.source_type ?? "manual"}
                onChange={(e) => setEditing({ ...editing, source_type: e.target.value })}
              >
                {["manual", "paa", "autocomplete", "semrush", "search_console", "reddit", "youtube", "avvo", "justia", "quora", "competitor"].map(
                  (t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div>
              <label className={label}>Use case</label>
              <select
                className={input}
                value={editing.use_case ?? ""}
                onChange={(e) => setEditing({ ...editing, use_case: e.target.value })}
              >
                {["", "faq", "blog", "social", "newsletter", "aeo"].map((t) => (
                  <option key={t} value={t}>
                    {t || "(none)"}
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
              <label className={label}>Trend signal</label>
              <input
                className={input}
                value={editing.trend_signal ?? ""}
                onChange={(e) => setEditing({ ...editing, trend_signal: e.target.value })}
                placeholder="rising, steady, seasonal, spike"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Topic tags (comma-separated)</label>
              <input
                className={input}
                value={(editing.topic_tags ?? []).join(", ")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    topic_tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={save} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Save
            </button>
            <button onClick={() => setEditing(null)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No entries yet. Add questions manually or run the Research Layer to
          auto-capture them.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li key={s.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {s.source_url ? (
                    <a href={s.source_url} target="_blank" rel="noreferrer" className="text-sm text-slate-900 hover:underline">
                      {s.content}
                    </a>
                  ) : (
                    <span className="text-sm text-slate-900">{s.content}</span>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    <Pill>{s.source_type}</Pill>
                    {s.use_case && <Pill tone="violet">{s.use_case}</Pill>}
                    {s.practice_area && <Pill>{s.practice_area}</Pill>}
                    {s.trend_signal && <Pill tone="amber">{s.trend_signal}</Pill>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => setEditing(s)} className="text-xs text-slate-600 hover:text-slate-900">
                    Edit
                  </button>
                  <button onClick={() => del(s.id)} className="text-xs text-red-700 hover:underline">
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

// ===========================================================================
// Research Packets
// ===========================================================================
function Packets() {
  const [topic, setTopic] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [sources, setSources] = useState<string[]>(LIVE_SOURCES.map((s) => s.id));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [active, setActive] = useState<Packet | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/content/research/packet", { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setPackets(json.packets ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function run() {
    if (!topic.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/content/research/packet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          practiceArea: practiceArea || null,
          primaryKeyword: primaryKeyword || null,
          enabledSources: sources,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "failed");
      setActive(json.packet);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Run Research Layer</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label className={label}>Topic *</label>
              <input
                className={input}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="unpaid overtime in New York"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Practice area</label>
                <select className={input} value={practiceArea} onChange={(e) => setPracticeArea(e.target.value)}>
                  {PRACTICE_AREAS.map((p) => (
                    <option key={p} value={p}>
                      {p || "(none)"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Primary keyword</label>
                <input className={input} value={primaryKeyword} onChange={(e) => setPrimaryKeyword(e.target.value)} />
              </div>
            </div>
            <div>
              <label className={label}>Live sources</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {LIVE_SOURCES.map((s) => (
                  <label key={s.id} className="flex items-center gap-1 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={sources.includes(s.id)}
                      onChange={(e) =>
                        setSources((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                        )
                      }
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={run}
              disabled={running || !topic.trim()}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {running ? "Researching… (20-60s)" : "Run Research Layer"}
            </button>
            {error && <p className="text-sm text-red-700">{error}</p>}
          </div>
        </div>

        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Recent packets
          </h3>
          {packets.length === 0 ? (
            <p className="text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="space-y-1">
              {packets.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setActive(p)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                      active?.id === p.id
                        ? "border-slate-900 bg-slate-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className="font-medium text-slate-900">{p.topic}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {new Date(p.created_at).toLocaleDateString()} · {p.source_confidence}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>{active ? <PacketView packet={active} /> : <EmptyPacket />}</div>
    </div>
  );
}

function EmptyPacket() {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
      Run the Research Layer or pick a recent packet to view it here.
    </div>
  );
}

function PacketView({ packet }: { packet: Packet }) {
  const notes = packet.metadata?.connector_notes ?? [];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{packet.topic}</h2>
          <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
            {packet.practice_area && <Pill>{packet.practice_area}</Pill>}
            <Pill tone={packet.source_confidence === "high" ? "green" : packet.source_confidence === "medium" ? "amber" : "slate"}>
              confidence: {packet.source_confidence}
            </Pill>
            <Pill tone={packet.legal_review_required ? "red" : "green"}>
              {packet.legal_review_required ? "attorney review required" : "no legal review"}
            </Pill>
          </div>
        </div>
        <Link
          href={`/seo/generator?packetId=${packet.id}`}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          Use in KM Brief →
        </Link>
      </div>

      <Section title={`Legal sources found (${packet.legal_sources_found.length})`}>
        {packet.legal_sources_found.length === 0 ? (
          <p className="text-xs text-amber-700">
            None matched — flag for attorney sourcing before publishing.
          </p>
        ) : (
          <ul className="space-y-1">
            {packet.legal_sources_found.map((s) => (
              <li key={s.id} className="text-xs">
                <a href={s.url} target="_blank" rel="noreferrer" className="text-slate-800 hover:underline">
                  {s.name}
                </a>{" "}
                <span className="text-slate-400">({s.authority_level})</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Suggested FAQs (${packet.suggested_faqs.length})`}>
        <ul className="space-y-1.5">
          {packet.suggested_faqs.map((f, i) => (
            <li key={i} className="text-xs">
              <span className="font-medium text-slate-800">{f.question}</span>
              <span className="block text-slate-500">{f.answer_hint}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Statutes to cite / verify (${packet.suggested_statutes.length})`}>
        <ul className="list-disc pl-4 text-xs text-slate-700">
          {packet.suggested_statutes.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </Section>

      <Section title={`Content angles (${packet.suggested_angles.length})`}>
        <ul className="list-disc pl-4 text-xs text-slate-700">
          {packet.suggested_angles.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </Section>

      <Section title={`People-ask signals (${packet.people_ask_sources_found.length})`}>
        <ul className="space-y-1">
          {packet.people_ask_sources_found.slice(0, 25).map((p, i) => (
            <li key={i} className="text-xs">
              <Pill>{p.source_type}</Pill>{" "}
              {p.source_url ? (
                <a href={p.source_url} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline">
                  {p.content}
                </a>
              ) : (
                <span className="text-slate-700">{p.content}</span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {notes.length > 0 && (
        <Section title="Source run notes">
          <ul className="space-y-0.5 text-[11px] text-slate-500">
            {notes.map((n, i) => (
              <li key={i}>
                {n.source}: {n.count} items{n.note ? ` — ${n.note}` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "amber" | "red" | "violet";
}) {
  const tones: Record<string, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 ${tones[tone]}`}>{children}</span>
  );
}
