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
 * "Approve & Publish" stays disabled until every check passes, then promotes
 * the item to Published. "Send back to Draft" returns it for more work.
 *
 * The self-cert toggles are an in-session gate — they force the review ritual
 * before publish; the publish/return action itself is what persists.
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

/** Checks the editor self-certifies before publish (session state). */
const MANUAL_CHECKS: { key: string; label: string }[] = [
  { key: "legal", label: "Legal / attorney review complete" },
  { key: "schema", label: "Schema markup added" },
  { key: "links", label: "Internal links added & verified" },
  { key: "citations", label: "Sources & citations verified" },
  { key: "proof", label: "Proofread & on-brand" },
];

const TOTAL_CHECKS = AUTO_CHECKS.length + MANUAL_CHECKS.length;

export default function PublishingQAPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // itemId → { manualCheckKey: true }
  const [certs, setCerts] = useState<Record<number, Record<string, boolean>>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

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

  function toggle(itemId: number, key: string) {
    setCerts((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [key]: !prev[itemId]?.[key] },
    }));
  }

  async function move(id: number, status: "published" | "draft") {
    setBusyId(id);
    try {
      await fetch(`/api/content/pipeline/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
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
            <Link href="/content/pipeline" className="text-[#185FA5] hover:underline">
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
              certs={certs[item.id] ?? {}}
              busy={busyId === item.id}
              onToggle={(key) => toggle(item.id, key)}
              onPublish={() => move(item.id, "published")}
              onReturn={() => move(item.id, "draft")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QACard({
  item,
  certs,
  busy,
  onToggle,
  onPublish,
  onReturn,
}: {
  item: ReviewItem;
  certs: Record<string, boolean>;
  busy: boolean;
  onToggle: (key: string) => void;
  onPublish: () => void;
  onReturn: () => void;
}) {
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
                className="hover:text-[#185FA5] hover:underline"
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
              const ok = !!certs[c.key];
              return (
                <li key={c.key}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ok}
                      onChange={() => onToggle(c.key)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#185FA5] focus:ring-[#185FA5]/30"
                    />
                    <span className={ok ? "text-slate-700" : "text-slate-500"}>{c.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
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
    </DashCard>
  );
}
