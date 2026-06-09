"use client";

/**
 * <KMContentGenerator /> — the full Per-Page Brief generator.
 *
 * Loads the brief form, calls /api/content/km-draft on submit, shows the
 * generated content, and links to /content/drafts/[id] for editing.
 *
 * Now used only for the /seo/generator deep-link pre-fill path (?packetId= /
 * ?suggestion=), where the richer research fields are mapped onto the brief.
 * The default generator surface is the unified ContentGeneratorLauncher.
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
import { CONTENT_LANGUAGES, type ContentLanguage } from "@/lib/content-language";

export function KMContentGenerator() {
  const searchParams = useSearchParams();
  const suggestionId = searchParams?.get("suggestion") ?? null;
  const packetId = searchParams?.get("packetId") ?? null;
  const [brief, setBrief] = useState<KMBriefFormValue>(emptyBrief());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [output, setOutput] = useState<string>("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  const [language, setLanguage] = useState<ContentLanguage>("en");

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

  // Pre-fill from a Research Packet when ?packetId=... is set. Maps the
  // packet's synthesized fields onto the brief so Diana isn't filling
  // everything by hand.
  useEffect(() => {
    if (!packetId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/content/research/packet?id=${packetId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const packet = data?.packet;
        if (!packet || typeof packet !== "object") return;

        const paStr = String(packet.practice_area ?? "").toLowerCase();
        const practiceArea =
          paStr.includes("collection") || paStr.includes("judgment")
            ? "collections"
            : "employment";

        const faqQuestions = Array.isArray(packet.suggested_faqs)
          ? packet.suggested_faqs
              .map((f: { question?: string }) => f.question)
              .filter((q: unknown): q is string => typeof q === "string")
          : [];

        const legalLines = Array.isArray(packet.legal_sources_found)
          ? packet.legal_sources_found
              .map((s: { name?: string; url?: string }) => `${s.name} (${s.url})`)
              .slice(0, 10)
          : [];
        const angles = Array.isArray(packet.suggested_angles)
          ? packet.suggested_angles
          : [];

        // Block 4 (cannibalization) auto-fill from the packet's existing
        // site coverage — "link, don't redefine."
        const coverage = Array.isArray(packet.existing_coverage)
          ? (packet.existing_coverage as {
              term: string;
              pages: { url: string; title: string | null }[];
            }[])
          : [];
        const cannibalizationNotes =
          coverage.length > 0
            ? coverage
                .map(
                  (c) =>
                    `"${c.term}" already covered → link to ${c.pages[0]?.url ?? ""} instead of redefining.`,
                )
                .join("\n")
            : "Site inventory checked — no existing pages overlap this topic's terms.";

        const instructions = [
          packet.legal_review_required
            ? "⚠ ATTORNEY REVIEW REQUIRED before publishing."
            : "",
          `Research confidence: ${packet.source_confidence}.`,
          legalLines.length > 0
            ? `Cite/verify against these legal sources:\n- ${legalLines.join("\n- ")}`
            : "No curated legal sources matched — source citations manually.",
          angles.length > 0 ? `Content angles to consider:\n- ${angles.join("\n- ")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        setBrief((prev) => ({
          ...emptyBrief(),
          ...prev,
          practiceArea,
          primaryKeyword:
            (typeof packet.primary_keyword === "string" && packet.primary_keyword) ||
            (typeof packet.topic === "string" ? packet.topic : prev.primaryKeyword) ||
            "",
          statutes: Array.isArray(packet.suggested_statutes)
            ? packet.suggested_statutes.filter((s: unknown) => typeof s === "string")
            : [],
          faqQuestions,
          cannibalizationConfirmed: coverage.length === 0,
          cannibalizationNotes,
          specialInstructions: instructions,
        }));
        setPrefillNotice(
          `Brief pre-filled from Research Packet "${packet.topic}". Review every field — especially statutes and FAQs — before generating.${packet.legal_review_required ? " This topic is flagged for attorney review." : ""}`,
        );
      } catch {
        // ignore — manual entry still works
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [packetId]);

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
        body: JSON.stringify({ ...brief, language }),
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
            Content runs against the content system prompt — voice, structure,
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
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as ContentLanguage)}
            className="rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-700"
            title="Output language"
          >
            {CONTENT_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
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
            Running the content system prompt against Anthropic… long-form content
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
