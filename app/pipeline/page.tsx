"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";

const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";

const STAGES = [
  "Lead",
  "Demo Scheduled",
  "Demo Completed",
  "Trial",
  "Proposal Sent",
  "Negotiating",
  "Closed Won",
  "Closed Lost",
] as const;

type Prospect = {
  id: string;
  firm_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  firm_size: number | null;
  current_tools: string | null;
  stage: string | null;
  estimated_mrr: number | null;
  source: string | null;
  trial_firm_id: string | null;
  trial_started: string | null;
  last_activity: string | null;
  notes: string | null;
  created_at: string;
};

type Activity = {
  id: string;
  prospect_id: string;
  type: string | null;
  notes: string | null;
  next_followup: string | null;
  staff_member: string | null;
  created_at: string;
};

function daysOpen(p: Prospect): number {
  const t = new Date(p.created_at).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function mockEngagementScore(trialFirmId: string | null): number | null {
  if (!trialFirmId) return null;
  let h = 0;
  for (let i = 0; i < trialFirmId.length; i++) {
    h = (h + trialFirmId.charCodeAt(i) * (i + 1)) % 997;
  }
  return 42 + (h % 55);
}

function fmtMrr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

export default function PipelinePage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Prospect | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [activityModal, setActivityModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    firm_name: "",
    contact_name: "",
    email: "",
    phone: "",
    firm_size: "",
    current_tools: "",
    estimated_mrr: "",
    source: "",
  });

  const [actForm, setActForm] = useState({
    type: "Call",
    notes: "",
    next_followup: "",
    staff_member: "Kenneth Katz",
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline/prospects");
      const j = await res.json();
      if (!res.ok) {
        setLoadErr(j.error ?? "Failed to load prospects");
        setProspects([]);
        return;
      }
      setLoadErr(null);
      setProspects(Array.isArray(j.prospects) ? j.prospects : []);
    } catch {
      setLoadErr("Network error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadActivities = useCallback(async (id: string) => {
    const res = await fetch(`/api/pipeline/activities?prospect_id=${encodeURIComponent(id)}`);
    const j = await res.json();
    if (res.ok) {
      setActivities(Array.isArray(j.activities) ? j.activities : []);
    }
  }, []);

  useEffect(() => {
    if (selected?.id) void loadActivities(selected.id);
    else setActivities([]);
  }, [selected, loadActivities]);

  const byStage = useMemo(() => {
    const m = new Map<string, Prospect[]>();
    for (const s of STAGES) m.set(s, []);
    for (const p of prospects) {
      const st = (p.stage ?? "Lead").trim();
      const bucket = STAGES.includes(st as (typeof STAGES)[number])
        ? st
        : "Lead";
      m.get(bucket)!.push(p);
    }
    return m;
  }, [prospects]);

  const pipelineValue = useMemo(() => {
    return prospects
      .filter((p) => !String(p.stage ?? "").toLowerCase().includes("lost"))
      .reduce((s, p) => s + (Number(p.estimated_mrr) || 0), 0);
  }, [prospects]);

  const stageCounts = useMemo(() => {
    const o: Record<string, number> = {};
    for (const s of STAGES) o[s] = 0;
    for (const p of prospects) {
      const st = (p.stage ?? "Lead").trim();
      const bucket = STAGES.includes(st as (typeof STAGES)[number])
        ? st
        : "Lead";
      o[bucket] = (o[bucket] ?? 0) + 1;
    }
    return o;
  }, [prospects]);

  async function updateStage(id: string, stage: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/pipeline/prospects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (res.ok) {
        await load();
        setSelected((prev) =>
          prev && prev.id === id ? { ...prev, stage } : prev,
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function submitProspect(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/pipeline/prospects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firm_name: form.firm_name,
          contact_name: form.contact_name || null,
          email: form.email || null,
          phone: form.phone || null,
          firm_size: form.firm_size || null,
          current_tools: form.current_tools || null,
          estimated_mrr: form.estimated_mrr || null,
          source: form.source || null,
        }),
      });
      if (res.ok) {
        setModalOpen(false);
        setForm({
          firm_name: "",
          contact_name: "",
          email: "",
          phone: "",
          firm_size: "",
          current_tools: "",
          estimated_mrr: "",
          source: "",
        });
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function submitActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch("/api/pipeline/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prospect_id: selected.id,
          type: actForm.type,
          notes: actForm.notes || null,
          next_followup: actForm.next_followup || null,
          staff_member: actForm.staff_member || null,
        }),
      });
      if (res.ok) {
        setActivityModal(false);
        setActForm((a) => ({ ...a, notes: "", next_followup: "" }));
        await loadActivities(selected.id);
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto flex max-w-[1600px] gap-4 px-4 py-8 lg:px-6">
        <div className="min-w-0 flex-1 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white">
                PracticeOS pipeline
              </h1>
              <p className="text-sm text-slate-400">
                B2B sales · law firm prospects
              </p>
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: ACCENT }}
            >
              Add prospect
            </button>
          </div>

          {loadErr ? (
            <div
              className="rounded-lg border border-rose-800/50 p-4 text-sm text-rose-100"
              style={{ backgroundColor: CARD }}
            >
              {loadErr} — run{" "}
              <code className="text-white">scripts/pipeline-schema.sql</code> in
              Supabase.
            </div>
          ) : null}

          <section
            className="rounded-xl border p-4"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-slate-400">Pipeline value (excl. lost)</p>
                <p className="text-xl font-semibold text-white">
                  {fmtMrr(pipelineValue)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Active prospects</p>
                <p className="text-xl font-semibold text-white">
                  {
                    prospects.filter(
                      (p) =>
                        !String(p.stage ?? "")
                          .toLowerCase()
                          .includes("lost"),
                    ).length
                  }
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Projected MRR (sum est.)</p>
                <p className="text-xl font-semibold text-[#185FA5]">
                  {fmtMrr(pipelineValue)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">By stage (sample)</p>
                <p className="text-sm text-slate-300">
                  Lead: {stageCounts["Lead"] ?? 0} · Trial:{" "}
                  {stageCounts["Trial"] ?? 0}
                </p>
              </div>
            </div>
          </section>

          <div className="flex gap-3 overflow-x-auto pb-2">
            {STAGES.map((stage) => (
              <div
                key={stage}
                className="min-w-[220px] max-w-[260px] flex-1 rounded-xl border p-3"
                style={{ backgroundColor: "#131d33", borderColor: BORDER }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {stage}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {byStage.get(stage)?.length ?? 0}
                  </span>
                </div>
                <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
                  {(byStage.get(stage) ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelected(p)}
                      className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                        selected?.id === p.id
                          ? "border-[#185FA5] bg-[#185FA5]/15"
                          : "border-[#2a3f5f] bg-[#1a2540] hover:border-slate-500"
                      }`}
                    >
                      <p className="font-semibold text-white">
                        {p.firm_name ?? "—"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {p.contact_name ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-[#185FA5]">
                        {fmtMrr(p.estimated_mrr)} · {daysOpen(p)}d open
                      </p>
                      {p.source ? (
                        <p className="mt-1 text-[10px] text-slate-500">
                          {p.source}
                        </p>
                      ) : null}
                      <select
                        className="mt-2 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-2 py-1 text-xs text-white"
                        value={p.stage ?? "Lead"}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          void updateStage(p.id, e.target.value);
                        }}
                        disabled={saving}
                      >
                        {STAGES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {selected ? (
          <aside
            className="hidden w-[340px] shrink-0 rounded-xl border p-4 lg:block"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">
                {selected.firm_name}
              </h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-slate-400 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <dl className="space-y-2 text-sm text-slate-300">
              <div>
                <dt className="text-xs text-slate-500">Contact</dt>
                <dd>{selected.contact_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Email / phone</dt>
                <dd>
                  {selected.email ?? "—"} · {selected.phone ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Firm size / tools</dt>
                <dd>
                  {selected.firm_size ?? "—"} attorneys ·{" "}
                  {selected.current_tools ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Source</dt>
                <dd>{selected.source ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Notes</dt>
                <dd className="whitespace-pre-wrap text-slate-200">
                  {selected.notes ?? "—"}
                </dd>
              </div>
            </dl>
            {mockEngagementScore(selected.trial_firm_id) != null ? (
              <div
                className="mt-4 rounded-lg border border-emerald-500/30 p-3"
                style={{ backgroundColor: "#0f1729" }}
              >
                <p className="text-xs font-semibold text-emerald-300">
                  Engagement score (preview)
                </p>
                <p className="text-2xl font-bold text-emerald-200">
                  {mockEngagementScore(selected.trial_firm_id)}
                </p>
                <p className="text-[10px] text-slate-500">
                  Mock score until CMS trial usage is wired.
                </p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setActivityModal(true)}
              className="mt-4 w-full rounded-lg py-2 text-sm font-medium text-white"
              style={{ backgroundColor: ACCENT }}
            >
              Add activity
            </button>
            <h3 className="mt-6 text-sm font-semibold text-white">
              Activity log
            </h3>
            <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs text-slate-400">
              {activities.map((a) => (
                <li
                  key={a.id}
                  className="rounded border border-[#2a3f5f] p-2"
                  style={{ backgroundColor: "#0f1729" }}
                >
                  <span className="font-medium text-[#185FA5]">{a.type}</span> ·{" "}
                  {new Date(a.created_at).toLocaleString()}
                  {a.notes ? (
                    <p className="mt-1 text-slate-300">{a.notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        {modalOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            role="dialog"
            aria-modal
            onClick={() => setModalOpen(false)}
          >
            <form
              onSubmit={submitProspect}
              className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-white">New prospect</h3>
              <div className="mt-4 space-y-3 text-sm">
                {(
                  [
                    ["firm_name", "Firm name *"],
                    ["contact_name", "Contact name"],
                    ["email", "Email"],
                    ["phone", "Phone"],
                    ["firm_size", "Firm size (# attorneys)"],
                    ["current_tools", "Current tools they use"],
                    ["estimated_mrr", "Estimated MRR ($)"],
                    ["source", "How you know them"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="text-xs text-slate-400">{label}</span>
                    <input
                      className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                      value={form[key]}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [key]: e.target.value }))
                      }
                      required={key === "firm_name"}
                    />
                  </label>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-[#2a3f5f] px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: ACCENT }}
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {activityModal && selected ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setActivityModal(false)}
            role="presentation"
          >
            <form
              onSubmit={submitActivity}
              className="w-full max-w-md rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-white">Add activity</h3>
              <label className="mt-4 block text-sm">
                <span className="text-xs text-slate-400">Type</span>
                <select
                  className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                  value={actForm.type}
                  onChange={(e) =>
                    setActForm((a) => ({ ...a, type: e.target.value }))
                  }
                >
                  {["Call", "Email", "Demo", "Follow-up"].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-sm">
                <span className="text-xs text-slate-400">Notes</span>
                <textarea
                  className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                  rows={3}
                  value={actForm.notes}
                  onChange={(e) =>
                    setActForm((a) => ({ ...a, notes: e.target.value }))
                  }
                />
              </label>
              <label className="mt-3 block text-sm">
                <span className="text-xs text-slate-400">Next follow-up</span>
                <input
                  type="date"
                  className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                  value={actForm.next_followup}
                  onChange={(e) =>
                    setActForm((a) => ({ ...a, next_followup: e.target.value }))
                  }
                />
              </label>
              <label className="mt-3 block text-sm">
                <span className="text-xs text-slate-400">Staff</span>
                <input
                  className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                  value={actForm.staff_member}
                  onChange={(e) =>
                    setActForm((a) => ({ ...a, staff_member: e.target.value }))
                  }
                />
              </label>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActivityModal(false)}
                  className="rounded-lg border border-[#2a3f5f] px-4 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: ACCENT }}
                >
                  Save activity
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </main>
    </div>
  );
}
