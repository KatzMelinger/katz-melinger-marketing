"use client";

/**
 * /seo/suggestions — Strategy Engine queue.
 *
 * Each pending suggestion shows what the engine recommends + the
 * auto-filled brief snapshot. Diana approves / rejects / holds each one.
 * Approve sends her to /seo/generator?suggestion={id} with the brief
 * already populated; she can still revise before clicking Generate.
 *
 * Pre-Strategy Engine, the page also lets her create a one-off suggestion
 * by pasting a primary keyword.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { SeoShell } from "@/components/seo-shell";
import { KM_CONTENT_TYPE_LABELS, type KMPracticeArea } from "@/lib/km-content-system";

type Suggestion = {
  id: string;
  cluster_name: string;
  primary_keyword: string;
  secondary_keywords: string[];
  content_type: string;
  practice_area: KMPracticeArea;
  pillar_id: string;
  search_intent: string;
  recommended_action: string;
  priority: "high" | "medium" | "low";
  reasoning: string | null;
  decision_source: string;
  suggested_brief: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
  cannibalization_risk: string | null;
  existing_url: string | null;
  status: "pending" | "approved" | "rejected" | "held";
  decision_notes: string | null;
  decided_at: string | null;
  created_at: string;
};

const STATUS_TABS: { key: Suggestion["status"]; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "held", label: "On hold" },
  { key: "rejected", label: "Rejected" },
];

const ACTION_LABELS: Record<string, string> = {
  new_page: "Create new page",
  support_blog: "Write support blog",
  page_refresh: "Refresh existing page",
  faq: "Add to FAQ",
  internal_link: "Internal link only",
  hold: "Hold — monitor",
  remove: "Remove",
};

export default function SuggestionsPage() {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Suggestion["status"]>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/seo/suggestions?status=${status}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleDecision = async (
    id: string,
    next: Suggestion["status"],
    notes?: string,
  ) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/seo/suggestions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next, decisionNotes: notes ?? null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => ({ shown: items.length }), [items]);

  return (
    <SeoShell
      title="Content suggestions"
      subtitle="Strategy Engine output. Approve to send to the Brief Generator (pre-filled, still editable). Reject or hold otherwise."
    >
      <NewSuggestionForm onCreated={() => status === "pending" && load()} />

      <div className="flex flex-wrap gap-2 mt-4">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`text-xs px-3 py-1.5 rounded-md border ${
              status === t.key
                ? "border-[#185FA5] bg-[#185FA5]/10 text-[#185FA5] font-medium"
                : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="text-xs text-slate-400 ml-auto self-center">{counts.shown} showing</span>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 p-3 rounded-md">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500 py-6 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-md p-10 text-center text-sm text-slate-500">
          No {status} suggestions.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              busy={busyId === s.id}
              onApprove={() => handleDecision(s.id, "approved")}
              onReject={() => {
                const notes = prompt("Why reject? (optional)") ?? undefined;
                handleDecision(s.id, "rejected", notes);
              }}
              onHold={() => {
                const notes = prompt("Why hold? (optional)") ?? undefined;
                handleDecision(s.id, "held", notes);
              }}
            />
          ))}
        </div>
      )}
    </SeoShell>
  );
}

// ---------- Card -----------------------------------------------------------

function SuggestionCard({
  suggestion: s,
  busy,
  onApprove,
  onReject,
  onHold,
}: {
  suggestion: Suggestion;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onHold: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const brief = s.suggested_brief as Record<string, unknown>;
  const metrics = s.metrics ?? {};

  const priorityClass =
    s.priority === "high"
      ? "bg-red-50 text-red-700 border-red-200"
      : s.priority === "medium"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-slate-50 text-slate-600 border-slate-200";

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{s.cluster_name}</h3>
            <span className={`text-[10px] uppercase px-2 py-0.5 rounded-md border ${priorityClass}`}>
              {s.priority}
            </span>
            <span className="text-[10px] uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
              {KM_CONTENT_TYPE_LABELS[s.content_type as keyof typeof KM_CONTENT_TYPE_LABELS] ??
                s.content_type}
            </span>
            <span className="text-[10px] uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
              {s.practice_area}
            </span>
            <span className="text-[10px] uppercase px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
              {ACTION_LABELS[s.recommended_action] ?? s.recommended_action}
            </span>
            {s.cannibalization_risk && s.cannibalization_risk !== "none" && s.cannibalization_risk !== "unknown" && (
              <span
                className={`text-[10px] uppercase px-2 py-0.5 rounded-md border ${
                  s.cannibalization_risk === "high"
                    ? "bg-red-50 text-red-700 border-red-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}
              >
                {s.cannibalization_risk} cannibalization
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Primary keyword: <span className="text-slate-800">{s.primary_keyword}</span>
            {typeof metrics.volume === "number" && (
              <> · Volume <span className="text-slate-800">{metrics.volume}</span></>
            )}
            {typeof metrics.kd === "number" && (
              <> · KD <span className="text-slate-800">{metrics.kd}</span></>
            )}
            {typeof metrics.currentRank === "number" && (
              <> · Rank <span className="text-slate-800">{metrics.currentRank}</span></>
            )}
            <> · Source: {s.decision_source}</>
          </div>
          {s.reasoning && (
            <p className="text-xs text-slate-600 mt-2">{s.reasoning}</p>
          )}
        </div>

        {s.status === "pending" && (
          <div className="flex flex-col gap-2 shrink-0">
            <Link
              href={`/seo/generator?suggestion=${s.id}`}
              onClick={onApprove}
              className="text-xs px-3 py-1.5 rounded-md bg-[#185FA5] text-white hover:bg-[#0f4d8c] text-center"
            >
              Approve → Generate
            </Link>
            <button
              type="button"
              onClick={onHold}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Hold for later
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50"
            >
              Reject
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs text-[#185FA5] hover:underline"
      >
        {expanded ? "Hide" : "Show"} auto-filled brief
      </button>

      {expanded && (
        <div className="bg-slate-50 rounded-md p-3 text-xs space-y-1">
          <BriefRow label="H1" value={brief.h1} />
          <BriefRow label="URL slug" value={brief.urlSlug} />
          <BriefRow label="Meta title" value={brief.metaTitle} />
          <BriefRow label="Meta description" value={brief.metaDescription} />
          <BriefRow label="Search intent" value={brief.searchIntent} />
          <BriefRow label="Pillar" value={brief.pillarId} />
          <BriefRow label="Internal pillar link" value={brief.internalPillarLink} />
          {Array.isArray(brief.secondaryKeywords) && (brief.secondaryKeywords as unknown[]).length > 0 && (
            <BriefRow
              label="Secondary keywords"
              value={(brief.secondaryKeywords as string[]).join(", ")}
            />
          )}
          {Boolean(brief.specialInstructions) && (
            <BriefRow label="Notes" value={brief.specialInstructions} />
          )}
        </div>
      )}

      {s.decision_notes && (
        <p className="text-xs italic text-slate-500">
          Decision notes: {s.decision_notes}
        </p>
      )}
    </div>
  );
}

function BriefRow({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-800 break-words">{String(value)}</span>
    </div>
  );
}

// ---------- New suggestion form -------------------------------------------

function NewSuggestionForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    clusterName: "",
    primaryKeyword: "",
    secondaryKeywords: "",
    volume: "",
    kd: "",
    intent: "",
    currentRank: "",
    existingUrl: "",
    practiceAreaHint: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!draft.primaryKeyword.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const payload = {
        clusterName: draft.clusterName.trim() || draft.primaryKeyword.trim(),
        primaryKeyword: draft.primaryKeyword.trim(),
        secondaryKeywords: draft.secondaryKeywords
          .split(/\n|,/)
          .map((s) => s.trim())
          .filter(Boolean),
        volume: draft.volume ? Number(draft.volume) : null,
        kd: draft.kd ? Number(draft.kd) : null,
        currentRank: draft.currentRank ? Number(draft.currentRank) : null,
        intent: draft.intent || null,
        existingUrl: draft.existingUrl.trim() || null,
        practiceAreaHint: draft.practiceAreaHint || null,
        source: "manual",
      };
      const res = await fetch("/api/seo/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed");
      setDraft({
        clusterName: "",
        primaryKeyword: "",
        secondaryKeywords: "",
        volume: "",
        kd: "",
        intent: "",
        currentRank: "",
        existingUrl: "",
        practiceAreaHint: "",
      });
      setOpen(false);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Strategy Engine evaluates each cluster, picks content type and pillar,
          and pre-fills the brief. You triage from here.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs px-3 py-1.5 rounded-md bg-[#185FA5] text-white hover:bg-[#0f4d8c]"
        >
          + New suggestion
        </button>
      </div>
    );
  }

  const input = "bg-white border border-slate-200 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 w-full";

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">New suggestion from cluster</h3>
        <button onClick={() => setOpen(false)} className="text-slate-400">×</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          className={input}
          placeholder="Cluster name (optional)"
          value={draft.clusterName}
          onChange={(e) => setDraft({ ...draft, clusterName: e.target.value })}
        />
        <input
          className={input}
          placeholder="Primary keyword *"
          value={draft.primaryKeyword}
          onChange={(e) => setDraft({ ...draft, primaryKeyword: e.target.value })}
        />
        <input
          className={input}
          placeholder="Monthly volume"
          inputMode="numeric"
          value={draft.volume}
          onChange={(e) => setDraft({ ...draft, volume: e.target.value })}
        />
        <input
          className={input}
          placeholder="Keyword difficulty (0–100)"
          inputMode="numeric"
          value={draft.kd}
          onChange={(e) => setDraft({ ...draft, kd: e.target.value })}
        />
        <select
          className={input}
          value={draft.intent}
          onChange={(e) => setDraft({ ...draft, intent: e.target.value })}
        >
          <option value="">Intent (engine will infer)</option>
          <option value="informational">Informational</option>
          <option value="commercial">Commercial</option>
          <option value="proof">Proof</option>
        </select>
        <input
          className={input}
          placeholder="Current rank in Google (if any)"
          inputMode="numeric"
          value={draft.currentRank}
          onChange={(e) => setDraft({ ...draft, currentRank: e.target.value })}
        />
        <input
          className={input}
          placeholder="Existing URL (if already ranking)"
          value={draft.existingUrl}
          onChange={(e) => setDraft({ ...draft, existingUrl: e.target.value })}
        />
        <select
          className={input}
          value={draft.practiceAreaHint}
          onChange={(e) => setDraft({ ...draft, practiceAreaHint: e.target.value })}
        >
          <option value="">Practice area (engine will infer)</option>
          <option value="employment">Employment Law</option>
          <option value="collections">Commercial Collections</option>
        </select>
      </div>
      <textarea
        rows={2}
        className={input}
        placeholder="Secondary keywords (one per line or comma-separated)"
        value={draft.secondaryKeywords}
        onChange={(e) => setDraft({ ...draft, secondaryKeywords: e.target.value })}
      />

      {err && <div className="text-xs text-red-600">{err}</div>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !draft.primaryKeyword.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-[#185FA5] text-white hover:bg-[#0f4d8c] disabled:opacity-50"
        >
          {submitting ? "Running engine…" : "Run Strategy Engine"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
