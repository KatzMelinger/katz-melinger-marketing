"use client";

/**
 * Multi-format batch generator.
 *
 * Type a topic, pick the formats, and Claude returns blog + LinkedIn +
 * Twitter + Facebook + Instagram + email + podcast in one shot. Each
 * format becomes its own draft in the library; the batch keeps them
 * grouped.
 *
 * Optional: pass an existing source-material id to repurpose that source
 * into the requested formats.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ContentNav } from "@/components/content-nav";
import { ContentTypeTabs } from "@/components/content-type-tabs";
import {
  DashCard,
  DashButton,
  DashInput,
  DashSelect,
  DashSpinner,
  DashPill,
} from "@/components/dashboard-ui";
import { CONTENT_LANGUAGES, type ContentLanguage } from "@/lib/content-language";
import {
  CONTENT_TYPE_FORMATS,
  CONTENT_TYPE_LABEL,
  readContentType,
} from "@/lib/content-types";
import { DEFAULT_PRACTICE_AREAS } from "@/lib/practice-areas";

type FormatKey =
  | "blog"
  | "linkedin"
  | "twitter"
  | "facebook"
  | "instagram"
  | "email"
  | "podcast"
  | "video_short"
  | "video_long";

const FORMATS: { id: FormatKey; label: string; hint: string }[] = [
  { id: "blog", label: "Blog post", hint: "800-1200 words, headings, CTA" },
  { id: "linkedin", label: "LinkedIn", hint: "350-450 words, hook + CTA" },
  { id: "twitter", label: "Twitter/X thread", hint: "5-7 tweets, numbered" },
  { id: "facebook", label: "Facebook", hint: "200-280 words, conversational" },
  { id: "instagram", label: "Instagram caption", hint: "150-220 words + hashtags" },
  { id: "email", label: "Email newsletter", hint: "Subject + preview + 250-400 word body" },
  { id: "podcast", label: "Podcast script", hint: "5-7 min solo, with speaker notes" },
  { id: "video_short", label: "Short video script", hint: "Reels/TikTok/Shorts, 30-60s shot list" },
  { id: "video_long", label: "YouTube video script", hint: "5-8 min, segments + B-roll cues" },
];

// Runtime presets for the long-form audio/video scripts. "Custom…" reveals a
// free-text field so any length can be entered.
const PODCAST_LENGTHS = ["5-10 minutes", "10-30 minutes", "30-60 minutes"];
const YOUTUBE_LENGTHS = ["3-5 minutes", "5-10 minutes", "10-20 minutes", "20-40 minutes"];

type Source = {
  id: string;
  source_type: string;
  filename: string | null;
  url: string | null;
  word_count: number;
};

type GeneratedDraft = {
  id: string;
  format: FormatKey;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
};

export default function BatchPage() {
  const searchParams = useSearchParams();
  const contentType = readContentType(searchParams);

  // Format chips visible on this page are scoped to the current content type
  // tab. Switching the top tab re-seeds the selection with that type's full
  // format set so each type batch defaults to "all formats for this type".
  const visibleFormats = useMemo(
    () => CONTENT_TYPE_FORMATS[contentType] as readonly FormatKey[],
    [contentType],
  );

  const [topic, setTopic] = useState("");
  const [practiceAreas, setPracticeAreas] = useState<string[]>([
    ...DEFAULT_PRACTICE_AREAS,
  ]);
  const [practiceArea, setPracticeArea] = useState<string>(
    DEFAULT_PRACTICE_AREAS[0],
  );
  const [tone, setTone] = useState("Professional, plain-spoken, accessible");
  const [language, setLanguage] = useState<ContentLanguage>("en");
  // Per-format target runtime for podcast + YouTube scripts.
  const [podcastLen, setPodcastLen] = useState("5-10 minutes");
  const [podcastCustom, setPodcastCustom] = useState("");
  const [youtubeLen, setYoutubeLen] = useState("5-10 minutes");
  const [youtubeCustom, setYoutubeCustom] = useState("");
  const [selected, setSelected] = useState<Set<FormatKey>>(
    () => new Set(visibleFormats as readonly FormatKey[]),
  );

  useEffect(() => {
    setSelected(new Set(visibleFormats as readonly FormatKey[]));
  }, [visibleFormats]);
  const [targetKeywords, setTargetKeywords] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<GeneratedDraft[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);

  // Optional context surfaced when the user landed here from the Trending
  // pages (Content Studio Intelligence or Social Ops Trends). We don't have
  // a dedicated "context" field on the batch generator, so we display the
  // background in a banner — and the topic itself already carries the angle.
  const [trendContext, setTrendContext] = useState<{
    angle: string | null;
    context: string | null;
    sourceDate: string | null;
  } | null>(null);

  useEffect(() => {
    fetch("/api/content/sources")
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []))
      .catch(() => {});
  }, []);

  // Live practice-area list (editable on /settings/practice-areas). Reconcile
  // the current selection so we never sit on an option that no longer exists.
  useEffect(() => {
    fetch("/api/practice-areas")
      .then((r) => r.json())
      .then((d) => {
        const list: string[] = Array.isArray(d?.areas) ? d.areas : [];
        if (list.length === 0) return;
        setPracticeAreas(list);
        setPracticeArea((cur) => (list.includes(cur) ? cur : list[0]));
      })
      .catch(() => {});
  }, []);

  // Pre-fill from URL params when arriving from a trend / keyword card.
  // Runs once on mount; intentionally not reactive to user typing.
  useEffect(() => {
    const qTopic = searchParams.get("topic");
    if (qTopic) setTopic(qTopic);

    const qPA = searchParams.get("practiceArea");
    if (qPA) {
      // Fuzzy match against the batch page's PRACTICE_AREAS list so labels
      // from the trend endpoint (e.g. "Wage & Hour Claims") map onto the
      // closest option here (e.g. "Wage & Hour").
      const match = practiceAreas.find(
        (p) =>
          p.toLowerCase() === qPA.toLowerCase() ||
          qPA.toLowerCase().includes(p.toLowerCase()) ||
          p.toLowerCase().includes(qPA.toLowerCase()),
      );
      if (match) setPracticeArea(match);
    }

    const qKeywords = searchParams.get("keywords");
    if (qKeywords) setTargetKeywords(qKeywords);

    const qFormats = searchParams.get("formats");
    if (qFormats) {
      const wanted = qFormats
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const validFormats = FORMATS.map((f) => f.id);
      const matched = wanted.filter((w): w is FormatKey =>
        validFormats.includes(w as FormatKey),
      );
      if (matched.length > 0) setSelected(new Set(matched));
    }

    const qAngle = searchParams.get("angle");
    const qContext = searchParams.get("context");
    const qSourceDate = searchParams.get("sourceDate");
    if (qAngle || qContext || qSourceDate) {
      setTrendContext({
        angle: qAngle,
        context: qContext,
        sourceDate: qSourceDate,
      });
    }
  }, []);

  const toggleFormat = (f: FormatKey) => {
    const next = new Set(selected);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    setSelected(next);
  };

  const generate = async () => {
    if (!topic.trim() || selected.size === 0) return;
    setGenerating(true);
    setError(null);
    setDrafts([]);
    setBatchId(null);
    try {
      // If we arrived from a trend, fold the angle + why-trending into the
      // topic so the existing /api/content/batches endpoint (which only
      // accepts `topic`) gets the full picture without a new field.
      const topicWithContext = trendContext
        ? [
            topic.trim(),
            trendContext.angle ? `Angle: ${trendContext.angle}` : null,
            trendContext.context ? `Why trending: ${trendContext.context}` : null,
            trendContext.sourceDate
              ? `Source dated: ${trendContext.sourceDate}`
              : null,
          ]
            .filter(Boolean)
            .join("\n\n")
        : topic.trim();

      const res = await fetch("/api/content/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topicWithContext,
          practiceArea,
          tone,
          language,
          formats: Array.from(selected),
          targetKeywords: targetKeywords
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          sourceId: sourceId || undefined,
          formatDurations: (() => {
            const d: Record<string, string> = {};
            if (selected.has("podcast")) {
              const v = podcastLen === "custom" ? podcastCustom.trim() : podcastLen;
              if (v) d.podcast = v;
            }
            if (selected.has("video_long")) {
              const v = youtubeLen === "custom" ? youtubeCustom.trim() : youtubeLen;
              if (v) d.video_long = v;
            }
            return d;
          })(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generation failed");
      setBatchId(data.batch_id);
      setDrafts(data.drafts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
    setGenerating(false);
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Content studio</h1>
        <p className="text-sm text-slate-600 mt-1">
          Type one topic, get every format at once.
        </p>
      </div>
      <ContentTypeTabs />
      <ContentNav />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {trendContext ? (
            <DashCard className="border-amber-200 bg-amber-50/40">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase tracking-wider text-amber-800">
                    From trending
                    {trendContext.sourceDate
                      ? ` · ${new Date(
                          trendContext.sourceDate + "T00:00:00Z",
                        ).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}`
                      : ""}
                  </div>
                  {trendContext.angle ? (
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      Angle: {trendContext.angle}
                    </p>
                  ) : null}
                  {trendContext.context ? (
                    <p className="mt-1 text-xs text-slate-700">
                      Why it&apos;s trending: {trendContext.context}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setTrendContext(null)}
                  className="shrink-0 text-xs text-slate-500 hover:text-slate-800"
                  aria-label="Dismiss trend context"
                >
                  ×
                </button>
              </div>
            </DashCard>
          ) : null}
          <DashCard>
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wider text-slate-500">
                Generating: {CONTENT_TYPE_LABEL[contentType]}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Topic</label>
                <DashInput
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. New York wage theft enforcement under the FLSA"
                  className="w-full mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700">Practice area</label>
                  <DashSelect
                    value={practiceArea}
                    onChange={(e) => setPracticeArea(e.target.value)}
                    className="w-full mt-1"
                  >
                    {practiceAreas.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </DashSelect>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Tone</label>
                  <DashInput
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="w-full mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Language</label>
                  <DashSelect
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as ContentLanguage)}
                    className="w-full mt-1"
                  >
                    {CONTENT_LANGUAGES.map((l) => (
                      <option key={l.id} value={l.id}>{l.label}</option>
                    ))}
                  </DashSelect>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">
                  Target SEO keywords (comma separated, optional)
                </label>
                <DashInput
                  value={targetKeywords}
                  onChange={(e) => setTargetKeywords(e.target.value)}
                  placeholder="wage theft attorney NYC, unpaid overtime lawyer"
                  className="w-full mt-1"
                />
              </div>

              {sources.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-slate-700">
                    Repurpose from saved source (optional)
                  </label>
                  <DashSelect
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                    className="w-full mt-1"
                  >
                    <option value="">— None (write from scratch) —</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.source_type}: {s.filename || s.url || `${s.word_count} words`}
                      </option>
                    ))}
                  </DashSelect>
                </div>
              )}
            </div>
          </DashCard>

          <DashCard>
            <div className="text-xs font-medium text-slate-700 mb-3">Formats to generate</div>
            <div className="grid sm:grid-cols-2 gap-2">
              {FORMATS.filter((f) => visibleFormats.includes(f.id)).map((f) => {
                const on = selected.has(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFormat(f.id)}
                    className={`text-left rounded-md border px-3 py-2 transition-colors ${
                      on
                        ? "border-brand bg-brand/5"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-3 h-3 rounded-sm border ${
                          on ? "bg-brand border-brand" : "border-slate-400"
                        }`}
                        aria-hidden
                      />
                      <span className="text-sm font-medium">{f.label}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 ml-5">{f.hint}</div>
                  </button>
                );
              })}
            </div>

            {(selected.has("podcast") || selected.has("video_long")) && (
              <div className="mt-4 grid sm:grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                {selected.has("podcast") && (
                  <LengthPicker
                    label="Podcast length"
                    presets={PODCAST_LENGTHS}
                    value={podcastLen}
                    onValue={setPodcastLen}
                    custom={podcastCustom}
                    onCustom={setPodcastCustom}
                  />
                )}
                {selected.has("video_long") && (
                  <LengthPicker
                    label="YouTube video length"
                    presets={YOUTUBE_LENGTHS}
                    value={youtubeLen}
                    onValue={setYoutubeLen}
                    custom={youtubeCustom}
                    onCustom={setYoutubeCustom}
                  />
                )}
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <DashButton
                onClick={generate}
                disabled={generating || !topic.trim() || selected.size === 0}
              >
                {generating ? <DashSpinner /> : "Generate all"}
              </DashButton>
              {selected.size > 0 && (
                <span className="text-xs text-slate-500">
                  {selected.size} format{selected.size === 1 ? "" : "s"} selected
                </span>
              )}
            </div>
            {error && <p className="text-sm text-red-700 mt-3">{error}</p>}
          </DashCard>
        </div>

        <DashCard>
          <div className="text-xs font-medium text-slate-700 mb-2">Tips</div>
          <ul className="text-xs text-slate-600 space-y-2 list-disc pl-4">
            <li>Pick a single sharp topic — narrow beats broad for cross-format repurposing.</li>
            <li>Add target keywords if you want SEO weight on the blog/email.</li>
            <li>Repurposing from a source preserves facts but rewrites style per format.</li>
            <li>Each draft also auto-saves to the library — you can edit, re-analyze, and export later.</li>
          </ul>
        </DashCard>
      </div>

      {drafts.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="text-sm font-medium flex items-center gap-2">
            Generated drafts
            <DashPill tone="emerald">{drafts.length}</DashPill>
            {batchId && (
              <Link
                href={`/content/drafts?batch=${batchId}`}
                className="text-xs text-brand hover:underline ml-2"
              >
                View in library →
              </Link>
            )}
          </div>
          {drafts.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftCard({ draft }: { draft: GeneratedDraft }) {
  const [open, setOpen] = useState(false);
  const subject = (draft.metadata?.subject as string | undefined) ?? null;
  const preview = (draft.metadata?.preview_text as string | undefined) ?? null;
  return (
    <DashCard>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <DashPill tone="blue">{draft.format}</DashPill>
          <span className="text-sm font-medium">
            {draft.title || subject || "(untitled)"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/content/drafts/${draft.id}/export-docx`}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-brand hover:text-brand"
          >
            ⬇ .docx
          </a>
          <Link
            href={`/content/drafts?id=${draft.id}`}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-brand hover:text-brand"
          >
            Open
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
          >
            {open ? "Hide" : "Preview"}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap font-mono leading-relaxed border-t border-slate-200 pt-3 max-h-96 overflow-y-auto">
          {subject && <div className="mb-2"><strong>Subject:</strong> {subject}</div>}
          {preview && <div className="mb-2 text-xs text-slate-500"><strong>Preview:</strong> {preview}</div>}
          {draft.body}
        </div>
      )}
    </DashCard>
  );
}

function LengthPicker({
  label,
  presets,
  value,
  onValue,
  custom,
  onCustom,
}: {
  label: string;
  presets: string[];
  value: string;
  onValue: (v: string) => void;
  custom: string;
  onCustom: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-700">{label}</label>
      <div className="mt-1 flex gap-2">
        <select
          value={value}
          onChange={(e) => onValue(e.target.value)}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
        >
          {presets.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {value === "custom" && (
          <input
            value={custom}
            onChange={(e) => onCustom(e.target.value)}
            placeholder="e.g. 45 minutes"
            className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        )}
      </div>
    </div>
  );
}
