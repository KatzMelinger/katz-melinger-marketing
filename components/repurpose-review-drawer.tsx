"use client";

/**
 * Repurpose review drawer — the human-in-the-loop step the old fire-and-forget
 * "Generate 3 posts" action skipped.
 *
 * It shows every variation the repurpose run produced in one place. For each
 * one the user can edit the copy, pick the channel, set the date/time, or
 * discard it. "Schedule selected" sends only the kept posts to
 * /api/content-production/repurpose/schedule — generation and scheduling are
 * two deliberate steps, so nothing is posted sight-unseen.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

import { repurposeFormatMeta } from "@/lib/repurpose-formats";
import { SocialChecklistChips } from "@/components/social-checklist-chips";
// Type-only import — erased at build, so no server code reaches the client bundle.
import type { SocialChecklist, SocialSource } from "@/lib/content-social";

export type RepurposeDraft = {
  id: string;
  format: string;
  title: string | null;
  body: string;
  metadata?: Record<string, unknown>;
};

/** Pull the source tag the generator stored on the draft (Rule 1). */
function readSource(meta?: Record<string, unknown>): SocialSource | null {
  const s = meta?.social_source;
  if (s && typeof s === "object" && "title" in s) return s as SocialSource;
  return null;
}

/** Pull the advisory Rule-10 checklist the generator stored on the draft. */
function readChecklist(meta?: Record<string, unknown>): SocialChecklist | null {
  const c = meta?.social_checklist;
  if (c && typeof c === "object" && "withinCaps" in c) return c as SocialChecklist;
  return null;
}

/** Kick off a repurpose run. Both the Repurpose panel and the Optimize cards
 *  use this, each managing their own busy/error state. */
