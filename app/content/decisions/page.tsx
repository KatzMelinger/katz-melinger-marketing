"use client";

/**
 * Content Decisions — the go/no-go gate of the content pipeline.
 *
 * Sits between Research and Briefs. Each row is a Strategy Engine suggestion
 * (a brief_suggestions record): what a keyword/cluster should become, why, and
 * a pre-filled brief. The editor Approves (→ becomes a Brief), Holds, or
 * Rejects. New decisions can be generated on demand by running the engine on a
 * keyword.
 *
 * Reads/writes the shared store through the existing /api/seo/suggestions
 * endpoints — this page is the content-department view of that queue.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { PipelineStageNav } from "@/components/pipeline-stage-nav";
import {
  DashButton,
  DashCard,
  DashInput,
  DashPill,
  DashSelect,
  DashSpinner,
} from "@/components/dashboard-ui";
import {
  ACTION_LABEL,
  ACTION_TONE,
  CONTENT_TYPE_LABEL,
  PRIORITY_TONE,
  RISK_TONE,
  formatRelative,
  type Suggestion,
  type SuggestionStatus,
} from "@/lib/brief-suggestions";

const STATUS_TABS: { value: SuggestionStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "held", label: "Held" },
  { value: "rejected", label: "Rejected" },
  { value: "approved", label: "Approved" },
  { value: "all", label: "All" },
];

export default function DecisionsPage() {
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SuggestionStatus | "all">("pending");
  const [priority, setPriority] = useState("");
  const [practiceArea, setPracticeArea] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status !== "all") qs.set("status", status);
      if (priority) qs.set("priority", priority);
      if (practiceArea) qs.set("practiceArea", practiceArea);
      const res = await fetch(`/api/seo/suggestions?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      setRows(Array.isArray(json) ? json : []);
    } finally {
      setLoading(false);
    }
  }, [status, priority, practiceArea]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(
    id: string,
    next: SuggestionStatus,
    opts: { promptNote?: boolean } = {},
  ) {
    let decisionNotes: string | undefined;
    if (opts.promptNote) {
      const note = window.prompt(
        next === "rejected" ? "Reason for rejecting (optional):" : "Note (optional):",
        "",
      );
      if (note === null) return; // cancelled
      decisionNotes = note || undefined;
    }
    setBusyId(id);
    try {
      await fetch(`/api/seo/suggestions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, decisionNotes }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-2 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Content / Decisions
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Content Decisions
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            The go/no-go gate. The Strategy Engine recommends what each keyword
            cluster should become — approve to turn it into a brief, hold, or
            reject. Approving also confirms the cannibalization check, so the
            brief is ready to draft in one click from the Production Board.
          </p>
        </div>
        <DashButton onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Close" : "+ New decision"}
        </DashButton>
      </div>

      <PipelineStageNav />

      {showNew && (
        <NewDecisionForm
          onCreated={() => {
            setShowNew(false);
            setStatus("pending");
            load();
          }}
          onCancel={() => setShowNew(false)}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setStatus(t.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                status === t.value
                  ? "bg-brand text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <DashSelect value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </DashSelect>
        <DashSelect
          value={practiceArea}
          onChange={(e) => setPracticeArea(e.target.value)}
        >
          <option value="">All practice areas</option>
          <option value="employment">Employment</option>
          <option value="collections">Collections</option>
        </DashSelect>
      </div>

      {loading ? (
        <DashCard className="py-12 text-center text-sm text-slate-500">
          <DashSpinner /> Loading decisions…
        </DashCard>
      ) : rows.length === 0 ? (
        <DashCard className="space-y-3 py-12 text-center">
          <div className="text-3xl" aria-hidden>
            ✓
          </div>
          <h3 className="text-lg font-semibold">Nothing here</h3>
          <p className="mx-auto max-w-md text-sm text-slate-600">
            No {status === "all" ? "" : status} decisions. Generate one from a
            keyword, or pull keywords in from{" "}
            <Link href="/seo/opportunities" className="text-brand hover:underline">
              Opportunities
            </Link>
            .
          </p>
          <div>
            <DashButton onClick={() => setShowNew(true)}>+ New decision</DashButton>
          </div>
        </DashCard>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <DecisionCard
              key={s.id}
              s={s}
              busy={busyId === s.id}
              onApprove={() => decide(s.id, "approved")}
              onHold={() => decide(s.id, "held", { promptNote: true })}
              onReject={() => decide(s.id, "rejected", { promptNote: true })}
              onReopen={() => decide(s.id, "pending")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionCard({
  s,
  busy,
  onApprove,
  onHold,
  onReject,
  onReopen,
}: {
  s: Suggestion;
  busy: boolean;
  onApprove: () => void;
  onHold: () => void;
  onReject: () => void;
  onReopen: () => void;
}) {
  const m = s.metrics ?? {};
  const metricBits = [
    m.volume != null ? `Vol ${m.volume.toLocaleString()}` : null,
    m.kd != null ? `KD ${m.kd}` : null,
    m.currentRank != null ? `Rank ${m.currentRank}` : null,
    m.cpc != null ? `CPC $${m.cpc}` : null,
  ].filter(Boolean) as string[];

  return (
    <DashCard className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">
              {s.primary_keyword}
            </h3>
            <DashPill tone={ACTION_TONE[s.recommended_action]}>
              {ACTION_LABEL[s.recommended_action]}
            </DashPill>
            <DashPill tone={PRIORITY_TONE[s.priority]}>{s.priority} priority</DashPill>
            {s.cannibalization_risk !== "none" && s.cannibalization_risk !== "unknown" && (
              <DashPill tone={RISK_TONE[s.cannibalization_risk]}>
                cannibalization: {s.cannibalization_risk}
              </DashPill>
            )}
          </div>
          {s.cluster_name && s.cluster_name !== s.primary_keyword && (
            <p className="mt-0.5 text-xs text-slate-500">Cluster: {s.cluster_name}</p>
          )}
        </div>
        <div className="shrink-0 text-right text-[11px] text-slate-400">
          {CONTENT_TYPE_LABEL[s.content_type] ?? s.content_type}
          <div>{formatRelative(s.created_at)}</div>
        </div>
      </div>

      {s.reasoning && <p className="text-sm text-slate-700">{s.reasoning}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="capitalize">{s.practice_area}</span>
        {s.search_intent && <span className="capitalize">{s.search_intent}</span>}
        {metricBits.map((b) => (
          <span key={b}>{b}</span>
        ))}
        <span className="text-slate-400">via {s.decision_source}</span>
      </div>

      {s.cannibalization_notes && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {s.cannibalization_notes}
          {s.existing_url && (
            <>
              {" "}
              <a
                href={s.existing_url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                existing page
              </a>
            </>
          )}
        </p>
      )}

      {s.decision_notes && (
        <p className="text-xs italic text-slate-500">Note: {s.decision_notes}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {s.status === "approved" ? (
          <>
            <DashPill tone="emerald">Approved</DashPill>
            <Link
              href="/content/briefs"
              className="text-xs font-medium text-brand hover:underline"
            >
              View in Briefs →
            </Link>
            <DashButton variant="ghost" onClick={onReopen} disabled={busy}>
              Reopen
            </DashButton>
          </>
        ) : s.status === "rejected" ? (
          <>
            <DashPill tone="red">Rejected</DashPill>
            <DashButton variant="ghost" onClick={onReopen} disabled={busy}>
              Reopen
            </DashButton>
          </>
        ) : (
          <>
            <DashButton onClick={onApprove} disabled={busy}>
              {busy ? <DashSpinner /> : "Approve → Brief"}
            </DashButton>
            <DashButton variant="outline" onClick={onHold} disabled={busy}>
              Hold
            </DashButton>
            <DashButton variant="danger" onClick={onReject} disabled={busy}>
              Reject
            </DashButton>
            {s.status === "held" && <DashPill tone="amber">On hold</DashPill>}
          </>
        )}
      </div>
    </DashCard>
  );
}

function NewDecisionForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [practiceAreaHint, setPracticeAreaHint] = useState("");
  const [intent, setIntent] = useState("");
  const [volume, setVolume] = useState("");
  const [kd, setKd] = useState("");
  const [currentRank, setCurrentRank] = useState("");
  const [existingUrl, setExistingUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function num(v: string): number | null {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  }

  async function run() {
    if (!primaryKeyword.trim()) {
      setError("Primary keyword is required.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryKeyword: primaryKeyword.trim(),
          practiceAreaHint: practiceAreaHint || null,
          intent: intent || null,
          volume: num(volume),
          kd: num(kd),
          currentRank: num(currentRank),
          existingUrl: existingUrl.trim() || null,
          source: "manual",
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "Failed to run the engine");
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <DashCard className="mb-4 space-y-3 border-brand/30 bg-slate-50">
      <h2 className="text-sm font-semibold text-slate-900">
        Run the Strategy Engine on a keyword
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-slate-700">Primary keyword *</label>
          <DashInput
            className="mt-1 w-full"
            value={primaryKeyword}
            onChange={(e) => setPrimaryKeyword(e.target.value)}
            placeholder="unpaid overtime new york"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Practice area</label>
          <DashSelect
            className="mt-1 w-full"
            value={practiceAreaHint}
            onChange={(e) => setPracticeAreaHint(e.target.value)}
          >
            <option value="">Auto-detect</option>
            <option value="employment">Employment</option>
            <option value="collections">Collections</option>
          </DashSelect>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Search intent</label>
          <DashSelect
            className="mt-1 w-full"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
          >
            <option value="">Auto-detect</option>
            <option value="informational">Informational</option>
            <option value="commercial">Commercial</option>
            <option value="proof">Proof</option>
          </DashSelect>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Volume</label>
          <DashInput
            className="mt-1 w-full"
            type="number"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            placeholder="optional"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Keyword difficulty</label>
          <DashInput
            className="mt-1 w-full"
            type="number"
            value={kd}
            onChange={(e) => setKd(e.target.value)}
            placeholder="optional"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Current rank</label>
          <DashInput
            className="mt-1 w-full"
            type="number"
            value={currentRank}
            onChange={(e) => setCurrentRank(e.target.value)}
            placeholder="if already ranking"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Existing URL</label>
          <DashInput
            className="mt-1 w-full"
            value={existingUrl}
            onChange={(e) => setExistingUrl(e.target.value)}
            placeholder="https://yourfirm.com/…"
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <DashButton onClick={run} disabled={running || !primaryKeyword.trim()}>
          {running ? (
            <>
              <DashSpinner /> Running…
            </>
          ) : (
            "Generate decision"
          )}
        </DashButton>
        <DashButton variant="outline" onClick={onCancel}>
          Cancel
        </DashButton>
      </div>
    </DashCard>
  );
}
