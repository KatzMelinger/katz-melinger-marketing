"use client";

/**
 * Refresh Queue — post-publish decay monitor.
 *
 * The loop-back stage of the content pipeline. The Strategy Engine flags an
 * existing page for refresh whenever it ranks on page 2/3 (positions 11–30) —
 * the shortest path to page one. Those land here as page_refresh decisions.
 *
 * Each row points at the existing URL and its current rank. Approving a refresh
 * sends it forward as a brief (→ Briefs → Production) so the page gets updated,
 * closing the loop back to the top of the pipeline.
 *
 * Reads/writes the shared brief_suggestions store via /api/seo/suggestions,
 * filtered to the page_refresh action.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { PipelineStageNav } from "@/components/pipeline-stage-nav";
import {
  DashButton,
  DashCard,
  DashInput,
  DashPill,
  DashSpinner,
} from "@/components/dashboard-ui";
import {
  PRIORITY_TONE,
  formatRelative,
  type Suggestion,
} from "@/lib/brief-suggestions";

type View = "open" | "approved" | "all";

/** Lower rank = closer to page one = higher refresh ROI. Nulls sort last. */
function rankOf(s: Suggestion): number {
  const r = s.metrics?.currentRank;
  return typeof r === "number" ? r : Number.POSITIVE_INFINITY;
}

