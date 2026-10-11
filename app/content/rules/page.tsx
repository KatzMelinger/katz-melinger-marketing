"use client";

/**
 * Rules — upgrade the rules without new code (Oct 6 spec, Task 24).
 *
 * Brand constants and knowledge base entries are edited here; traps are edited
 * on Known traps. Every change is in History with Restore. Knowledge base
 * changes wait for a reviewing attorney before any draft uses them (Kenneth,
 * 2026-10-06, decision D); brand constants apply when saved.
 */

import { useCallback, useEffect, useState } from "react";

import { ContentNav } from "@/components/content-nav";
import { DashButton, DashCard, DashInput, DashPill, DashSelect, DashSpinner } from "@/components/dashboard-ui";
import { RescanDrafts } from "@/components/rescan-drafts";
import type { KbRow, RuleChange } from "@/lib/rule-changes";

type KbEntry = KbRow & { needsVerify: boolean };
type Brief = Record<string, string | string[]>;

const UNIT_LABEL: Record<string, string> = {
  usd_per_hour: "$ per hour",
  usd_per_week: "$ per week",
  usd_per_year: "$ per year",
  days: "days",
  years: "years",
  employees: "employees (1 = all employers)",
};

/** The brand constants (Task 1), with the operating-brief field that shows the value in use. */
const BRAND_FIELDS: { key: string; label: string; brief: string; hint?: string }[] = [
  { key: "webPhone", label: "Website phone (CTA)", brief: "webPhone" },
  { key: "documentPhone", label: "Phone in documents", brief: "documentPhone" },
  { key: "socialPhone", label: "Social phone", brief: "socialPhone" },
  { key: "socialOfferPhrase", label: "Offer phrase", brief: "offerPhrase", hint: "A phrase, not a sentence: no phone number, no full stop." },
  { key: "socialOfferPhraseEs", label: "Offer phrase (Spanish)", brief: "offerPhraseEs" },
  { key: "socialHashtagRule", label: "Hashtag rule", brief: "hashtagRule" },
  { key: "socialDisclaimerUrl", label: "Disclaimer URL", brief: "disclaimerUrl" },
  { key: "neverInContentPhones", label: "Phones never in content", brief: "neverInContentPhones", hint: "Comma separated." },
  { key: "approvedPeople", label: "Approved people", brief: "approvedPeople", hint: "Comma separated." },
];

function kbValue(r: KbRow): string {
  if (r.entry_type === "named_act") return r.canonical_citation ?? "named act";
  const v = r.current_value;
  if (v == null) return "-";
  return r.unit?.startsWith("usd") ? `$${Number(v).toFixed(2)}` : String(v);
}

