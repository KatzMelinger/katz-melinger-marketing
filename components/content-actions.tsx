"use client";

/**
 * Reusable Ideas + Create actions for any keyword/topic across the app.
 *
 *   const ca = useContentActions();
 *   <ContentActionsRow keyword="..." actions={ca} compact />
 *   {ca.modal}
 *
 * "Ideas" opens a modal that fetches /api/seo/keywords/recommendations and
 * lists 3-5 article angles. "Create" opens a small content-type menu and
 * generates a draft via /api/content/draft. On success, a toast shows in
 * the bottom-right with an Open-draft link.
 *
 * Originally inlined in app/seo/keywords/page.tsx; hoisted here so the SEO
 * Opportunities, AEO, and AI Search pages can drop in the same flow.
 */

import { useState } from "react";

import { CONTENT_LANGUAGES, type ContentLanguage } from "@/lib/content-language";

export type ContentIdea = {
  headline: string;
  summary: string;
  contentType: string;
  practiceArea: string;
  whyItHelps: string;
  suggestedHeadings: string[];
};

export type FanOutPrompt = {
  prompt: string;
  intent: "informational" | "commercial" | "transactional" | "comparison";
  funnel: "tofu" | "mofu" | "bofu";
  rationale: string;
};

/**
 * Maps UI content-type options to the API contract for /api/content/draft.
 * `apiContentType` is one of "blog" | "social" | "email" — webpage / faq /
 * guide / case_study all flow as content_type=blog with a distinct
 * template_key that drives the structural guidance in the system prompt.
 */
export const CONTENT_TYPES: Array<{
  id: string;
  label: string;
  description: string;
  apiContentType: "blog" | "social" | "email";
  templateKey: string | null;
  length: "short" | "medium" | "long";
}> = [
  {
    id: "blog_post",
    label: "Blog post",
    description: "Standard blog/article (~1000 words).",
    apiContentType: "blog",
    templateKey: "blog_general",
    length: "medium",
  },
  {
    id: "webpage",
    label: "Webpage / landing",
    description: "Conversion-focused service or landing page (~2000 words).",
    apiContentType: "blog",
    templateKey: "webpage",
    length: "long",
  },
  {
    id: "faq",
    label: "FAQ article",
    description: "People Also Ask / AEO-optimized Q&A format.",
    apiContentType: "blog",
    templateKey: "faq",
    length: "medium",
  },
  {
    id: "guide",
    label: "Long-form guide",
    description: "Pillar content with TOC and deep sections (~2000 words).",
    apiContentType: "blog",
    templateKey: "guide",
    length: "long",
  },
  {
    id: "case_study",
    label: "Case study",
    description: "Anonymized challenge/approach/outcome walkthrough.",
    apiContentType: "blog",
    templateKey: "case_study",
    length: "medium",
  },
  {
    id: "social_post",
    label: "Social post",
    description: "Short social-media update with hook + CTA.",
    apiContentType: "social",
    templateKey: "social_post",
    length: "short",
  },
  {
    id: "email",
    label: "Email campaign",
    description: "Newsletter or campaign email with subject + body.",
    apiContentType: "email",
    templateKey: "newsletter",
    length: "medium",
  },
];

