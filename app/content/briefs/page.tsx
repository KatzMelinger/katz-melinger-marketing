"use client";

/**
 * Content Briefs — approved decisions, ready to produce.
 *
 * Sits between Decisions and the Production Board. Each row is a brief_suggestions
 * record whose decision was approved; the pre-filled Per-Page Brief is shown in
 * full. From here a brief can be:
 *   - sent to the Production Board (creates a content_pipeline item at "brief")
 *   - opened in the KM generator to produce a draft (?suggestion=<id>)
 *   - sent back to Decisions, or deleted.
 *
 * Reads/writes the shared store through the existing /api/seo/suggestions
 * endpoints and hands off to /api/content/pipeline.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { PipelineStageNav } from "@/components/pipeline-stage-nav";
import {
  DashButton,
  DashCard,
  DashPill,
  DashSpinner,
} from "@/components/dashboard-ui";
import {
  CONTENT_TYPE_LABEL,
  bucketForContentType,
  formatRelative,
  type Suggestion,
} from "@/lib/brief-suggestions";
import { validateBrief, type KMPerPageBrief } from "@/lib/km-content-system";

export default function BriefsPage() {
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    Record<string, { tone: "ok" | "warn"; msg: string }>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/seo/suggestions?status=approved", {
        cache: "no-store",
      });
      const json = await res.json();
      setRows(Array.isArray(json) ? json : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sendToProduction(s: Suggestion) {
    const brief = (s.suggested_brief ?? {}) as Partial<KMPerPageBrief>;
    const title = brief.h1 || brief.primaryKeyword || s.primary_keyword;
    const keywords = [brief.primaryKeyword || s.primary_keyword, ...(brief.secondaryKeywords ?? [])]
      .filter(Boolean)
      .join(", ");
    setBusyId(s.id);
    setNotice((m) => {
      const next = { ...m };
      delete next[s.id];
      return next;
    });
    try {
      // 1. Create (or find) the Production Board row, linked back to this
      //    suggestion so draft generation can advance the right row later.
      const res = await fetch("/api/content/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          keywords,
          status: "brief",
          bucket: bucketForContentType(s.content_type),
          contentType: "website",
          notes: brief.specialInstructions || s.reasoning || null,
          suggestionId: s.id,
        }),
      });
      // 409 = an item with this title already exists; treat as "already there".
      if (!res.ok && res.status !== 409) {
        const j = await res.json().catch(() => ({}));
        setNotice((m) => ({
          ...m,
          [s.id]: { tone: "warn", msg: j?.error || "Could not send to Production." },
        }));
        return;
      }
      setSent((m) => ({ ...m, [s.id]: true }));

      // 2. One-click draft: generate now ONLY if the brief is already complete,
      //    including the cannibalization confirmation. We never auto-confirm
      //    that gate for Diana — if anything's missing, the row stays at Brief
      //    and she finishes it in the generator (Generate draft button).
      const missing = validateBrief(brief);
      if (missing.length > 0) {
        setNotice((m) => ({
          ...m,
          [s.id]: {
            tone: "warn",
            msg: `Sent to Production. Finish the brief to auto-draft (${
              missing.length === 1 ? missing[0].toLowerCase() : `${missing.length} fields missing`
            }).`,
          },
        }));
        return;
      }

      setNotice((m) => ({ ...m, [s.id]: { tone: "ok", msg: "Generating draft…" } }));
      const gen = await fetch("/api/content/km-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...brief, language: "en", suggestionId: s.id }),
      });
      const gj = await gen.json().catch(() => ({}));
      if (!gen.ok) {
        setNotice((m) => ({
          ...m,
          [s.id]: {
            tone: "warn",
            msg: `Sent to Production, but draft generation failed: ${
              gj?.error || gen.status
            }. Use Generate draft to retry.`,
          },
        }));
        return;
      }

      // Draft saved + board auto-advanced to Draft via the km-draft write-back.
      // Mark the suggestion approved + linked, mirroring the generator flow.
      if (typeof gj.draft_id === "string") {
        fetch(`/api/seo/suggestions/${s.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "approved", approvedDraftId: gj.draft_id }),
        }).catch(() => {});
      }
      setNotice((m) => ({
        ...m,
        [s.id]: { tone: "ok", msg: "Draft generated — item is now at Draft on the board." },
      }));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function backToDecisions(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/seo/suggestions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this brief? This cannot be undone.")) return;
    setBusyId(id);
    try {
      await fetch(`/api/seo/suggestions/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Content / Briefs
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          Content Briefs
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Approved decisions with a ready-to-use Per-Page Brief. Send one to the
          Production Board, or open it in the generator to draft.
        </p>
      </div>

      <PipelineStageNav />

      {loading ? (
        <DashCard className="py-12 text-center text-sm text-slate-500">
          <DashSpinner /> Loading briefs…
        </DashCard>
      ) : rows.length === 0 ? (
        <DashCard className="space-y-3 py-12 text-center">
          <div className="text-3xl" aria-hidden>
            📋
          </div>
          <h3 className="text-lg font-semibold">No approved briefs yet</h3>
          <p className="mx-auto max-w-md text-sm text-slate-600">
            Approve a decision in{" "}
            <Link href="/content/decisions" className="text-[#185FA5] hover:underline">
              Content Decisions
            </Link>{" "}
            and it shows up here as a brief.
          </p>
        </DashCard>
      ) : (
        <div className="space-y-4">
          {rows.map((s) => (
            <BriefCard
              key={s.id}
              s={s}
              sent={!!sent[s.id]}
              busy={busyId === s.id}
              notice={notice[s.id]}
              onSend={() => sendToProduction(s)}
              onBack={() => backToDecisions(s.id)}
              onDelete={() => remove(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BriefCard({
  s,
  sent,
  busy,
  notice,
  onSend,
  onBack,
  onDelete,
}: {
  s: Suggestion;
  sent: boolean;
  busy: boolean;
  notice?: { tone: "ok" | "warn"; msg: string };
  onSend: () => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const b = s.suggested_brief ?? {};
  return (
    <DashCard className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">
              {b.h1 || b.primaryKeyword || s.primary_keyword}
            </h3>
            <DashPill tone="blue">
              {CONTENT_TYPE_LABEL[s.content_type] ?? s.content_type}
            </DashPill>
            <DashPill tone="neutral">{s.practice_area}</DashPill>
            {s.approved_draft_id && <DashPill tone="emerald">Draft generated</DashPill>}
          </div>
          {b.urlSlug && (
            <p className="mt-0.5 font-mono text-xs text-slate-500">{b.urlSlug}</p>
          )}
        </div>
        <div className="shrink-0 text-right text-[11px] text-slate-400">
          approved {formatRelative(s.decided_at ?? s.updated_at)}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Field label="Primary keyword" value={b.primaryKeyword || s.primary_keyword} />
        <Field
          label="Secondary keywords"
          value={(b.secondaryKeywords ?? []).join(", ") || "—"}
        />
        <Field label="Meta title" value={b.metaTitle} />
        <Field label="Search intent" value={b.searchIntent} />
        <Field
          label="Pillar link"
          value={b.internalPillarLink}
          mono
          className="sm:col-span-2"
        />
        <Field label="Meta description" value={b.metaDescription} className="sm:col-span-2" />
      </dl>

      {(b.faqQuestions?.length || b.statutes?.length || b.specialInstructions) && (
        <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
          {b.statutes && b.statutes.length > 0 && (
            <ListBlock label="Statutes to cite / verify" items={b.statutes} />
          )}
          {b.faqQuestions && b.faqQuestions.length > 0 && (
            <ListBlock label="FAQ questions" items={b.faqQuestions} />
          )}
          {b.specialInstructions && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Special instructions
              </p>
              <p className="mt-0.5 text-slate-700">{b.specialInstructions}</p>
            </div>
          )}
        </div>
      )}

      {b.cannibalizationNotes && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {b.cannibalizationNotes}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {sent ? (
          <>
            <DashPill tone="emerald">Sent to Production ✓</DashPill>
            <Link
              href="/content/pipeline"
              className="text-xs font-medium text-[#185FA5] hover:underline"
            >
              Open Production Board →
            </Link>
          </>
        ) : (
          <DashButton onClick={onSend} disabled={busy}>
            {busy ? <DashSpinner /> : "Send to Production →"}
          </DashButton>
        )}
        <Link
          href={`/content/km?suggestion=${s.id}`}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-[#185FA5] hover:text-[#185FA5]"
        >
          Generate draft
        </Link>
        <DashButton variant="ghost" onClick={onBack} disabled={busy}>
          Back to Decisions
        </DashButton>
        <DashButton variant="danger" onClick={onDelete} disabled={busy}>
          Delete
        </DashButton>
      </div>

      {notice && (
        <p
          className={`rounded-md border p-2 text-xs ${
            notice.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {notice.msg}
        </p>
      )}
    </DashCard>
  );
}

function Field({
  label,
  value,
  mono = false,
  className = "",
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className={`mt-0.5 text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

function ListBlock({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <ul className="mt-0.5 list-disc pl-5 text-slate-700">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
