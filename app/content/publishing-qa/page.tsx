"use client";

/**
 * Publishing QA — the pre-publish gate.
 *
 * Pulls every Production Board item sitting in Review and runs a publish
 * checklist against it. Some checks are derived automatically from the item
 * (destination URL, target keywords, owner, linked draft, title length); the
 * rest are editor self-certifications (legal review, schema, internal links,
 * citations, proofreading).
 *
 * "Approve & Publish" stays disabled until every check passes, then runs the
 * real gates. "Send back to Draft" returns it for more work.
 *
 * It used to PATCH the board row straight from review to published, which
 * skipped `approved` — and with it the compliance gate, the freshness gate, and
 * the publish route's own re-check. The button was named for a thing it did not
 * do. It now calls /api/agent/approve and then the draft publish route, so a
 * held draft stops here with its violations shown instead of going live.
 *
 * The self-certifications persist per draft with the reviewer's identity and a
 * timestamp (POST .../certify), so a sign-off survives a refresh and can be
 * attributed. The legal one is refused while compliance is failing.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { PipelineStageNav } from "@/components/pipeline-stage-nav";
import { DashButton, DashCard, DashPill, DashSpinner } from "@/components/dashboard-ui";

type ReviewItem = {
  id: number;
  title: string;
  keywords: string | null;
  location: string | null;
  status: string;
  bucket: string;
  notes: string | null;
  url: string | null;
  draft_id: string | null;
  owner_user_id: string | null;
  owner_email: string | null;
  status_updated_at: string;
  /** Persisted reviewer sign-offs, keyed by MANUAL_CHECKS key. */
  certifications: Record<string, Certification>;
};

/** Checks computed from the item itself — the editor can't fake these. */
const AUTO_CHECKS: { key: string; label: string; test: (i: ReviewItem) => boolean }[] = [
  { key: "url", label: "Destination URL set", test: (i) => !!i.url?.trim() },
  { key: "keywords", label: "Target keyword(s) set", test: (i) => !!i.keywords?.trim() },
  { key: "owner", label: "Owner assigned", test: (i) => !!i.owner_user_id },
  { key: "draft", label: "Draft linked", test: (i) => !!i.draft_id },
  {
    key: "title",
    label: "Title ≤ 60 characters",
    test: (i) => i.title.trim().length > 0 && i.title.trim().length <= 60,
  },
];

/**
 * Checks the editor self-certifies before publish. The keys are the shared
 * certification vocabulary in /api/content/drafts/[id]/certify — each tick is
 * stored on the draft with the reviewer's id, email, and timestamp.
 */
const MANUAL_CHECKS: { key: string; label: string }[] = [
  { key: "legal_review", label: "Legal / attorney review complete" },
  { key: "schema", label: "Schema markup added" },
  { key: "internal_links", label: "Internal links added & verified" },
  { key: "citations", label: "Sources & citations verified" },
  { key: "proofread", label: "Proofread & on-brand" },
];

type Certification = { by: string; by_email: string; at: string };

const TOTAL_CHECKS = AUTO_CHECKS.length + MANUAL_CHECKS.length;