export default function RefreshQueuePage() {
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("open");
  const [showScan, setShowScan] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/seo/suggestions", { cache: "no-store" });
      const json = await res.json();
      const all = Array.isArray(json) ? (json as Suggestion[]) : [];
      setRows(all.filter((s) => s.recommended_action === "page_refresh"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: Suggestion["status"], promptNote = false) {
    let decisionNotes: string | undefined;
    if (promptNote) {
      const note = window.prompt("Reason (optional):", "");
      if (note === null) return;
      decisionNotes = note || undefined;
    }
    setBusyId(id);
    try {
      await fetch(`/api/seo/suggestions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, decisionNotes }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const visible = rows
    .filter((s) =>
      view === "all"
        ? true
        : view === "approved"
          ? s.status === "approved"
          : s.status === "pending" || s.status === "held",
    )
    .sort((a, b) => rankOf(a) - rankOf(b));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-2 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Content / Refresh
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Refresh Queue
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Existing pages ranking on page 2–3 (positions 11–30) — the shortest
            path to page one. Approve a refresh to send it forward as a brief.
          </p>
        </div>
        <DashButton onClick={() => setShowScan((v) => !v)}>
          {showScan ? "Close" : "+ Scan for refresh"}
        </DashButton>
      </div>

      <PipelineStageNav />

      {showScan && (
        <ScanForm
          onCreated={() => {
            setShowScan(false);
            setView("open");
            load();
          }}
          onCancel={() => setShowScan(false)}
        />
      )}

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit">
        {(
          [
            ["open", "Needs refresh"],
            ["approved", "Approved"],
            ["all", "All"],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === v ? "bg-[#185FA5] text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <DashCard className="py-12 text-center text-sm text-slate-500">
          <DashSpinner /> Loading refresh queue…
        </DashCard>
      ) : visible.length === 0 ? (
        <DashCard className="space-y-3 py-12 text-center">
          <div className="text-3xl" aria-hidden>
            ♻
          </div>
          <h3 className="text-lg font-semibold">Nothing to refresh</h3>
          <p className="mx-auto max-w-md text-sm text-slate-600">
            No pages flagged for refresh. The engine adds them automatically when
            a tracked page slips to positions 11–30, or scan one by hand.
          </p>
          <div>
            <DashButton onClick={() => setShowScan(true)}>+ Scan for refresh</DashButton>
          </div>
        </DashCard>
      ) : (
        <div className="space-y-3">
          {visible.map((s) => (
            <RefreshCard
              key={s.id}
              s={s}
              busy={busyId === s.id}
              onApprove={() => setStatus(s.id, "approved")}
              onHold={() => setStatus(s.id, "held", true)}
              onDismiss={() => setStatus(s.id, "rejected", true)}
              onReopen={() => setStatus(s.id, "pending")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RefreshCard({
  s,
  busy,
  onApprove,
  onHold,
  onDismiss,
  onReopen,
}: {
  s: Suggestion;
  busy: boolean;
  onApprove: () => void;
  onHold: () => void;
  onDismiss: () => void;
  onReopen: () => void;
}) {
  const rank = s.metrics?.currentRank;
  const url = s.existing_url || s.suggested_brief?.urlSlug || null;

  return (
    <DashCard className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{s.primary_keyword}</h3>
            {typeof rank === "number" && (
              <DashPill tone={rank <= 20 ? "amber" : "neutral"}>ranks #{rank}</DashPill>
            )}
            <DashPill tone={PRIORITY_TONE[s.priority]}>{s.priority} priority</DashPill>
          </div>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block truncate font-mono text-xs text-[#185FA5] hover:underline"
            >
              {url}
            </a>
          )}
        </div>
        <div className="shrink-0 text-right text-[11px] text-slate-400">
          <span className="capitalize">{s.practice_area}</span>
          <div>{formatRelative(s.created_at)}</div>
        </div>
      </div>

      {s.reasoning && <p className="text-sm text-slate-700">{s.reasoning}</p>}

      {s.decision_notes && (
        <p className="text-xs italic text-slate-500">Note: {s.decision_notes}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {s.status === "approved" ? (
          <>
            <DashPill tone="emerald">Approved</DashPill>
            <Link
              href="/content/briefs"
              className="text-xs font-medium text-[#185FA5] hover:underline"
            >
              View in Briefs →
            </Link>
            <DashButton variant="ghost" onClick={onReopen} disabled={busy}>
              Reopen
            </DashButton>
          </>
        ) : s.status === "rejected" ? (
          <>
            <DashPill tone="red">Dismissed</DashPill>
            <DashButton variant="ghost" onClick={onReopen} disabled={busy}>
              Reopen
            </DashButton>
          </>
        ) : (
          <>
            <DashButton onClick={onApprove} disabled={busy}>
              {busy ? <DashSpinner /> : "Approve refresh → Brief"}
            </DashButton>
            <DashButton variant="outline" onClick={onHold} disabled={busy}>
              Hold
            </DashButton>
            <DashButton variant="danger" onClick={onDismiss} disabled={busy}>
              Dismiss
            </DashButton>
            {s.status === "held" && <DashPill tone="amber">On hold</DashPill>}
          </>
        )}
      </div>
    </DashCard>
  );
}

function ScanForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [existingUrl, setExistingUrl] = useState("");
  const [currentRank, setCurrentRank] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const rank = Number(currentRank);
    if (!primaryKeyword.trim() || !existingUrl.trim()) {
      setError("Keyword and existing URL are required.");
      return;
    }
    if (!Number.isFinite(rank) || rank < 1) {
      setError("Enter the page's current rank (the engine refreshes positions 11–30).");
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
          existingUrl: existingUrl.trim(),
          currentRank: rank,
          source: "manual",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Failed to scan");
      if (json?.recommended_action && json.recommended_action !== "page_refresh") {
        // The engine decided this isn't a refresh (e.g. already top-10, or no
        // rank). It still saved as a decision — point the user there.
        setError(
          `Engine recommended "${json.recommended_action}", not a refresh — find it in Content Decisions.`,
        );
        return;
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <DashCard className="mb-4 space-y-3 border-[#185FA5]/30 bg-slate-50">
      <h2 className="text-sm font-semibold text-slate-900">
        Scan an existing page for refresh
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-slate-700">Primary keyword *</label>
          <DashInput
            className="mt-1 w-full"
            value={primaryKeyword}
            onChange={(e) => setPrimaryKeyword(e.target.value)}
            placeholder="wage theft attorney nyc"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Existing URL *</label>
          <DashInput
            className="mt-1 w-full"
            value={existingUrl}
            onChange={(e) => setExistingUrl(e.target.value)}
            placeholder="https://katzmelinger.com/…"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">Current rank *</label>
          <DashInput
            className="mt-1 w-full"
            type="number"
            value={currentRank}
            onChange={(e) => setCurrentRank(e.target.value)}
            placeholder="11–30 = refresh candidate"
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <DashButton onClick={run} disabled={running}>
          {running ? (
            <>
              <DashSpinner /> Scanning…
            </>
          ) : (
            "Add to queue"
          )}
        </DashButton>
        <DashButton variant="outline" onClick={onCancel}>
          Cancel
        </DashButton>
      </div>
    </DashCard>
  );
}