export function useContentActions() {
  // Recommendations modal
  const [recsFor, setRecsFor] = useState<string | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [recsIdeas, setRecsIdeas] = useState<ContentIdea[]>([]);

  // Create flow
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [createToast, setCreateToast] = useState<{ keyword: string; draftId: string } | null>(
    null,
  );
  const [createError, setCreateError] = useState<string | null>(null);

  // Per-row content-type menu open state — keyed by keyword so we know which
  // row's menu is open (only one open at a time).
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Output language for every draft created from this hook (English / Spanish).
  const [language, setLanguage] = useState<ContentLanguage>("en");

  // Fan-out modal — long-tail LLM prompts for a keyword.
  const [fanOutFor, setFanOutFor] = useState<string | null>(null);
  const [fanOutLoading, setFanOutLoading] = useState(false);
  const [fanOutError, setFanOutError] = useState<string | null>(null);
  const [fanOutPrompts, setFanOutPrompts] = useState<FanOutPrompt[]>([]);

  const openRecs = async (keyword: string) => {
    setRecsFor(keyword);
    setRecsIdeas([]);
    setRecsError(null);
    setRecsLoading(true);
    try {
      const res = await fetch("/api/seo/keywords/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRecsError(json?.error ?? "Failed to load recommendations");
        return;
      }
      setRecsIdeas(Array.isArray(json?.ideas) ? json.ideas : []);
    } catch (e) {
      setRecsError(e instanceof Error ? e.message : "Failed to load recommendations");
    } finally {
      setRecsLoading(false);
    }
  };

  const closeRecs = () => {
    setRecsFor(null);
    setRecsIdeas([]);
    setRecsError(null);
  };

  const openFanOut = async (keyword: string) => {
    setFanOutFor(keyword);
    setFanOutPrompts([]);
    setFanOutError(null);
    setFanOutLoading(true);
    try {
      const res = await fetch("/api/seo/keywords/fan-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFanOutError(json?.error ?? "Failed to load prompts");
        return;
      }
      setFanOutPrompts(Array.isArray(json?.prompts) ? json.prompts : []);
    } catch (e) {
      setFanOutError(e instanceof Error ? e.message : "Failed to load prompts");
    } finally {
      setFanOutLoading(false);
    }
  };

  const closeFanOut = () => {
    setFanOutFor(null);
    setFanOutPrompts([]);
    setFanOutError(null);
  };

  const createDraft = async (params: {
    topic: string;
    keyword: string;
    contentTypeId?: string;
    practiceArea?: string;
    headings?: string[];
    busyKey: string;
    originSource?: string;
    originContext?: Record<string, unknown>;
  }) => {
    const cfg = CONTENT_TYPES.find((c) => c.id === params.contentTypeId) ?? CONTENT_TYPES[0];
    setCreatingKey(params.busyKey);
    setCreateError(null);
    setMenuFor(null);
    try {
      const res = await fetch("/api/content/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: cfg.apiContentType,
          template_key: cfg.templateKey,
          topic: params.topic,
          practice_area: params.practiceArea || "General",
          tone: "Professional",
          length: cfg.length,
          target_keywords: [params.keyword],
          seo_brief: params.headings && params.headings.length > 0
            ? { headings: params.headings }
            : null,
          origin_source: params.originSource ?? null,
          origin_context: params.originContext ?? null,
          language,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.draft_id) {
        setCreateError(json?.error ?? "Draft generation failed");
        return;
      }
      setCreateToast({ keyword: params.keyword, draftId: json.draft_id });
      closeRecs();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Draft generation failed");
    } finally {
      setCreatingKey(null);
    }
  };

  const modal = (
    <>
      {createToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md rounded-xl border border-emerald-300 bg-white p-4 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-700">Draft created</p>
              <p className="mt-1 text-xs text-slate-600">
                Optimized for <span className="font-medium">&ldquo;{createToast.keyword}&rdquo;</span>.
              </p>
            </div>
            <button
              onClick={() => setCreateToast(null)}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <a
              href={`/content/drafts?id=${encodeURIComponent(createToast.draftId)}`}
              className="text-xs px-3 py-1.5 rounded bg-[#185FA5] text-white hover:bg-[#1f6fb8]"
            >
              Open draft
            </a>
            <button
              onClick={() => setCreateToast(null)}
              className="text-xs px-3 py-1.5 rounded border border-[#e2e8f0] text-slate-700 hover:bg-slate-50"
            >
              Stay here
            </button>
          </div>
        </div>
      )}

      {createError && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md rounded-xl border border-red-300 bg-red-50 p-4 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-red-700">{createError}</p>
            <button
              onClick={() => setCreateError(null)}
              className="text-red-400 hover:text-red-700"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {recsFor && (
        <RecommendationsModal
          keyword={recsFor}
          loading={recsLoading}
          error={recsError}
          ideas={recsIdeas}
          creatingKey={creatingKey}
          language={language}
          onLanguageChange={setLanguage}
          onClose={closeRecs}
          onCreate={(idea, contentTypeId) =>
            createDraft({
              topic: idea.headline,
              keyword: recsFor,
              contentTypeId,
              practiceArea: idea.practiceArea,
              headings: idea.suggestedHeadings,
              busyKey: `idea:${idea.headline}`,
              originSource: "recommendations",
              originContext: {
                source_keyword: recsFor,
                idea_summary: idea.summary,
                content_type_hint: idea.contentType,
              },
            })
          }
        />
      )}

      {fanOutFor && (
        <FanOutModal
          keyword={fanOutFor}
          loading={fanOutLoading}
          error={fanOutError}
          prompts={fanOutPrompts}
          creatingKey={creatingKey}
          language={language}
          onLanguageChange={setLanguage}
          onClose={closeFanOut}
          onCreate={(p, contentTypeId) =>
            createDraft({
              topic: p.prompt,
              keyword: fanOutFor,
              contentTypeId,
              busyKey: `fanout:${p.prompt}`,
              originSource: "fan_out",
              originContext: {
                source_keyword: fanOutFor,
                long_tail_prompt: p.prompt,
                funnel: p.funnel,
                intent: p.intent,
              },
            })
          }
        />
      )}
    </>
  );

  return {
    openRecs,
    openFanOut,
    createDraft,
    creatingKey,
    recsLoading,
    recsFor,
    fanOutLoading,
    fanOutFor,
    menuFor,
    setMenuFor,
    language,
    setLanguage,
    modal,
  };
}