export async function requestRepurpose(input: {
  url?: string | null;
  title?: string | null;
  practiceArea?: string | null;
  keywords?: string[];
}): Promise<{ ok: boolean; topic?: string; drafts?: RepurposeDraft[]; error?: string }> {
  try {
    const res = await fetch("/api/content-production/repurpose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const j = await res.json();
    if (!res.ok) return { ok: false, error: j?.error || "Generation failed." };
    return { ok: true, topic: j.topic, drafts: j.drafts as RepurposeDraft[] };
  } catch {
    return { ok: false, error: "Generation failed." };
  }
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  twitter: "X / Twitter",
  tiktok: "TikTok",
  youtube: "YouTube",
  gmb: "Google Business",
};

type Slide = { n: number; headline: string; url: string };

type Row = {
  draftId: string;
  format: string;
  label: string;
  kind: "caption" | "script";
  body: string;
  /** Original generated script (carousel) — kept so slides can be (re)generated
   *  even after `body` is replaced with the posting caption. */
  script?: string;
  platform: string;
  platformOptions: string[];
  date: string; // yyyy-mm-dd (local)
  time: string; // HH:mm (local)
  keep: boolean;
  // Source tag + advisory quality checklist from the generator (Rules 1 + 10).
  source?: SocialSource | null;
  checklist?: SocialChecklist | null;
  // Carousel slide images, once generated.
  slides?: Slide[];
  mediaUrls?: string[];
  genBusy?: boolean;
  genMsg?: string | null;
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Stagger kept posts across the next business days at 9:00am local by default. */
function buildRows(drafts: RepurposeDraft[]): Row[] {
  const cursor = new Date();
  return drafts.map((d) => {
    const meta = repurposeFormatMeta(d.format);
    const platforms = meta?.platforms ?? ["linkedin"];
    do {
      cursor.setDate(cursor.getDate() + 1);
    } while (cursor.getDay() === 0 || cursor.getDay() === 6);
    return {
      draftId: d.id,
      format: d.format,
      label: meta?.label ?? d.format,
      kind: meta?.kind ?? "caption",
      body: d.body,
      script: d.format === "carousel" ? d.body : undefined,
      platform: platforms[0],
      platformOptions: platforms,
      date: ymd(cursor),
      time: "09:00",
      keep: true,
      source: readSource(d.metadata),
      checklist: readChecklist(d.metadata),
    };
  });
}

export function RepurposeReviewDrawer({
  topic,
  drafts,
  onClose,
  onScheduled,
}: {
  topic: string;
  drafts: RepurposeDraft[];
  onClose: () => void;
  onScheduled?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => buildRows(drafts));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn"; text: string; recorded: boolean } | null>(
    null,
  );
  // Per-post Ayrshare rejection reasons, keyed by draftId — shown inline on each
  // post so a rejection is never invisible.
  const [postErrors, setPostErrors] = useState<Map<string, string>>(new Map());

  const [genAllBusy, setGenAllBusy] = useState(false);

  const keepCount = useMemo(() => rows.filter((r) => r.keep && r.body.trim()).length, [rows]);
  // Kept carousels that still need slide images to be post-ready.
  const carouselsNeedingImages = useMemo(
    () => rows.filter((r) => r.format === "carousel" && r.keep && !r.slides?.length).length,
    [rows],
  );

  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  // Carousel: turn the slide script into post-ready slide images. On success the
  // post text becomes the caption and the slides ride along as media.
  const generateSlides = async (i: number) => {
    const row = rows[i];
    patch(i, { genBusy: true, genMsg: null });
    try {
      const res = await fetch("/api/content-production/repurpose/carousel-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: row.draftId, script: row.script ?? row.body }),
      });
      const j = await res.json();
      if (!res.ok) {
        patch(i, { genBusy: false, genMsg: j?.error || "Slide generation failed." });
        return;
      }
      patch(i, {
        genBusy: false,
        slides: j.slides as Slide[],
        mediaUrls: j.urls as string[],
        body: (j.caption as string)?.trim() || row.body,
        genMsg: j.message || null,
      });
    } catch {
      patch(i, { genBusy: false, genMsg: "Slide generation failed." });
    }
  };

  // Generate slide images for every kept carousel that doesn't have them yet.
  const generateAllSlides = async () => {
    const idxs = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.format === "carousel" && r.keep && !r.slides?.length)
      .map(({ i }) => i);
    if (!idxs.length) return;
    setGenAllBusy(true);
    try {
      await Promise.all(idxs.map((i) => generateSlides(i)));
    } finally {
      setGenAllBusy(false);
    }
  };

  const schedule = async () => {
    const kept = rows.filter((r) => r.keep && r.body.trim());
    if (!kept.length) return;
    setBusy(true);
    setResult(null);
    setPostErrors(new Map());
    try {
      const posts = kept.map((r) => ({
        draftId: r.draftId,
        format: r.format,
        platform: r.platform,
        body: r.body,
        mediaUrls: r.mediaUrls ?? [],
        // Local date+time → UTC ISO for Ayrshare / scheduled_at.
        scheduleDate: new Date(`${r.date}T${r.time}`).toISOString(),
      }));
      const res = await fetch("/api/content-production/repurpose/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts }),
      });
      const j = await res.json();
      if (!res.ok) {
        setResult({ tone: "warn", text: j?.error || "Scheduling failed.", recorded: false });
        return;
      }
      // Surface each rejection reason on its post so failures aren't invisible.
      const errs = new Map<string, string>();
      for (const r of (j.results ?? []) as Array<{
        draftId?: string | null;
        status?: string;
        error?: string;
      }>) {
        if (r.draftId && r.status === "failed") errs.set(r.draftId, r.error || "Rejected by Ayrshare.");
      }
      setPostErrors(errs);
      const failed = (j.failed ?? 0) as number;
      setResult({
        tone: failed > 0 ? "warn" : "ok",
        text: j.message || "Scheduled.",
        recorded: !!j.ok,
      });
      onScheduled?.();
    } catch {
      setResult({ tone: "warn", text: "Scheduling failed.", recorded: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Review &amp; schedule social posts</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              From <span className="font-medium text-slate-700">{topic}</span> · {rows.length}{" "}
              variation(s). Edit, pick channels and times, then schedule the ones you want.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-500 hover:border-brand hover:text-brand"
          >
            Close
          </button>
        </header>

        {carouselsNeedingImages > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-brand/20 bg-brand/5 px-5 py-2.5">
            <span className="text-sm text-slate-700">
              🖼️ <strong>{carouselsNeedingImages}</strong> carousel
              {carouselsNeedingImages > 1 ? "s" : ""} still{" "}
              {carouselsNeedingImages > 1 ? "need" : "needs"} slide images to be post-ready.
            </span>
            <button
              onClick={generateAllSlides}
              disabled={genAllBusy}
              className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {genAllBusy ? "Generating slide images…" : "Generate all slide images"}
            </button>
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {rows.map((r, i) => (
            <div
              key={r.draftId}
              className={`rounded-lg border p-3 ${
                r.keep ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-60"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">
                    {r.label}
                  </span>
                  {r.kind === "script" && (
                    <span
                      className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] uppercase text-amber-700"
                      title="A production script (slides / shot list). The text below is what gets posted as the caption — add media in your channel before it goes live."
                    >
                      script
                    </span>
                  )}
                  {r.source && (
                    <span
                      className="max-w-[220px] truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                      title={`Generated from this ${r.source.kind.replace("_", " ")}: ${r.source.title}`}
                    >
                      ↳ from {r.source.kind.replace("_", " ")}: {r.source.title}
                    </span>
                  )}
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={r.keep}
                    onChange={(e) => patch(i, { keep: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[#185FA5]"
                  />
                  {r.keep ? "Scheduling" : "Skipped"}
                </label>
              </div>

              <textarea
                value={r.body}
                onChange={(e) => patch(i, { body: e.target.value })}
                disabled={!r.keep}
                rows={Math.min(14, Math.max(5, Math.ceil(r.body.length / 70)))}
                className="w-full resize-y rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-800 focus:border-brand focus:outline-none disabled:bg-slate-100"
              />

              {/* Advisory quality checklist (Rule 10 + Rule 8). Length caps are
                  enforced at generation; these flags inform the reviewer. */}
              {r.checklist && (
                <SocialChecklistChips checklist={r.checklist} className="mt-1.5" />
              )}

              {r.format === "carousel" && (
                <div
                  className={`mt-2 rounded-md border p-2.5 ${
                    r.slides?.length ? "border-slate-200 bg-slate-50" : "border-brand/40 bg-brand/5"
                  }`}
                >
                  {r.slides?.length ? (
                    <>
                      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
                        <span aria-hidden>✓</span> {r.slides.length} slide image
                        {r.slides.length > 1 ? "s" : ""} attached — this posts as a carousel.
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {r.slides.map((s) => (
                          <a
                            key={s.url}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            title={`Slide ${s.n}: ${s.headline}`}
                            className="shrink-0"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={s.url}
                              alt={`Slide ${s.n}`}
                              className="h-28 w-[90px] rounded-md border border-slate-200 object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start gap-1.5 text-[12px] text-slate-700">
                      <span aria-hidden>🖼️</span>
                      <span>
                        <strong>Make it post-ready.</strong> Turn this script into on-brand slide
                        images — the post text becomes the caption.
                      </span>
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => generateSlides(i)}
                      disabled={!r.keep || r.genBusy}
                      className={
                        r.slides?.length
                          ? "rounded border border-slate-300 px-2.5 py-1.5 text-[12px] font-medium text-slate-700 hover:border-brand hover:text-brand disabled:opacity-50"
                          : "rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                      }
                    >
                      {r.genBusy
                        ? "Generating slide images…"
                        : r.slides?.length
                          ? "Regenerate images"
                          : "Generate slide images →"}
                    </button>
                    {r.genMsg && <span className="text-[11px] text-slate-500">{r.genMsg}</span>}
                  </div>
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1 text-slate-500">
                  Channel
                  <select
                    value={r.platform}
                    onChange={(e) => patch(i, { platform: e.target.value })}
                    disabled={!r.keep}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                  >
                    {r.platformOptions.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_LABEL[p] ?? p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1 text-slate-500">
                  Date
                  <input
                    type="date"
                    value={r.date}
                    onChange={(e) => patch(i, { date: e.target.value })}
                    disabled={!r.keep}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-500">
                  Time
                  <input
                    type="time"
                    value={r.time}
                    onChange={(e) => patch(i, { time: e.target.value })}
                    disabled={!r.keep}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
                  />
                </label>
                <span className="ml-auto text-[11px] text-slate-400">
                  {r.body.trim().length} chars
                </span>
              </div>

              {/* Instagram can't post text-only — Ayrshare will reject it without media. */}
              {r.keep && r.platform === "instagram" && !r.mediaUrls?.length && (
                <p className="mt-1.5 text-[11px] text-amber-700">
                  Instagram needs an image.{" "}
                  {r.format === "carousel"
                    ? "Generate slide images above, "
                    : "Add media or pick another channel, "}
                  or this post will be rejected.
                </p>
              )}

              {/* Why a post was rejected, surfaced from the schedule response. */}
              {postErrors.get(r.draftId) && (
                <p className="mt-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  Rejected: {postErrors.get(r.draftId)}
                </p>
              )}
            </div>
          ))}
        </div>

        <footer className="border-t border-slate-200 px-5 py-3">
          {result && (
            <p
              className={`mb-2 rounded-md border px-3 py-2 text-sm ${
                result.tone === "warn"
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-emerald-300 bg-emerald-50 text-emerald-800"
              }`}
            >
              {result.text}{" "}
              {result.recorded && (
                <Link href="/social/content-calendar" className="font-medium underline">
                  Open the Content Calendar →
                </Link>
              )}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">
              {keepCount} of {rows.length} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
              >
                {result?.tone === "ok" ? "Done" : "Cancel"}
              </button>
              <button
                onClick={schedule}
                disabled={busy || keepCount === 0}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Scheduling…" : `Schedule selected (${keepCount}) →`}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
