"use client";

/**
 * Legal Review — the queue behind the hold (Diana's §3).
 *
 * The approval gate could already stop a draft whose claims conflict with the
 * authority they cite, mark it `needs_legal`, and email the practice-area
 * attorney. What it could not do was give that attorney anywhere to go: the
 * email named one draft, nothing gathered them, and opening the draft showed a
 * findings panel with none of the legal detail — not the claim, not the
 * authority, not what the authority actually says.
 *
 * A hold with no queue is a hold that waits for someone to remember it.
 *
 * OLDEST FIRST. Everything here is equally blocked — held is the most severe
 * state a draft has — so ordering by severity would just reshuffle items that
 * are all stuck. Age is what varies, and a draft held three weeks is the exact
 * failure this page exists to prevent.
 *
 * Resolving asks WHAT WAS DONE, not just that it is done. "Approved as is" and
 * "fixed" are different facts about the checker, and the ratio between them is
 * the number that says whether it is too noisy. The column existed since the
 * legal migration; nothing had ever written it.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { DashButton, DashCard, DashPill, DashSpinner } from "@/components/dashboard-ui";
import { PipelineStageNav } from "@/components/pipeline-stage-nav";
import type { StoredFinding } from "@/lib/content-findings";

type Item = {
  draftId: string;
  title: string;
  format: string | null;
  practiceArea: string | null;
  heldSince: string;
  daysHeld: number;
  areaLabel: string;
  reviewers: { name: string; email: string }[];
  findings: StoredFinding[];
  otherBlocking: number;
};

type Payload = {
  items: Item[];
  canClear: boolean;
  viewer: string | null;
  legalAccuracyEnabled: boolean;
};

const RESOLUTIONS = [
  { id: "fixed", label: "Fixed", hint: "The copy was changed so the claim is accurate." },
  { id: "approved_as_is", label: "Approved as is", hint: "The claim is right; the checker was wrong." },
  { id: "removed", label: "Removed", hint: "The claim was deleted rather than corrected." },
] as const;

const CLAIM_TYPE_LABEL: Record<string, string> = {
  factual_mismatch: "Factual mismatch",
  interpretation: "Interpretation",
  negative_statement: "Negative statement",
  firm_claim: "Firm claim",
  unclassified: "Unclassified",
};

/** Amber past a week, red past a fortnight. Age is the whole point of the sort. */
function ageTone(days: number): string {
  if (days >= 14) return "border-red-300 bg-red-50 text-red-800";
  if (days >= 7) return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export default function LegalReviewPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content/legal-review", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load");
      setData((await res.json()) as Payload);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = useCallback(
    async (draftId: string, finding: StoredFinding, resolution: string) => {
      const note = (notes[finding.id] ?? "").trim();
      // A conclusion with no reasoning is not reviewable later. "Approved as is"
      // especially: it overrides a check, and six months on the only record of
      // why is whatever was typed here.
      if (!note) {
        setMsg("Add a short note saying why — it is the record of the decision.");
        return;
      }
      setBusy(finding.id);
      setMsg(null);
      try {
        const res = await fetch(`/api/content/drafts/${draftId}/findings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ findingId: finding.id, status: "resolved", note, resolution }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Failed to resolve");
        setNotes((n) => ({ ...n, [finding.id]: "" }));
        await load();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Failed to resolve");
      } finally {
        setBusy(null);
      }
    },
    [notes, load],
  );

  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PipelineStageNav />

      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Legal Review</h1>
          <p className="mt-1 text-sm text-slate-600">
            Drafts held because a claim conflicts with the authority it cites. Oldest first.
          </p>
        </div>
        <DashButton onClick={() => void load()} disabled={loading}>
          Refresh
        </DashButton>
      </div>

      {msg && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {msg}
        </div>
      )}

      {/* An empty queue because nothing is held and an empty queue because the
          gate is switched off look identical. Say which. */}
      {data && !data.legalAccuracyEnabled && (
        <div className="mb-4 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <strong>The legal gate is off.</strong> LEGAL_ACCURACY is not set, so nothing is being
          held for review — this queue will stay empty whatever the drafts say.
        </div>
      )}

      {data && data.legalAccuracyEnabled && !data.canClear && (
        <div className="mb-4 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          You can read this queue but not clear a hold. Only the firm&apos;s attorneys can.
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <DashSpinner />
        </div>
      )}

      {!loading && items.length === 0 && (
        <DashCard>
          <p className="py-6 text-center text-sm text-slate-500">
            Nothing is held for legal review.
          </p>
        </DashCard>
      )}

      <div className="space-y-4">
        {items.map((item) => (
          <DashCard key={item.draftId}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/content/drafts?draft=${item.draftId}`}
                  className="text-sm font-semibold text-slate-900 hover:underline"
                >
                  {item.title}
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">
                  {item.areaLabel}
                  {item.format ? ` · ${item.format.replace(/^km_/, "").replace(/_/g, " ")}` : ""}
                  {" · "}
                  {item.reviewers[0]?.name ? `owner: ${item.reviewers[0].name}` : "unassigned"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded border px-2 py-0.5 text-xs font-medium ${ageTone(item.daysHeld)}`}
              >
                held {item.daysHeld === 0 ? "today" : `${item.daysHeld}d`}
              </span>
            </div>

            {/* A draft can be held with NO legal findings — two were, for 29 and
                25 days, set by an older path before the legal gate existed.
                Rendering an empty card would leave the reviewer with nothing to
                act on and no idea why, which is how a draft sits for a month.
                Say what is actually blocking it and where to go. */}
            {item.findings.length === 0 && (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Held, but with no legal findings.</p>
                <p className="mt-1 text-xs">
                  {item.otherBlocking > 0
                    ? `Nothing here is a legal issue. ${item.otherBlocking} open critical finding${
                        item.otherBlocking === 1 ? "" : "s"
                      } from other checks ${
                        item.otherBlocking === 1 ? "is" : "are"
                      } what is blocking it — open the draft and clear ${
                        item.otherBlocking === 1 ? "it" : "them"
                      } there.`
                    : "Nothing is currently flagged against it at all. It was most likely held before the legal gate existed; re-approving will re-run the checks and release it if they pass."}
                </p>
              </div>
            )}

            {item.findings.length > 0 && item.otherBlocking > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Also {item.otherBlocking} open critical finding
                {item.otherBlocking === 1 ? "" : "s"} from other checks — clearing the legal ones
                will not release this draft on its own.
              </p>
            )}

            <div className="mt-3 space-y-3">
              {item.findings.map((f) => (
                <div key={f.id} className="rounded border border-red-200 bg-red-50/50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <DashPill tone="red">{f.severity}</DashPill>
                    {f.claimType && (
                      <span className="text-xs text-slate-600">
                        {CLAIM_TYPE_LABEL[f.claimType] ?? f.claimType}
                      </span>
                    )}
                    {f.jurisdiction && (
                      <span className="text-xs text-slate-500">{f.jurisdiction}</span>
                    )}
                  </div>

                  <p className="mt-1.5 text-sm font-medium text-slate-900">{f.title}</p>
                  {f.detail && <p className="mt-1 text-sm text-slate-700">{f.detail}</p>}

                  {f.excerpt && (
                    <blockquote className="mt-2 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-600">
                      {f.excerpt}
                    </blockquote>
                  )}

                  {/* The authority is the whole basis of the finding. Without it
                      the reviewer is being asked to trust a verdict. */}
                  {f.sourceChecked && (
                    <p className="mt-2 text-xs text-slate-500">
                      Checked against{" "}
                      {f.sourceChecked.startsWith("http") ? (
                        <a
                          href={f.sourceChecked}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-700 underline"
                        >
                          {f.sourceChecked}
                        </a>
                      ) : (
                        f.sourceChecked
                      )}
                    </p>
                  )}

                  {data?.canClear && (
                    <div className="mt-3 border-t border-red-200 pt-3">
                      <input
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        placeholder="Why — one line. This is the record of the decision."
                        value={notes[f.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {RESOLUTIONS.map((r) => (
                          <span key={r.id} title={r.hint}>
                            <DashButton
                              disabled={busy === f.id}
                              onClick={() => void resolve(item.draftId, f, r.id)}
                            >
                              {busy === f.id ? "…" : r.label}
                            </DashButton>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Clearing findings does not itself un-hold the draft: the gate
                decides that, on a re-run. Saying so avoids someone resolving
                everything and wondering why it is still here. */}
            {item.findings.length > 0 && data?.canClear && (
              <p className="mt-3 text-xs text-slate-500">
                Once these are resolved, re-approve the draft — the gate re-checks and releases it
                only if the claims now hold.
              </p>
            )}
          </DashCard>
        ))}
      </div>
    </div>
  );
}
