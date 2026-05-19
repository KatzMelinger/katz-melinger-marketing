"use client";

/**
 * <KMContentGenerator /> — the full Per-Page Brief generator.
 *
 * Loads the brief form, calls /api/content/km-draft on submit, shows the
 * generated content, and links to /content/drafts/[id] for editing.
 *
 * Mounted on both /content/km and /seo/generator.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  KMPerPageBriefForm,
  emptyBrief,
  validateBrief,
  type KMBriefFormValue,
} from "@/components/km-per-page-brief-form";
import {
  KM_CONTENT_TYPE_LABELS,
  type KMPerPageBrief,
} from "@/lib/km-content-system";

export function KMContentGenerator() {
  const searchParams = useSearchParams();
  const suggestionId = searchParams?.get("suggestion") ?? null;
  const [brief, setBrief] = useState<KMBriefFormValue>(emptyBrief());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [output, setOutput] = useState<string>("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);

  // Pre-fill from an approved (or pending) suggestion when ?suggestion=... is set.
  useEffect(() => {
    if (!suggestionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/seo/suggestions/${suggestionId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const seeded = data?.suggested_brief as Partial<KMPerPageBrief> | undefined;
        if (seeded && typeof seeded === "object") {
          setBrief({ ...emptyBrief(), ...seeded });
          setPrefillNotice(
            `Brief pre-filled from suggestion "${data.cluster_name ?? data.primary_keyword ?? ""}". You can still edit any field before generating.`,
          );
        }
      } catch {
        // ignore — manual entry still works
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suggestionId]);

  const errors = validateBrief(brief);
  const ready = errors.length === 0;

  const handleGenerate = async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    setServerErrors([]);
    setOutput("");
    setDraftId(null);
    try {
      const res = await fetch("/api/content/km-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(brief),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(data?.details)) setServerErrors(data.details);
        throw new Error(data?.error || `Generation failed (${res.status})`);
      }
      setOutput(typeof data.content === "string" ? data.content : "");
      const newDraftId = typeof data.draft_id === "string" ? data.draft_id : null;
      setDraftId(newDraftId);

      // If this came from a suggestion, mark it approved + link the draft so
      // the suggestions queue stops showing it as pending.
      if (suggestionId && newDraftId) {
        fetch(`/api/seo/suggestions/${suggestionId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "approved", approvedDraftId: newDraftId }),
        }).catch(() => {
          /* non-blocking — content is already saved */
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setBrief(emptyBrief());
    setOutput("");
    setDraftId(null);
    setError(null);
    setServerErrors([]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
      <section className="space-y-4">
        <div>
          <h2 className="font-semibold">Per-Page Content Brief</h2>
          <p className="text-xs opacity-70 mt-1">
            Every field below is required before the AI will generate.
            Content runs against the KM AI System Prompt — voice, structure,
            and AEO rules are enforced server-side.
          </p>
        </div>

        {prefillNotice && (
          <div className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-md p-3">
            {prefillNotice}
          </div>
        )}

        <KMPerPageBriefForm value={brief} onChange={setBrief} />

        <div className="sticky bottom-0 bg-white/95 dark:bg-black/40 backdrop-blur border-t border-black/10 dark:border-white/10 py-3 -mx-1 px-1 flex items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!ready || loading}
            className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
              !ready || loading
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-[#185FA5] text-white hover:bg-[#0f4d8c]"
            }`}
          >
            {loading
              ? "Generating…"
              : ready
                ? `Generate ${KM_CONTENT_TYPE_LABELS[(brief.contentType ?? "blog_post") as KMPerPageBrief["contentType"]]}`
                : "Complete the brief to enable Generate"}
          </button>
          {(output || error) && (
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-2 rounded-md text-sm border border-black/15 dark:border-white/15 hover:bg-black/5"
            >
              Start over
            </button>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Output</h2>
          {draftId && (
            <Link
              href={`/content/drafts/${draftId}`}
              className="text-xs text-[#185FA5] hover:underline"
            >
              Open in Drafts →
            </Link>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-700 dark:text-red-300 bg-red-500/10 p-3 rounded-md space-y-2">
            <div>{error}</div>
            {serverErrors.length > 0 && (
              <ul className="list-disc pl-5 text-xs">
                {serverErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!output && !error && !loading && (
          <div className="border border-dashed border-black/15 dark:border-white/15 rounded-md p-6 text-sm opacity-60 text-center">
            Generated content appears here.
          </div>
        )}

        {loading && (
          <div className="border border-dashed border-black/15 dark:border-white/15 rounded-md p-6 text-sm opacity-70 text-center">
            Running KM system prompt against Anthropic… long-form content
            takes 20–60 seconds.
          </div>
        )}

        {output && (
          <pre className="text-xs whitespace-pre-wrap bg-foreground/5 rounded-md p-4 font-sans max-h-[80vh] overflow-y-auto">
            {output}
          </pre>
        )}
      </section>
    </div>
  );
}
