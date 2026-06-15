"use client";

/**
 * Source-material upload + review.
 *
 * Three input modes:
 *   - Paste raw text
 *   - Submit a URL (we fetch + strip HTML)
 *   - Upload a file (PDF or .txt)
 *
 * Each source gets an AI review (strengths, gaps, suggestions, repurpose
 * ideas). From here you can jump straight to the multi-format generator
 * with the source pre-selected.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ContentNav } from "@/components/content-nav";
import {
  DashCard,
  DashButton,
  DashInput,
  DashPill,
  DashSpinner,
} from "@/components/dashboard-ui";

type SourceReview = {
  strengths: string[];
  weaknesses: string[];
  audience: string;
  primary_message: string;
  suggestions: string[];
  repurpose_ideas: { format: string; angle: string }[];
};

type Source = {
  id: string;
  source_type: "text" | "url" | "file";
  filename: string | null;
  url: string | null;
  word_count: number;
  notes: string | null;
  review_summary: SourceReview | null;
  created_at: string;
};

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"text" | "url" | "file">("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content/sources");
      const data = await res.json();
      setSources(data.sources ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let res: Response;
      if (mode === "file") {
        if (!file) throw new Error("Pick a file first");
        const fd = new FormData();
        fd.append("file", file);
        if (notes) fd.append("notes", notes);
        res = await fetch("/api/content/sources", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/content/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_type: mode,
            text: mode === "text" ? text : undefined,
            url: mode === "url" ? url : undefined,
            notes: notes || undefined,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      setText("");
      setUrl("");
      setFile(null);
      setNotes("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
    setSubmitting(false);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this source?")) return;
    await fetch(`/api/content/sources/${id}`, { method: "DELETE" });
    refresh();
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Content studio</h1>
        <p className="text-sm text-slate-600 mt-1">
          Upload existing content for AI review and one-click repurposing.
        </p>
      </div>
      <ContentNav />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <DashCard>
            <div className="flex gap-1 mb-3 border-b border-slate-200 -mx-5 -mt-5 px-5 pt-2">
              {(["text", "url", "file"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 -mb-[1px] capitalize ${
                    mode === m
                      ? "border-brand text-brand"
                      : "border-transparent text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {mode === "text" && (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste a draft, an article, an email, anything…"
                rows={10}
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            )}
            {mode === "url" && (
              <DashInput
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://… (we fetch and strip HTML)"
                className="w-full"
              />
            )}
            {mode === "file" && (
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,.rtf,.html,.htm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block text-sm"
              />
            )}
            <div className="mt-3">
              <label className="text-xs font-medium text-slate-700">Notes (optional)</label>
              <DashInput
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What's the goal? E.g. 'turn into LinkedIn pack for next week'"
                className="w-full mt-1"
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <DashButton onClick={submit} disabled={submitting}>
                {submitting ? <DashSpinner /> : "Upload + review"}
              </DashButton>
              {error && <span className="text-sm text-red-700">{error}</span>}
            </div>
          </DashCard>
        </div>
        <DashCard>
          <div className="text-xs font-medium text-slate-700 mb-2">What you get</div>
          <ul className="text-xs text-slate-600 space-y-2 list-disc pl-4">
            <li>Strengths and weaknesses of the source</li>
            <li>Inferred audience + core message</li>
            <li>Concrete edits to improve the original</li>
            <li>Repurpose ideas (per format)</li>
            <li>One-click &ldquo;send to multi-format generator&rdquo;</li>
          </ul>
        </DashCard>
      </div>

      <div className="mt-6 space-y-3">
        <div className="text-sm font-medium">
          Saved sources {loading && <DashSpinner />}
        </div>
        {!loading && sources.length === 0 && (
          <DashCard className="text-center text-sm text-slate-500">No sources yet.</DashCard>
        )}
        {sources.map((s) => (
          <SourceCard key={s.id} source={s} onDelete={() => remove(s.id)} />
        ))}
      </div>
    </div>
  );
}

function SourceCard({ source, onDelete }: { source: Source; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const r = source.review_summary;
  return (
    <DashCard>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <DashPill tone="blue">{source.source_type}</DashPill>
            <span className="text-sm font-medium truncate max-w-md">
              {source.filename || source.url || `Pasted text (${source.word_count} words)`}
            </span>
          </div>
          {source.notes && <div className="text-xs text-slate-500 mt-1">{source.notes}</div>}
          {r && <div className="text-xs text-slate-600 mt-1 italic">{r.primary_message}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/content/batch?source=${source.id}`}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-brand hover:text-brand"
          >
            Repurpose →
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-slate-400"
          >
            {open ? "Hide" : "Review"}
          </button>
          <button
            onClick={onDelete}
            className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>
      {open && r && (
        <div className="mt-3 grid md:grid-cols-2 gap-4 border-t border-slate-200 pt-3 text-sm">
          <div>
            <div className="text-xs font-medium text-emerald-700 mb-1">Strengths</div>
            <ul className="space-y-1 text-xs list-disc pl-4">
              {r.strengths.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
            <div className="text-xs font-medium text-amber-700 mb-1 mt-3">Weaknesses</div>
            <ul className="space-y-1 text-xs list-disc pl-4">
              {r.weaknesses.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-700 mb-1">Audience</div>
            <div className="text-xs text-slate-600">{r.audience}</div>
            <div className="text-xs font-medium text-slate-700 mt-3 mb-1">Suggestions</div>
            <ul className="space-y-1 text-xs list-disc pl-4">
              {r.suggestions.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
            <div className="text-xs font-medium text-slate-700 mt-3 mb-1">Repurpose ideas</div>
            <ul className="space-y-1 text-xs">
              {r.repurpose_ideas.map((x, i) => (
                <li key={i}>
                  <DashPill tone="violet">{x.format}</DashPill> {x.angle}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </DashCard>
  );
}