/** Compact English / Spanish output-language toggle shown in the create modals. */
function LanguageToggle({
  value,
  onChange,
}: {
  value: ContentLanguage;
  onChange: (l: ContentLanguage) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-[#e2e8f0] p-0.5">
      {CONTENT_LANGUAGES.map((l) => (
        <button
          key={l.id}
          onClick={() => onChange(l.id)}
          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
            value === l.id ? "bg-[#185FA5] text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export type ContentActions = ReturnType<typeof useContentActions>;

/**
 * Compact button pair for table rows.
 *
 * `keyword` is what the recommendations + draft target. `practiceArea` is
 * optional context passed through to the create call.
 */
export function ContentActionsRow({
  keyword,
  actions,
  practiceArea,
  originSource,
  originContext,
}: {
  keyword: string;
  actions: ContentActions;
  practiceArea?: string;
  originSource?: string;
  originContext?: Record<string, unknown>;
}) {
  const isMenuOpen = actions.menuFor === keyword;
  const isCreating =
    actions.creatingKey != null &&
    (actions.creatingKey === `quick:${keyword}` ||
      actions.creatingKey.startsWith(`type:${keyword}:`));

  return (
    <div className="inline-flex items-center gap-1 relative">
      <button
        onClick={() => actions.openRecs(keyword)}
        disabled={actions.recsLoading && actions.recsFor === keyword}
        className="text-xs px-2 py-1 rounded border border-[#185FA5] text-[#185FA5] hover:bg-[#185FA5]/5 disabled:opacity-50"
        title="See AI-generated content ideas to rank for this keyword"
      >
        {actions.recsLoading && actions.recsFor === keyword ? "…" : "Ideas"}
      </button>
      <button
        onClick={() => actions.openFanOut(keyword)}
        disabled={actions.fanOutLoading && actions.fanOutFor === keyword}
        className="text-xs px-2 py-1 rounded border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-50"
        title="Long-tail prompts buyers actually type into LLMs"
      >
        {actions.fanOutLoading && actions.fanOutFor === keyword ? "…" : "Fan-out"}
      </button>
      <div className="inline-flex">
        <button
          onClick={() =>
            actions.createDraft({
              topic: keyword,
              keyword,
              practiceArea,
              busyKey: `quick:${keyword}`,
              originSource,
              originContext,
            })
          }
          disabled={isCreating}
          className="text-xs px-2 py-1 rounded-l bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50"
          title="Generate a blog draft targeting this keyword"
        >
          {isCreating ? "…" : "Create"}
        </button>
        <button
          onClick={() => actions.setMenuFor(isMenuOpen ? null : keyword)}
          disabled={isCreating}
          className="text-xs px-1.5 py-1 rounded-r bg-[#185FA5] text-white hover:bg-[#1f6fb8] disabled:opacity-50 border-l border-white/20"
          title="Pick content type"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
        >
          ▾
        </button>
      </div>
      {isMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => actions.setMenuFor(null)}
            aria-hidden
          />
          <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-[#e2e8f0] bg-white shadow-lg">
            <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Create as…
            </p>
            <ul>
              {CONTENT_TYPES.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() =>
                      actions.createDraft({
                        topic: keyword,
                        keyword,
                        contentTypeId: t.id,
                        practiceArea,
                        busyKey: `type:${keyword}:${t.id}`,
                        originSource,
                        originContext,
                      })
                    }
                    disabled={actions.creatingKey === `type:${keyword}:${t.id}`}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <p className="text-xs font-medium text-slate-900">{t.label}</p>
                    <p className="text-[11px] text-slate-500">{t.description}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function RecommendationsModal({
  keyword,
  loading,
  error,
  ideas,
  creatingKey,
  language,
  onLanguageChange,
  onClose,
  onCreate,
}: {
  keyword: string;
  loading: boolean;
  error: string | null;
  ideas: ContentIdea[];
  creatingKey: string | null;
  language: ContentLanguage;
  onLanguageChange: (l: ContentLanguage) => void;
  onClose: () => void;
  onCreate: (idea: ContentIdea, contentTypeId: string) => void;
}) {
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Content ideas for</p>
            <h3 className="mt-1 text-lg font-semibold">{keyword}</h3>
            <p className="mt-1 text-xs text-slate-500">
              AI-suggested article angles. Pick a content type after choosing an idea.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle value={language} onChange={onLanguageChange} />
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-5">
          {loading && (
            <p className="text-sm text-slate-500">Generating ideas… (typically 5-10s)</p>
          )}
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && ideas.length === 0 && (
            <p className="text-sm text-slate-500">No ideas returned.</p>
          )}
          <ul className="space-y-3">
            {ideas.map((idea) => {
              const isPickerOpen = pickerFor === idea.headline;
              return (
              <li
                key={idea.headline}
                className="rounded-lg border border-[#e2e8f0] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-slate-900">{idea.headline}</h4>
                    <p className="mt-1 text-xs text-slate-600">{idea.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                      <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-700">
                        {idea.contentType}
                      </span>
                      <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-violet-700">
                        {idea.practiceArea}
                      </span>
                    </div>
                    {idea.whyItHelps && (
                      <p className="mt-2 text-[11px] italic text-slate-500">
                        Why it ranks: {idea.whyItHelps}
                      </p>
                    )}
                    {idea.suggestedHeadings && idea.suggestedHeadings.length > 0 && (
                      <details className="mt-2 text-xs text-slate-600">
                        <summary className="cursor-pointer text-[#185FA5] hover:underline">
                          Outline ({idea.suggestedHeadings.length} sections)
                        </summary>
                        <ul className="mt-1 ml-4 list-disc space-y-0.5">
                          {idea.suggestedHeadings.map((h, i) => (
                            <li key={i}>{h}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <div className="relative shrink-0">
                    <div className="inline-flex">
                      <button
                        onClick={() => onCreate(idea, "blog_post")}
                        disabled={creatingKey === `idea:${idea.headline}`}
                        className="rounded-l bg-[#185FA5] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
                      >
                        {creatingKey === `idea:${idea.headline}` ? "Generating…" : "Create as blog"}
                      </button>
                      <button
                        onClick={() => setPickerFor(isPickerOpen ? null : idea.headline)}
                        disabled={creatingKey === `idea:${idea.headline}`}
                        className="rounded-r bg-[#185FA5] px-1.5 py-1.5 text-xs text-white hover:bg-[#1f6fb8] disabled:opacity-50 border-l border-white/20"
                        title="Pick content type"
                        aria-haspopup="menu"
                        aria-expanded={isPickerOpen}
                      >
                        ▾
                      </button>
                    </div>
                    {isPickerOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-30"
                          onClick={() => setPickerFor(null)}
                          aria-hidden
                        />
                        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-[#e2e8f0] bg-white shadow-lg">
                          <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Create as…
                          </p>
                          <ul>
                            {CONTENT_TYPES.map((t) => (
                              <li key={t.id}>
                                <button
                                  onClick={() => {
                                    setPickerFor(null);
                                    onCreate(idea, t.id);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-slate-50"
                                >
                                  <p className="text-xs font-medium text-slate-900">{t.label}</p>
                                  <p className="text-[11px] text-slate-500">{t.description}</p>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

const FUNNEL_TONE: Record<FanOutPrompt["funnel"], string> = {
  tofu: "border-blue-200 bg-blue-50 text-blue-700",
  mofu: "border-amber-200 bg-amber-50 text-amber-700",
  bofu: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const INTENT_TONE: Record<FanOutPrompt["intent"], string> = {
  informational: "border-slate-200 bg-slate-50 text-slate-700",
  commercial: "border-violet-200 bg-violet-50 text-violet-700",
  transactional: "border-emerald-200 bg-emerald-50 text-emerald-700",
  comparison: "border-amber-200 bg-amber-50 text-amber-700",
};

function FanOutModal({
  keyword,
  loading,
  error,
  prompts,
  creatingKey,
  language,
  onLanguageChange,
  onClose,
  onCreate,
}: {
  keyword: string;
  loading: boolean;
  error: string | null;
  prompts: FanOutPrompt[];
  creatingKey: string | null;
  language: ContentLanguage;
  onLanguageChange: (l: ContentLanguage) => void;
  onClose: () => void;
  onCreate: (p: FanOutPrompt, contentTypeId: string) => void;
}) {
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | FanOutPrompt["funnel"]>("all");

  const filtered = filter === "all" ? prompts : prompts.filter((p) => p.funnel === filter);

  const copyPrompt = async (p: string) => {
    try {
      await navigator.clipboard.writeText(p);
    } catch {
      /* clipboard might be blocked */
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-[#e2e8f0] bg-white px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Content fan-out for</p>
            <h3 className="mt-1 text-lg font-semibold">{keyword}</h3>
            <p className="mt-1 text-xs text-slate-500">
              How real buyers prompt ChatGPT, Claude, Perplexity, and Gemini. Each is a content
              opportunity — pick a funnel stage to filter.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle value={language} onChange={onLanguageChange} />
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-5">
          {loading && (
            <p className="text-sm text-slate-500">Generating long-tail prompts… (typically 5-10s)</p>
          )}
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && prompts.length === 0 && (
            <p className="text-sm text-slate-500">No prompts returned.</p>
          )}

          {prompts.length > 0 && (
            <div className="mb-3 flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-white p-1 w-fit">
              {(["all", "tofu", "mofu", "bofu"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-2 py-1 rounded uppercase tracking-wider ${
                    filter === f
                      ? "bg-[#185FA5] text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {f === "all" ? "All" : f}
                </button>
              ))}
            </div>
          )}

          <ul className="space-y-3">
            {filtered.map((p) => {
              const isPickerOpen = pickerFor === p.prompt;
              return (
                <li
                  key={p.prompt}
                  className="rounded-lg border border-[#e2e8f0] bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{p.prompt}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                        <span
                          className={`rounded border px-1.5 py-0.5 uppercase tracking-wider ${FUNNEL_TONE[p.funnel]}`}
                        >
                          {p.funnel}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 ${INTENT_TONE[p.intent]}`}
                        >
                          {p.intent}
                        </span>
                      </div>
                      {p.rationale && (
                        <p className="mt-2 text-[11px] italic text-slate-500">
                          Content angle: {p.rationale}
                        </p>
                      )}
                    </div>
                    <div className="relative shrink-0">
                      <div className="inline-flex">
                        <button
                          onClick={() => copyPrompt(p.prompt)}
                          className="rounded-l border border-[#e2e8f0] px-2 py-1.5 text-xs hover:border-[#185FA5] hover:text-[#185FA5]"
                          title="Copy prompt"
                        >
                          📋
                        </button>
                        <button
                          onClick={() => onCreate(p, "blog_post")}
                          disabled={creatingKey === `fanout:${p.prompt}`}
                          className="bg-[#185FA5] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1f6fb8] disabled:opacity-50"
                        >
                          {creatingKey === `fanout:${p.prompt}` ? "…" : "Create"}
                        </button>
                        <button
                          onClick={() => setPickerFor(isPickerOpen ? null : p.prompt)}
                          disabled={creatingKey === `fanout:${p.prompt}`}
                          className="rounded-r bg-[#185FA5] px-1.5 py-1.5 text-xs text-white hover:bg-[#1f6fb8] disabled:opacity-50 border-l border-white/20"
                          title="Pick content type"
                        >
                          ▾
                        </button>
                      </div>
                      {isPickerOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-30"
                            onClick={() => setPickerFor(null)}
                            aria-hidden
                          />
                          <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-[#e2e8f0] bg-white shadow-lg">
                            <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                              Create as…
                            </p>
                            <ul>
                              {CONTENT_TYPES.map((t) => (
                                <li key={t.id}>
                                  <button
                                    onClick={() => {
                                      setPickerFor(null);
                                      onCreate(p, t.id);
                                    }}
                                    className="w-full text-left px-3 py-2 hover:bg-slate-50"
                                  >
                                    <p className="text-xs font-medium text-slate-900">{t.label}</p>
                                    <p className="text-[11px] text-slate-500">{t.description}</p>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
