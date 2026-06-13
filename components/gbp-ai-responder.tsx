"use client";

/**
 * GBP AI Responder — drops into the /local-seo reviews tab.
 *
 * Given the list of GBP reviews the page already fetched, this component
 * shows each unresponded review with:
 *   - "Draft with AI" → calls /api/local-seo/gbp/draft-reply
 *   - Editable textarea showing the draft
 *   - "Send to Google" → calls /api/local-seo/gbp/reply
 *
 * The component is fully self-contained — drop in `<GbpAiResponder reviews={gbpReviews} />`
 * after the reviews table. State is local; no persistence needed because
 * Google itself is the source of truth (the next dashboard fetch will show
 * `responded: true`).
 */

import { useMemo, useState } from "react";

import {
  ComplianceNotice,
  type ComplianceNoticeData,
} from "@/components/compliance-notice";

type ReviewRow = {
  id: string;
  author: string;
  rating: number;
  comment: string;
  date: string;
  responded: boolean;
};

type ReplyState =
  | { kind: "idle" }
  | { kind: "drafting" }
  | { kind: "draft"; text: string; compliance?: ComplianceNoticeData | null }
  | { kind: "sending"; text: string; compliance?: ComplianceNoticeData | null }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function GbpAiResponder({ reviews }: { reviews: ReviewRow[] }) {
  const [state, setState] = useState<Record<string, ReplyState>>({});

  // Only surface reviews that don't already have a reply. The marketer can
  // still see all reviews in the main table above.
  const pending = useMemo(
    () => reviews.filter((r) => !r.responded),
    [reviews],
  );

  const setReview = (id: string, next: ReplyState) => {
    setState((s) => ({ ...s, [id]: next }));
  };

  const draft = async (review: ReviewRow) => {
    setReview(review.id, { kind: "drafting" });
    try {
      const res = await fetch("/api/local-seo/gbp/draft-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: review.id,
          author: review.author,
          rating: review.rating,
          comment: review.comment,
          date: review.date,
        }),
      });
      const data = (await res.json()) as {
        reply?: string;
        error?: string;
        compliance?: ComplianceNoticeData | null;
      };
      if (!res.ok || !data.reply) {
        throw new Error(data.error ?? "draft failed");
      }
      setReview(review.id, {
        kind: "draft",
        text: data.reply,
        compliance: data.compliance ?? null,
      });
    } catch (err) {
      setReview(review.id, {
        kind: "error",
        message: err instanceof Error ? err.message : "draft failed",
      });
    }
  };

  const send = async (review: ReviewRow, text: string) => {
    if (!text.trim()) return;
    setReview(review.id, { kind: "sending", text });
    try {
      const res = await fetch("/api/local-seo/gbp/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: review.id, comment: text }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "send failed");
      }
      setReview(review.id, { kind: "sent" });
    } catch (err) {
      setReview(review.id, {
        kind: "error",
        message: err instanceof Error ? err.message : "send failed",
      });
    }
  };

  if (pending.length === 0) {
    return (
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">AI review responder</h2>
        <p className="mt-2 text-sm text-emerald-700">
          ✓ All recent reviews have responses.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[#e2e8f0] bg-white p-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-slate-900">AI review responder</h2>
        <span className="text-xs text-slate-500">
          {pending.length} review{pending.length === 1 ? "" : "s"} awaiting reply
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Drafts respect the firm&apos;s Brand Voice and the legal-ethics constraints
        for public review replies (no client confirmation, no outcome promises,
        empathy first). Edit before sending.
      </p>

      <ul className="space-y-4">
        {pending.map((r) => {
          const st = state[r.id] ?? { kind: "idle" };
          return (
            <li
              key={r.id}
              className="rounded-lg border border-[#e2e8f0] bg-slate-50/40 p-3"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    <span className="text-amber-500 mr-1">
                      {"★".repeat(Math.max(0, Math.min(5, r.rating)))}
                      <span className="text-slate-300">
                        {"★".repeat(5 - Math.max(0, Math.min(5, r.rating)))}
                      </span>
                    </span>
                    {r.author}
                    {r.date ? (
                      <span className="ml-2 text-xs text-slate-500">
                        {r.date}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">
                    {r.comment}
                  </p>
                </div>
              </div>

              {st.kind === "idle" || st.kind === "error" ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void draft(r)}
                    className="text-xs px-3 py-1.5 rounded bg-[#185FA5] text-white hover:bg-[#1f6fb8]"
                  >
                    Draft with AI
                  </button>
                  {st.kind === "error" ? (
                    <span className="text-xs text-red-700">{st.message}</span>
                  ) : null}
                </div>
              ) : null}

              {st.kind === "drafting" ? (
                <p className="text-xs text-slate-500">Drafting…</p>
              ) : null}

              {(st.kind === "draft" || st.kind === "sending") ? (
                <div className="space-y-2">
                  <textarea
                    value={st.text}
                    onChange={(e) =>
                      setReview(r.id, {
                        kind: "draft",
                        text: e.target.value,
                        compliance: st.compliance,
                      })
                    }
                    rows={4}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm resize-y focus:border-[#185FA5] focus:outline-none"
                  />
                  <ComplianceNotice compliance={st.compliance} />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={st.kind === "sending"}
                      onClick={() => void send(r, st.text)}
                      className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {st.kind === "sending" ? "Sending…" : "Send to Google"}
                    </button>
                    <button
                      type="button"
                      disabled={st.kind === "sending"}
                      onClick={() => void draft(r)}
                      className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5] disabled:opacity-50"
                    >
                      Re-draft
                    </button>
                    <span className="text-[11px] text-slate-500">
                      {st.text.length} chars
                    </span>
                  </div>
                </div>
              ) : null}

              {st.kind === "sent" ? (
                <p className="text-xs text-emerald-700">
                  ✓ Reply posted to Google. Refresh the dashboard to confirm.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
