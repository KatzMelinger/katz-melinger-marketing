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

import { useEffect, useState } from "react";
import Link from "next/link";
import { ContentNav } from "@/components/content-nav";
import {
  DashCard,
  DashButton,
  DashInput,
  DashSelect,
  DashSpinner,
  DashPill,
} from "@/components/dashboard-ui";

type FormatKey = "blog" | "linkedin" | "twitter" | "facebook" | "instagram" | "email" | "podcast";

const FORMATS: { id: FormatKey; label: string; hint: string }[] = [
  { id: "blog", label: "Blog post", hint: "800-1200 words, headings, CTA" },
  { id: "linkedin", label: "LinkedIn", hint: "350-450 words, hook + CTA" },
  { id: "twitter", label: "Twitter/X thread", hint: "5-7 tweets, numbered" },
  { id: "facebook", label: "Facebook", hint: "200-280 words, conversational" },
  { id: "instagram", label: "Instagram caption", hint: "150-220 words + hashtags" },
  { id: "email", label: "Email newsletter", hint: "Subject + preview + 250-400 word body" },
  { id: "podcast", label: "Podcast script", hint: "5-7 min solo, with speaker notes" },
];

const PRACTICE_AREAS = [
  "General",
  "Wage & Hour",
  "Discrimination",
  "Class Action",
  "Judgment Enforcement",
  "Severance",
];

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
  const [topic, setTopic] = useState("");
  const [practiceArea, setPracticeArea] = useState("General");
  const [tone, setTone] = useState("Professional, plain-spoken, accessible");
  const [selected, setSelected] = useState<Set<FormatKey>>(
    new Set(["blog", "linkedin", "twitter"]),
  );
  const [targetKeywords, setTargetKeywords] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<GeneratedDraft[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/content/sources")
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []))
      .catch(() => {});
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
      const res = await fetch("/api/content/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          practiceArea,
          tone,
          formats: Array.from(selected),
          targetKeywords: targetKeywords
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          sourceId: sourceId || undefined,
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
      <ContentNav />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <DashCard>
            <div className="space-y-3">
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
                    {PRACTICE_AREAS.map((p) => (
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
              {FORMATS.map((f) => {
                const on = selected.has(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFormat(f.id)}
                    className={`text-left rounded-md border px-3 py-2 transition-colors ${
                      on
                        ? "border-[#185FA5] bg-[#185FA5]/5"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-3 h-3 rounded-sm border ${
                          on ? "bg-[#185FA5] border-[#185FA5]" : "border-slate-400"
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
                className="text-xs text-[#185FA5] hover:underline ml-2"
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
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5]"
          >
            ⬇ .docx
          </a>
          <Link
            href={`/content/drafts?id=${draft.id}`}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-[#185FA5] hover:text-[#185FA5]"
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