export default function PublishingQAPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // itemId → outcome of the last publish attempt, so a gate hold is explained
  // on the card that was held rather than vanishing into a reload.
  const [notice, setNotice] = useState<
    Record<number, { tone: "ok" | "error"; text: string }>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/pipeline?status=review", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load review items");
      setItems((json.items ?? []) as ReviewItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Persist one certification against the linked draft. The server stamps who
   * and when, and refuses the legal tick while compliance is failing — so a
   * rejection here is information, not a glitch, and gets surfaced.
   */
  async function toggle(item: ReviewItem, key: string) {
    if (!item.draft_id) {
      setNotice((n) => ({
        ...n,
        [item.id]: { tone: "error", text: "Link a draft before certifying." },
      }));
      return;
    }
    const next = !item.certifications?.[key];
    const res = await fetch(`/api/content/drafts/${item.draft_id}/certify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice((n) => ({
        ...n,
        [item.id]: { tone: "error", text: data?.error ?? "Couldn’t record that check." },
      }));
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, certifications: data.certifications ?? {} } : i,
      ),
    );
    setNotice((n) => {
      if (!(item.id in n)) return n;
      const rest = { ...n };
      delete rest[item.id];
      return rest;
    });
  }

  /**
   * Approve & Publish, for real: the compliance and freshness gates run at
   * approve, then the publish route re-checks compliance at the moment of
   * publishing. A 422 at either step means the draft was HELD — it is now at
   * needs_legal with its violations recorded, and it does not go live.
   */
  async function publish(item: ReviewItem) {
    if (!item.draft_id) return;
    setBusyId(item.id);
    try {
      const approveRes = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "content", id: item.draft_id, action: "approve" }),
      });
      const approveData = await approveRes.json().catch(() => ({}));
      if (!approveRes.ok) {
        const held = approveRes.status === 422;
        setNotice((n) => ({
          ...n,
          [item.id]: {
            tone: "error",
            text: held
              ? `${approveData?.error ?? "Held by a gate."} Open the draft to resolve it — it was not published.`
              : (approveData?.error ?? "Approve failed."),
          },
        }));
        await load();
        return;
      }

      const publishRes = await fetch(`/api/content/drafts/${item.draft_id}/publish`, {
        method: "POST",
      });
      const publishData = await publishRes.json().catch(() => ({}));
      if (!publishRes.ok) {
        setNotice((n) => ({
          ...n,
          [item.id]: {
            tone: "error",
            text: `${publishData?.error ?? "Publish failed."} The draft stays approved — nothing went live.`,
          },
        }));
        await load();
        return;
      }
      setNotice((n) => ({ ...n, [item.id]: { tone: "ok", text: "Published." } }));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  /** Send back to Draft — an ungated transition, so the board PATCH is fine. */
  async function returnToDraft(id: number) {
    setBusyId(id);
    try {
      await fetch(`/api/content/pipeline/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "draft" }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Content / Publishing QA
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          Publishing QA
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Every piece in Review, gated by a publish checklist. Clear all checks
          to publish, or send it back to Draft.
        </p>
      </div>

      <PipelineStageNav />

      {loading ? (
        <DashCard className="py-12 text-center text-sm text-slate-500">
          <DashSpinner /> Loading review queue…
        </DashCard>
      ) : error ? (
        <DashCard className="space-y-2 py-10 text-center">
          <div className="text-2xl" aria-hidden>
            ⚠
          </div>
          <h3 className="text-base font-semibold">Couldn’t load the review queue</h3>
          <p className="mx-auto max-w-md text-sm text-slate-600">{error}</p>
          <div>
            <DashButton variant="outline" onClick={load}>
              Retry
            </DashButton>
          </div>
        </DashCard>
      ) : items.length === 0 ? (
        <DashCard className="space-y-3 py-12 text-center">
          <div className="text-3xl" aria-hidden>
            🔍
          </div>
          <h3 className="text-lg font-semibold">Nothing in review</h3>
          <p className="mx-auto max-w-md text-sm text-slate-600">
            Move a piece to{" "}
            <span className="font-medium">Review</span> on the{" "}
            <Link href="/content-production" className="text-brand hover:underline">
              Production Board
            </Link>{" "}
            and it shows up here for the publish checklist.
          </p>
        </DashCard>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <QACard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              notice={notice[item.id]}
              onToggle={(key) => toggle(item, key)}
              onPublish={() => publish(item)}
              onReturn={() => returnToDraft(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QACard({
  item,
  busy,
  notice,
  onToggle,
  onPublish,
  onReturn,
}: {
  item: ReviewItem;
  busy: boolean;
  notice?: { tone: "ok" | "error"; text: string };
  onToggle: (key: string) => void;
  onPublish: () => void;
  onReturn: () => void;
}) {
  const certs = item.certifications ?? {};
  const autoPassed = AUTO_CHECKS.filter((c) => c.test(item)).length;
  const manualPassed = MANUAL_CHECKS.filter((c) => certs[c.key]).length;
  const passed = autoPassed + manualPassed;
  const ready = passed === TOTAL_CHECKS;

  return (
    <DashCard className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="hover:text-brand hover:underline"
              >
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {item.keywords && <span>Kw: {item.keywords}</span>}
            {item.owner_email && <span>Owner: {item.owner_email.split("@")[0]}</span>}
          </div>
        </div>
        <DashPill tone={ready ? "emerald" : passed === 0 ? "neutral" : "amber"}>
          {passed}/{TOTAL_CHECKS} checks
        </DashPill>
      </div>

      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Automatic
          </p>
          <ul className="space-y-1">
            {AUTO_CHECKS.map((c) => {
              const ok = c.test(item);
              return (
                <li key={c.key} className="flex items-center gap-2 text-sm">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                      ok ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                    }`}
                    aria-hidden
                  >
                    {ok ? "✓" : "○"}
                  </span>
                  <span className={ok ? "text-slate-700" : "text-slate-500"}>{c.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Self-certify
          </p>
          <ul className="space-y-1">
            {MANUAL_CHECKS.map((c) => {
              const cert = certs[c.key];
              const ok = !!cert;
              return (
                <li key={c.key}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ok}
                      onChange={() => onToggle(c.key)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand/30"
                    />
                    <span className={ok ? "text-slate-700" : "text-slate-500"}>
                      {c.label}
                      {cert && (
                        <span className="block text-[11px] text-slate-400">
                          {cert.by_email?.split("@")[0] ?? "unknown"} ·{" "}
                          {new Date(cert.at).toLocaleDateString()}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <DashButton onClick={onPublish} disabled={!ready || busy}>
            {busy ? <DashSpinner /> : "Approve & Publish"}
          </DashButton>
          <DashButton variant="outline" onClick={onReturn} disabled={busy}>
            Send back to Draft
          </DashButton>
          {!ready && (
            <span className="text-xs text-slate-500">
              {TOTAL_CHECKS - passed} check{TOTAL_CHECKS - passed === 1 ? "" : "s"} left before
              publish
            </span>
          )}
        </div>
        {notice && (
          <p
            className={`text-xs ${
              notice.tone === "error" ? "text-red-600" : "text-emerald-700"
            }`}
          >
            {notice.text}
          </p>
        )}
      </div>
    </DashCard>
  );
}