function short(v: unknown): string {
  if (v === null || v === undefined) return "(none)";
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 117)}...` : v || "(empty)";
  const o = v as Record<string, unknown>;
  if ("entry_type" in o) {
    const r = o as unknown as KbRow;
    const parts = [kbValue(r), r.effective_date ? `from ${r.effective_date}` : null];
    if (r.scheduled_value != null) parts.push(`then ${r.unit?.startsWith("usd") ? "$" : ""}${r.scheduled_value} from ${r.scheduled_effective_date}`);
    return parts.filter(Boolean).join(", ");
  }
  if ("pattern" in o) return `${o.enabled === false ? "(disabled) " : ""}${String(o.severity)}: ${String(o.pattern).slice(0, 90)}`;
  if ("last_verified" in o) return `verified ${o.last_verified ?? "never"}`;
  return JSON.stringify(v).slice(0, 120);
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

export default function RulesPage() {
  const [kb, setKb] = useState<KbEntry[]>([]);
  const [history, setHistory] = useState<RuleChange[]>([]);
  const [brief, setBrief] = useState<Brief>({});
  const [stored, setStored] = useState<Record<string, string>>({});
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<KbEntry | "new" | null>(null);
  const [kbFilter, setKbFilter] = useState("");
  const [showRescan, setShowRescan] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        fetch("/api/rules", { cache: "no-store" }),
        fetch("/api/brand-voice/settings", { cache: "no-store" }),
      ]);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? "Couldn't load the rules.");
      setKb(data.kb ?? []);
      setHistory(data.history ?? []);
      setBrief(data.brief ?? {});
      setCanApprove(!!data.canApprove);
      const sd = await s.json().catch(() => ({}));
      setStored(sd.settings ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    setError(null);
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error ?? "That didn't work.");
      return null;
    }
    return data;
  };

  const decide = async (c: RuleChange, action: "approve" | "reject") => {
    const note = action === "reject" ? window.prompt("Why is it rejected? (optional)") ?? "" : "";
    if (await post({ action, id: c.id, note })) {
      setNotice(action === "approve" ? `Approved: ${c.rule_label}. Drafts use it from now on.` : `Rejected: ${c.rule_label}.`);
      if (action === "approve") setShowRescan(true);
      await load();
    }
  };

  const restore = async (c: RuleChange) => {
    if (!window.confirm(`Restore the earlier value of "${c.rule_label}"?\n\n${short(c.old_value)}`)) return;
    const out = await post({ action: "restore", id: c.id });
    if (out) {
      setNotice(
        out.pending
          ? `Restore of ${c.rule_label} sent to the reviewing attorney. It applies once approved.`
          : `Restored: ${c.rule_label}.`,
      );
      if (!out.pending) setShowRescan(true);
      await load();
    }
  };

  const verify = async (r: KbEntry) => {
    if (await post({ action: "verify", entryType: r.entry_type, key: r.key })) {
      setNotice(`${r.label}: marked verified today.`);
      await load();
    }
  };

  const pending = history.filter((h) => h.status === "pending");
  const verifyCount = kb.filter((r) => r.needsVerify).length;
  const shownKb = kb.filter((r) =>
    !kbFilter.trim() ? true : `${r.label} ${r.key} ${r.jurisdiction}`.toLowerCase().includes(kbFilter.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Content / Rules</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Rules</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          The facts and brand constants every draft is checked and corrected against. Change them here, without a
          code change. Knowledge base changes apply once a reviewing attorney approves them. Traps are on{" "}
          <a href="/content/traps" className="text-brand underline">Known traps</a>.
        </p>
      </div>

      <ContentNav />

      {error && (
        <DashCard className="mb-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-800">{error}</p>
        </DashCard>
      )}
      {notice && (
        <DashCard className="mb-4 border-emerald-200 bg-emerald-50">
          <p className="text-sm text-emerald-900">{notice}</p>
        </DashCard>
      )}
      {showRescan && (
        <div className="mb-4">
          <RescanDrafts prompt="A rule changed. Rescan so every open draft is corrected against it." />
        </div>
      )}

      {loading && !kb.length ? (
        <DashCard className="py-10 text-center text-sm text-slate-500">
          <DashSpinner /> Loading rules…
        </DashCard>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900">Waiting for attorney approval ({pending.length})</h2>
              <DashCard className="divide-y divide-slate-100 p-0">
                {pending.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{c.rule_label}</div>
                      <div className="text-xs text-slate-600">
                        Now: {short(c.old_value)}
                        <br />
                        Proposed: <span className="font-medium text-slate-900">{short(c.new_value)}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {c.action === "restore" ? "Restore" : "Proposed"} by {c.changed_by_email ?? "unknown"}, {when(c.changed_at)}
                        {c.reviewer_email ? ` · reviewer ${c.reviewer_email}` : ""}
                        {(c.new_value as KbRow | null)?.source_url && (
                          <>
                            {" · "}
                            <a href={(c.new_value as KbRow).source_url!} target="_blank" rel="noreferrer" className="text-brand underline">
                              source
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                    {canApprove ? (
                      <div className="flex shrink-0 gap-2">
                        <DashButton onClick={() => void decide(c, "approve")}>Approve</DashButton>
                        <DashButton variant="outline" onClick={() => void decide(c, "reject")}>Reject</DashButton>
                      </div>
                    ) : (
                      <DashPill tone="amber">waiting for an attorney</DashPill>
                    )}
                  </div>
                ))}
              </DashCard>
            </section>
          )}

          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">
                Knowledge base{" "}
                {verifyCount > 0 && <DashPill tone="amber">{verifyCount} to verify</DashPill>}
              </h2>
              <div className="flex gap-2">
                <DashInput placeholder="Filter" value={kbFilter} onChange={(e) => setKbFilter(e.target.value)} className="w-48" />
                <DashButton variant="outline" onClick={() => setEditing("new")}>Add entry</DashButton>
              </div>
            </div>

            {editing && (
              <div className="mb-3">
                <KbForm
                  key={editing === "new" ? "new" : `${editing.entry_type}:${editing.key}`}
                  initial={editing === "new" ? null : editing}
                  onCancel={() => setEditing(null)}
                  onSent={async (label) => {
                    setEditing(null);
                    setNotice(`Sent for attorney approval: ${label}. Drafts use it once it is approved.`);
                    await load();
                  }}
                />
              </div>
            )}

            <DashCard className="overflow-x-auto p-0">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Entry</th>
                    <th className="px-3 py-2 font-medium">Value</th>
                    <th className="px-3 py-2 font-medium">Effective</th>
                    <th className="px-3 py-2 font-medium">Upcoming</th>
                    <th className="px-3 py-2 font-medium">Verified</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shownKb.map((r) => (
                    <tr key={`${r.entry_type}:${r.key}`} className="align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{r.label}</div>
                        <div className="text-[11px] text-slate-500">
                          {r.jurisdiction}
                          {r.region ? ` · ${r.region}` : ""} · {r.key}
                          {r.source_url && (
                            <>
                              {" · "}
                              <a href={r.source_url} target="_blank" rel="noreferrer" className="text-brand underline">
                                source
                              </a>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {kbValue(r)}
                        {r.unit && r.entry_type === "threshold" && !r.unit.startsWith("usd") ? ` ${r.unit}` : ""}
                        {r.unit?.startsWith("usd") ? <span className="text-slate-500"> /{r.unit.replace("usd_per_", "")}</span> : null}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.effective_date ?? "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.scheduled_value != null
                          ? `${r.unit?.startsWith("usd") ? `$${Number(r.scheduled_value).toFixed(2)}` : r.scheduled_value} from ${r.scheduled_effective_date}`
                          : "-"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.needsVerify ? <DashPill tone="amber">Verify</DashPill> : <span className="text-slate-600">{r.last_verified}</span>}
                        {r.needsVerify && r.last_verified && <div className="text-[10px] text-slate-500">last {r.last_verified}</div>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button type="button" className="text-brand underline hover:opacity-80" onClick={() => setEditing(r)}>
                          Edit
                        </button>
                        {canApprove && r.needsVerify && (
                          <button type="button" className="ml-3 text-slate-600 underline hover:opacity-80" onClick={() => void verify(r)}>
                            Mark verified
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {shownKb.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                        No entries{kbFilter ? " match the filter" : ""}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </DashCard>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Brand constants</h2>
            <BrandConstants
              stored={stored}
              brief={brief}
              onSaved={async (key) => {
                setNotice(`Saved: ${key}. Drafts use it from now on.`);
                setShowRescan(true);
                await load();
              }}
              onError={setError}
            />
          </section>

          {!showRescan && (
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900">Rescan</h2>
              <RescanDrafts />
            </section>
          )}

          <section>
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Rule history</h2>
            <DashCard className="overflow-x-auto p-0">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Rule</th>
                    <th className="px-3 py-2 font-medium">Change</th>
                    <th className="px-3 py-2 font-medium">Who</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((c) => (
                    <tr key={c.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{when(c.changed_at)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{c.rule_label}</div>
                        <div className="text-[11px] text-slate-500">
                          {c.rule_kind === "kb" ? "knowledge base" : c.rule_kind} · {c.action}
                          {c.status !== "applied" && (
                            <>
                              {" "}
                              <DashPill tone={c.status === "pending" ? "amber" : "red"}>{c.status}</DashPill>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        <div className="text-slate-500 line-through">{short(c.old_value)}</div>
                        <div>{short(c.new_value)}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.changed_by_email ?? "-"}
                        {c.decided_by_email && (
                          <div className="text-[11px] text-slate-500">
                            {c.status === "applied" ? "approved" : "rejected"} by {c.decided_by_email}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {c.status === "applied" && c.action !== "verify" && c.old_value != null && (
                          <button type="button" className="text-brand underline hover:opacity-80" onClick={() => void restore(c)}>
                            Restore
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                        No changes recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </DashCard>
          </section>
        </div>
      )}
    </div>
  );
}

function BrandConstants({
  stored,
  brief,
  onSaved,
  onError,
}: {
  stored: Record<string, string>;
  brief: Brief;
  onSaved: (key: string) => Promise<void>;
  onError: (e: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const save = async (key: string) => {
    setSaving(key);
    try {
      const res = await fetch("/api/brand-voice/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { [key]: values[key] ?? "" } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) onError(data?.error ?? "Save failed.");
      else {
        setValues((v) => {
          const next = { ...v };
          delete next[key];
          return next;
        });
        await onSaved(key);
      }
    } finally {
      setSaving(null);
    }
  };

  return (
    <DashCard className="divide-y divide-slate-100 p-0">
      {BRAND_FIELDS.map((f) => {
        const inUse = brief[f.brief];
        const inUseText = Array.isArray(inUse) ? inUse.join(", ") : inUse ?? "";
        const value = values[f.key] ?? stored[f.key] ?? "";
        const dirty = f.key in values && values[f.key] !== (stored[f.key] ?? "");
        return (
          <div key={f.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[14rem_1fr_auto] sm:items-center">
            <div>
              <div className="text-sm font-medium text-slate-900">{f.label}</div>
              {f.hint && <div className="text-[11px] text-slate-500">{f.hint}</div>}
            </div>
            <div>
              <DashInput
                className="w-full"
                value={value}
                placeholder={inUseText}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
              <div className="mt-0.5 text-[11px] text-slate-500">In use: {inUseText || "-"}</div>
            </div>
            <DashButton variant="outline" onClick={() => void save(f.key)} disabled={!dirty || saving === f.key}>
              {saving === f.key ? <DashSpinner /> : "Save"}
            </DashButton>
          </div>
        );
      })}
    </DashCard>
  );
}

function KbForm({
  initial,
  onCancel,
  onSent,
}: {
  initial: KbRow | null;
  onCancel: () => void;
  onSent: (label: string) => Promise<void>;
}) {
  const scheduled = initial?.scheduled_value != null;
  const [f, setF] = useState({
    entry_type: initial?.entry_type ?? "threshold",
    key: initial?.key ?? "",
    label: initial?.label ?? "",
    practice_area: initial?.practice_area ?? "employment",
    jurisdiction: initial?.jurisdiction ?? "NJ",
    region: initial?.region ?? "",
    unit: initial?.unit ?? "usd_per_hour",
    value: initial?.current_value != null ? String(initial.current_value) : "",
    effective_date: initial?.effective_date ?? "",
    match_keywords: (initial?.match_keywords ?? []).join("\n"),
    aliases: (initial?.aliases ?? []).join("\n"),
    canonical_citation: initial?.canonical_citation ?? "",
    enforcement_path: initial?.enforcement_path ?? "",
    source_url: initial?.source_url ?? "",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const threshold = f.entry_type === "threshold";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const future = !!f.effective_date && f.effective_date > today;

  const send = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "propose_kb", entry: { ...f, original_key: initial?.key ?? null } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data?.error ?? "Couldn't send it.");
      else await onSent(f.label);
    } finally {
      setSaving(false);
    }
  };

  const field = "block text-xs font-medium text-slate-700";
  return (
    <DashCard className="space-y-3 border-brand/30">
      <h3 className="text-base font-semibold text-slate-900">{initial ? `Edit: ${initial.label}` : "Add knowledge base entry"}</h3>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className={field}>
          Type
          <DashSelect className="mt-1 w-full" value={f.entry_type} disabled={!!initial} onChange={(e) => set("entry_type", e.target.value)}>
            <option value="threshold">Figure (wage, deadline, employee count)</option>
            <option value="named_act">Named law</option>
          </DashSelect>
        </label>
        <label className={field}>
          Jurisdiction
          <DashSelect className="mt-1 w-full" value={f.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value)}>
            <option value="NJ">New Jersey</option>
            <option value="NY">New York</option>
            <option value="federal">Federal</option>
          </DashSelect>
        </label>
        <label className={field}>
          Key
          <DashInput className="mt-1 w-full" value={f.key} disabled={!!initial} onChange={(e) => set("key", e.target.value)} placeholder="nj_min_wage" />
        </label>
        <label className={field}>
          Practice area
          <DashSelect className="mt-1 w-full" value={f.practice_area} onChange={(e) => set("practice_area", e.target.value)}>
            <option value="employment">Employment</option>
            <option value="commercial_collections">Commercial collections</option>
            <option value="judgment_enforcement">Judgment enforcement</option>
          </DashSelect>
        </label>
      </div>
      <label className={field}>
        Label
        <DashInput className="mt-1 w-full" value={f.label} onChange={(e) => set("label", e.target.value)} placeholder="NJ minimum wage - most employers" />
      </label>

      {threshold ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className={field}>
              Value
              <DashInput className="mt-1 w-full" value={f.value} onChange={(e) => set("value", e.target.value)} placeholder="16.48" />
            </label>
            <label className={field}>
              Unit
              <DashSelect className="mt-1 w-full" value={f.unit} onChange={(e) => set("unit", e.target.value)}>
                {Object.entries(UNIT_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </DashSelect>
            </label>
            <label className={field}>
              Effective date
              <DashInput type="date" className="mt-1 w-full" value={f.effective_date} onChange={(e) => set("effective_date", e.target.value)} />
            </label>
            <label className={field}>
              Region (optional)
              <DashSelect className="mt-1 w-full" value={f.region} onChange={(e) => set("region", e.target.value)}>
                <option value="">Whole jurisdiction</option>
                <option value="downstate">NYC, Long Island, Westchester</option>
                <option value="remainder_of_state">Rest of New York State</option>
              </DashSelect>
            </label>
          </div>
          {future && initial?.current_value != null && (
            <p className="text-xs text-blue-800">
              Future date: the current figure ({kbValue(initial)}) stays in force until {f.effective_date}, then this one
              takes over automatically. Drafts that state a different figure for {f.effective_date.slice(0, 4)} are corrected.
            </p>
          )}
          {scheduled && !future && (
            <p className="text-xs text-slate-600">
              Upcoming: {initial!.scheduled_value} from {initial!.scheduled_effective_date}. To change it, enter its value and date.
            </p>
          )}
          <label className={field}>
            Sentence must contain (one group per line, alternatives separated by |)
            <textarea className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs" rows={2}
              value={f.match_keywords} onChange={(e) => set("match_keywords", e.target.value)}
              placeholder={"NYSHRL|Division of Human Rights\ndeadline|file|within"} />
            <span className="mt-0.5 block text-[10px] font-normal text-slate-500">
              Needed for deadlines and employee counts; leave empty for a wage figure.
            </span>
          </label>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={field}>
            Citation
            <DashInput className="mt-1 w-full" value={f.canonical_citation} onChange={(e) => set("canonical_citation", e.target.value)} />
          </label>
          <label className={field}>
            Other names (one per line)
            <textarea className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs" rows={2}
              value={f.aliases} onChange={(e) => set("aliases", e.target.value)} />
          </label>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          Source URL (required)
          <DashInput className="mt-1 w-full" value={f.source_url} onChange={(e) => set("source_url", e.target.value)} placeholder="https://www.nj.gov/labor/..." />
        </label>
        <label className={field}>
          Where to enforce (optional)
          <DashInput className="mt-1 w-full" value={f.enforcement_path} onChange={(e) => set("enforcement_path", e.target.value)} />
        </label>
      </div>
      <label className={field}>
        Notes
        <textarea className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs" rows={2}
          value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>

      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex items-center gap-2">
        <DashButton onClick={send} disabled={saving}>{saving ? <DashSpinner /> : "Send for attorney approval"}</DashButton>
        <DashButton variant="ghost" onClick={onCancel}>Cancel</DashButton>
        <span className="text-[11px] text-slate-500">Drafts use the change once a reviewing attorney approves it.</span>
      </div>
    </DashCard>
  );
}
