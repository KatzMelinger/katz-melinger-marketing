"use client";

/**
 * KM SEO Brief Wizard — the 5-step brief builder (modeled on the SEMrush
 * content-brief flow) that fixes the Opportunity Radar's broken "Create".
 *
 * Unlike the old generic path, this produces a full KMPerPageBrief and generates
 * via /api/content/km-draft — so the output follows KM's real rules (the
 * 15/12/8-section structure + brand voice), not a generic article. Step 4
 * pre-fills KM's actual section skeleton, and every piece can be produced in
 * English or Spanish.
 *
 * Steps: 1 Competitors · 2 General info · 3 Secondary keywords ·
 *        4 Structure · 5 Meta → Generate.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { type ContentLanguage } from "@/lib/content-language";
import {
  getKmStructure,
  pillarsForPracticeArea,
  validateBrief,
  type KMContentType,
  type KMPerPageBrief,
  type KMPracticeArea,
  type KMSearchIntent,
} from "@/lib/km-content-system";

export type WizardOpportunity = {
  id: string;
  keyword: string;
  practiceArea: string | null;
  recommendedContentType: string | null;
  intent: string | null;
  pillarId: string | null;
  competitor: string | null;
  searchVolume: number | null;
};

type SecondarySuggestion = {
  keyword: string;
  volume: number | null;
  kd: number | null;
  intent: string | null;
};

type LinkPlanItem = { url: string; anchor: string; section: string };
type LinkPlanFlag = { url: string; title: string | null; reason: string };
type LinkPlan = { links: LinkPlanItem[]; flagged: LinkPlanFlag[] };

const CONTENT_TYPES: { id: KMContentType; label: string }[] = [
  { id: "practice_page", label: "Practice Page (commercial)" },
  { id: "blog_post", label: "Blog Post (informational)" },
  { id: "case_result", label: "Case Result (proof)" },
];
const PRACTICE_AREAS: { id: KMPracticeArea; label: string }[] = [
  { id: "employment", label: "Employment" },
  { id: "collections", label: "Collections" },
];
const INTENTS: { id: KMSearchIntent; label: string }[] = [
  { id: "informational", label: "Informational" },
  { id: "commercial", label: "Commercial" },
  { id: "proof", label: "Proof" },
];

const STEPS = ["Competitors", "General info", "Secondary keywords", "Structure", "Meta"];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function KmBriefWizard({
  opportunity,
  onClose,
  onGenerated,
}: {
  opportunity?: WizardOpportunity;
  onClose: () => void;
  onGenerated: (draftId: string | null) => void;
}) {
  // The builder opens either seeded from an SEO opportunity or blank ("from
  // scratch"). A blank seed just means every field starts empty and the
  // Competitors step is skipped — everything after that is identical.
  const fromScratch = !opportunity;
  const opp: WizardOpportunity = opportunity ?? {
    id: "",
    keyword: "",
    practiceArea: null,
    recommendedContentType: null,
    intent: null,
    pillarId: null,
    competitor: null,
    searchVolume: null,
  };
  // From scratch we skip step 0 (Competitors) — there is no competitor.
  const firstStep = fromScratch ? 1 : 0;

  const initialArea = (opp.practiceArea as KMPracticeArea) || "employment";
  const initialPillar =
    opp.pillarId || pillarsForPracticeArea(initialArea)[0]?.id || "";
  const initialPillarUrl =
    pillarsForPracticeArea(initialArea).find((p) => p.id === initialPillar)?.url ?? "";

  const [step, setStep] = useState(firstStep);
  const [language, setLanguage] = useState<ContentLanguage>("en");

  const [brief, setBrief] = useState<Partial<KMPerPageBrief>>({
    contentType: (opp.recommendedContentType as KMContentType) || "blog_post",
    practiceArea: initialArea,
    searchIntent: (opp.intent as KMSearchIntent) || "informational",
    pillarId: initialPillar,
    primaryKeyword: opp.keyword,
    h1: titleCase(opp.keyword),
    urlSlug: slugify(opp.keyword),
    metaTitle: opp.keyword ? `${titleCase(opp.keyword)} | Katz Melinger PLLC` : "",
    metaDescription: "",
    internalPillarLink: initialPillarUrl,
    secondaryKeywords: [],
    cannibalizationConfirmed: false,
    specialInstructions: "",
  });

  const [secondary, setSecondary] = useState<SecondarySuggestion[]>([]);
  const [secLoading, setSecLoading] = useState(false);
  const [manualKw, setManualKw] = useState("");

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneDraftId, setDoneDraftId] = useState<string | null | undefined>(undefined);

  const [linkPlan, setLinkPlan] = useState<LinkPlan | null>(null);
  const [linkPlanLoading, setLinkPlanLoading] = useState(false);
  const [metaBusy, setMetaBusy] = useState(false);

  const set = useCallback(
    (patch: Partial<KMPerPageBrief>) => setBrief((b) => ({ ...b, ...patch })),
    [],
  );

  // When practice area changes, keep the pillar valid + refresh the pillar link.
  const pillars = useMemo(
    () => pillarsForPracticeArea((brief.practiceArea as KMPracticeArea) || "employment"),
    [brief.practiceArea],
  );
  useEffect(() => {
    if (!pillars.find((p) => p.id === brief.pillarId)) {
      const first = pillars[0];
      if (first) set({ pillarId: first.id, internalPillarLink: first.url });
    }
  }, [pillars, brief.pillarId, set]);

  // Load secondary-keyword suggestions when reaching Step 3, based on the
  // keyword the user is actually targeting (typed, or seeded from an opportunity).
  const targetKeyword = brief.primaryKeyword || opp.keyword;
  useEffect(() => {
    if (step !== 2 || secondary.length > 0 || !targetKeyword) return;
    setSecLoading(true);
    fetch(`/api/seo/briefs/secondary?keyword=${encodeURIComponent(targetKeyword)}`)
      .then((r) => r.json())
      .then((d) => setSecondary(Array.isArray(d?.suggestions) ? d.suggestions : []))
      .finally(() => setSecLoading(false));
  }, [step, secondary.length, targetKeyword]);

  // Build the internal link plan when reaching the final (Meta) step. Asks the
  // Cluster Map which live pages relate to this brief, then pre-selects them all
  // into brief.internalLinks so the generator is constrained to confirmed URLs.
  useEffect(() => {
    if (step !== 4 || linkPlan !== null) return;
    setLinkPlanLoading(true);
    fetch("/api/seo/link-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primaryKeyword: brief.primaryKeyword,
        secondaryKeywords: brief.secondaryKeywords ?? [],
        faqQuestions: brief.faqQuestions ?? [],
        pillarId: brief.pillarId,
        practiceArea: brief.practiceArea,
        excludeUrl: brief.urlSlug ? `/${brief.urlSlug}/` : undefined,
      }),
    })
      .then((r) => r.json())
      .then((d: LinkPlan) => {
        const plan: LinkPlan = {
          links: Array.isArray(d?.links) ? d.links : [],
          flagged: Array.isArray(d?.flagged) ? d.flagged : [],
        };
        setLinkPlan(plan);
        // Default: include every confirmed link.
        set({ internalLinks: plan.links });
        // Automatic cannibalization check: the link-plan builder flags any live
        // page that already targets this exact primary keyword. No flag = safe,
        // so we auto-confirm. A flag requires explicit reviewer acknowledgment.
        set({ cannibalizationConfirmed: plan.flagged.length === 0 });
      })
      .catch(() => setLinkPlan({ links: [], flagged: [] }))
      .finally(() => setLinkPlanLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const selectedLinks = new Set((brief.internalLinks ?? []).map((l) => l.url));
  const toggleLink = (item: LinkPlanItem) => {
    const current = brief.internalLinks ?? [];
    const exists = current.some((l) => l.url === item.url);
    set({
      internalLinks: exists
        ? current.filter((l) => l.url !== item.url)
        : [...current, item],
    });
  };

  const selectedKw = new Set(brief.secondaryKeywords ?? []);
  const toggleKw = (kw: string) => {
    const next = new Set(selectedKw);
    if (next.has(kw)) next.delete(kw);
    else next.add(kw);
    set({ secondaryKeywords: Array.from(next) });
  };
  const addManual = () => {
    const k = manualKw.trim().toLowerCase();
    if (k && !selectedKw.has(k)) set({ secondaryKeywords: [...(brief.secondaryKeywords ?? []), k] });
    setManualKw("");
  };

  // Auto-draft the meta title + description from the chosen keywords.
  const draftMeta = async () => {
    if (!brief.primaryKeyword) return;
    setMetaBusy(true);
    try {
      const res = await fetch("/api/seo/briefs/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryKeyword: brief.primaryKeyword,
          secondaryKeywords: brief.secondaryKeywords ?? [],
          practiceArea: brief.practiceArea,
          contentType: brief.contentType,
          h1: brief.h1,
          language,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        set({
          metaTitle:
            typeof d?.metaTitle === "string" && d.metaTitle ? d.metaTitle : brief.metaTitle,
          metaDescription:
            typeof d?.metaDescription === "string" ? d.metaDescription : brief.metaDescription,
        });
      }
    } finally {
      setMetaBusy(false);
    }
  };

  const structure = getKmStructure(
    (brief.contentType as KMContentType) || "blog_post",
    (brief.practiceArea as KMPracticeArea) || "employment",
  );

  const validationErrors = validateBrief(brief);

  const generate = async (lang: ContentLanguage) => {
    setError(null);
    setLanguage(lang);
    const errs = validateBrief(brief);
    if (errs.length > 0) {
      setError(errs[0]);
      return;
    }
    setGenerating(true);
    try {
      // 1. Persist the brief.
      const briefRes = await fetch("/api/seo/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, language: lang }),
      });
      const briefJson = await briefRes.json();
      const briefId = briefJson?.id ?? null;

      // 2. Mark the opportunity as briefed (only when seeded from one).
      if (opp.id) {
        await fetch(`/api/seo/opportunities/${opp.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "brief", briefId }),
        }).catch(() => {});
      }

      // 3. Generate with the full content rules.
      const genRes = await fetch("/api/content/km-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...brief, language: lang }),
      });
      const genJson = await genRes.json();
      if (!genRes.ok) {
        throw new Error(
          genJson?.error
            ? `${genJson.error}${genJson.details ? `: ${genJson.details.join(", ")}` : ""}`
            : "Generation failed",
        );
      }
      const draftId = genJson?.draft_id ?? null;

      // 4. Flip the opportunity to in-production with its draft (if seeded).
      if (opp.id) {
        await fetch(`/api/seo/opportunities/${opp.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "in_production", draftId }),
        }).catch(() => {});
      }

      setDoneDraftId(draftId);
      onGenerated(draftId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + stepper */}
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {fromScratch ? "Content brief" : "SEO content brief for"}
              </p>
              <h3 className="mt-0.5 text-lg font-semibold text-slate-900">
                {brief.primaryKeyword || opp.keyword || "New content brief"}
              </h3>
            </div>
            <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">×</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STEPS.map((label, i) => {
              if (i < firstStep) return null;
              return (
                <button
                  key={label}
                  onClick={() => doneDraftId === undefined && setStep(i)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    i === step
                      ? "bg-[#185FA5] text-white"
                      : i < step
                        ? "bg-[#185FA5]/10 text-[#185FA5]"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {i + 1 - firstStep}. {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {doneDraftId !== undefined ? (
            <div className="space-y-3 py-6 text-center">
              <div className="text-3xl">✓</div>
              <h4 className="text-lg font-semibold text-slate-900">Draft generated</h4>
              <p className="text-sm text-slate-600">
                A {language === "es" ? "Spanish" : "English"} {brief.contentType?.replace("_", " ")} was
                generated for &ldquo;{brief.primaryKeyword || opp.keyword}&rdquo; and saved to your drafts.
              </p>
              <div className="flex justify-center gap-2 pt-2">
                {doneDraftId && (
                  <a
                    href={`/content/drafts?id=${encodeURIComponent(doneDraftId)}`}
                    className="rounded-md bg-[#185FA5] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f6fb8]"
                  >
                    Open draft
                  </a>
                )}
                <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {step === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    This brief targets a keyword where {opp.competitor ? <b>{opp.competitor}</b> : "a competitor"} outranks Katz Melinger.
                  </p>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p><span className="text-slate-500">Primary keyword:</span> <b>{opp.keyword}</b></p>
                    {opp.searchVolume != null && (
                      <p className="mt-1"><span className="text-slate-500">Volume:</span> {opp.searchVolume.toLocaleString()}</p>
                    )}
                    {opp.competitor && (
                      <p className="mt-1"><span className="text-slate-500">Outranked by:</span> {opp.competitor}</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">Review and continue — the next steps build the brief.</p>
                </div>
              )}

              {step === 1 && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Primary keyword" full>
                    <input
                      className="inp"
                      value={brief.primaryKeyword ?? ""}
                      onChange={(e) => {
                        const kw = e.target.value;
                        // From scratch, seed H1 / slug / meta title from the
                        // keyword as the user types (these are editable below).
                        set(
                          fromScratch
                            ? {
                                primaryKeyword: kw,
                                h1: titleCase(kw),
                                urlSlug: slugify(kw),
                                metaTitle: kw ? `${titleCase(kw)} | Katz Melinger PLLC` : "",
                              }
                            : { primaryKeyword: kw },
                        );
                      }}
                    />
                  </Field>
                  <Field label="Practice area">
                    <select className="inp" value={brief.practiceArea} onChange={(e) => set({ practiceArea: e.target.value as KMPracticeArea })}>
                      {PRACTICE_AREAS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Content type">
                    <select className="inp" value={brief.contentType} onChange={(e) => set({ contentType: e.target.value as KMContentType })}>
                      {CONTENT_TYPES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Search intent">
                    <select className="inp" value={brief.searchIntent} onChange={(e) => set({ searchIntent: e.target.value as KMSearchIntent })}>
                      {INTENTS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Pillar">
                    <select
                      className="inp"
                      value={brief.pillarId}
                      onChange={(e) => {
                        const p = pillars.find((x) => x.id === e.target.value);
                        set({ pillarId: e.target.value, internalPillarLink: p?.url ?? brief.internalPillarLink });
                      }}
                    >
                      {pillars.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </Field>
                  <Field label="H1" full>
                    <input className="inp" value={brief.h1 ?? ""} onChange={(e) => set({ h1: e.target.value })} />
                  </Field>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">Select secondary keywords to weave in (aim for at least 3).</p>
                  <div className="flex gap-2">
                    <input
                      className="inp flex-1"
                      placeholder="Add a keyword…"
                      value={manualKw}
                      onChange={(e) => setManualKw(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addManual()}
                    />
                    <button onClick={addManual} className="rounded-md border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">Add</button>
                  </div>
                  {(brief.secondaryKeywords ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(brief.secondaryKeywords ?? []).map((k) => (
                        <span key={k} className="inline-flex items-center gap-1 rounded-full bg-[#185FA5]/10 px-2 py-0.5 text-xs text-[#185FA5]">
                          {k}
                          <button onClick={() => toggleKw(k)} className="hover:text-red-600">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="rounded-lg border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs text-slate-500">
                        <tr><th className="p-2 w-8"></th><th className="p-2">Suggestion</th><th className="p-2">Intent</th><th className="p-2">Volume</th><th className="p-2">KD</th></tr>
                      </thead>
                      <tbody>
                        {secLoading && <tr><td colSpan={5} className="p-4 text-center text-slate-500">Loading…</td></tr>}
                        {!secLoading && secondary.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400">No suggestions — add keywords manually above.</td></tr>}
                        {secondary.map((s) => (
                          <tr key={s.keyword} className="border-b border-slate-100 last:border-0">
                            <td className="p-2"><input type="checkbox" checked={selectedKw.has(s.keyword)} onChange={() => toggleKw(s.keyword)} /></td>
                            <td className="p-2 text-slate-800">{s.keyword}</td>
                            <td className="p-2 text-xs text-slate-500">{s.intent ?? "—"}</td>
                            <td className="p-2 tabular-nums">{s.volume != null ? s.volume.toLocaleString() : "—"}</td>
                            <td className="p-2 tabular-nums">{s.kd != null ? `${s.kd}%` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    Content structure for a <b>{brief.contentType?.replace("_", " ")}</b> ({structure.length} sections). The
                    generator enforces this skeleton — not a generic outline.
                  </p>
                  <ol className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                    {structure.map((s) => (
                      <li key={s.n} className="flex gap-2 px-3 py-1.5 text-sm">
                        <span className="text-slate-400 tabular-nums">{s.n}</span>
                        <span className="text-slate-800">{s.heading}</span>
                      </li>
                    ))}
                  </ol>
                  <Field label="Extra instructions (optional)" full>
                    <textarea
                      className="inp min-h-[64px]"
                      placeholder="Anything specific to emphasize, statutes to cite, sections to add…"
                      value={brief.specialInstructions ?? ""}
                      onChange={(e) => set({ specialInstructions: e.target.value })}
                    />
                  </Field>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-600">Meta title &amp; description</span>
                    <button
                      type="button"
                      onClick={draftMeta}
                      disabled={metaBusy || !brief.primaryKeyword}
                      className="rounded-md border border-[#185FA5] px-2.5 py-1 text-xs font-medium text-[#185FA5] hover:bg-[#185FA5]/5 disabled:opacity-50"
                    >
                      {metaBusy ? "Drafting…" : "✨ Draft with AI"}
                    </button>
                  </div>
                  <Field label="Meta title" full>
                    <input className="inp" value={brief.metaTitle ?? ""} onChange={(e) => set({ metaTitle: e.target.value })} />
                  </Field>
                  <Field label={`Meta description (${(brief.metaDescription ?? "").length}/155)`} full>
                    <textarea
                      className={`inp min-h-[60px] ${(brief.metaDescription?.length ?? 0) > 155 ? "border-red-400" : ""}`}
                      value={brief.metaDescription ?? ""}
                      onChange={(e) => set({ metaDescription: e.target.value })}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="URL slug"><input className="inp" value={brief.urlSlug ?? ""} onChange={(e) => set({ urlSlug: e.target.value })} /></Field>
                    <Field label="Internal pillar link"><input className="inp" value={brief.internalPillarLink ?? ""} onChange={(e) => set({ internalPillarLink: e.target.value })} /></Field>
                  </div>

                  {/* Suggested Internal Links — auto-filled from the Cluster Map. */}
                  <div className="rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="text-xs font-semibold text-slate-700">Suggested internal links</span>
                      <span className="text-[10px] text-slate-500">
                        from the Cluster Map · confirmed live pages only
                      </span>
                    </div>
                    <div className="p-3">
                      {linkPlanLoading && (
                        <p className="text-xs text-slate-500">Checking the Cluster Map…</p>
                      )}
                      {!linkPlanLoading && linkPlan && linkPlan.links.length === 0 && (
                        <p className="text-xs text-slate-400">
                          No related live pages found. The generator will link only to the pillar above.
                        </p>
                      )}
                      {!linkPlanLoading && linkPlan && linkPlan.links.length > 0 && (
                        <ul className="space-y-1.5">
                          {linkPlan.links.map((l) => (
                            <li key={l.url} className="flex items-start gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={selectedLinks.has(l.url)}
                                onChange={() => toggleLink(l)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="text-slate-800">{l.anchor}</span>
                                <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                  {l.section}
                                </span>
                                <span className="block truncate text-[11px] text-slate-400">{l.url}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!linkPlanLoading && linkPlan && linkPlan.flagged.length > 0 && (
                        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-2">
                          <p className="text-[11px] font-medium text-amber-700">
                            Excluded (cannibalization risk):
                          </p>
                          <ul className="mt-1 space-y-1">
                            {linkPlan.flagged.map((f) => (
                              <li key={f.url} className="text-[11px] text-amber-800">
                                {f.title ?? f.url} — {f.reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="mt-2 text-[11px] text-slate-400">
                        The generator may use only these internal links. It cannot invent others.
                      </p>
                    </div>
                  </div>

                  {/* Cannibalization — checked automatically against the Cluster Map. */}
                  {linkPlanLoading ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                      Checking for keyword cannibalization…
                    </div>
                  ) : linkPlan && linkPlan.flagged.length === 0 ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      ✓ No existing KM page targets &ldquo;{brief.primaryKeyword}&rdquo; — no cannibalization detected.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                      <p className="font-medium text-red-800">
                        ⚠ Possible cannibalization — an existing page already targets this keyword:
                      </p>
                      <ul className="mt-1 list-disc pl-5 text-red-700">
                        {(linkPlan?.flagged ?? []).map((f) => (
                          <li key={f.url}>{f.title ?? f.url}</li>
                        ))}
                      </ul>
                      <label className="mt-2 flex items-start gap-2 text-red-800">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={!!brief.cannibalizationConfirmed}
                          onChange={(e) => set({ cannibalizationConfirmed: e.target.checked })}
                        />
                        <span>I&apos;ve reviewed this and want to target the keyword anyway.</span>
                      </label>
                    </div>
                  )}
                  {validationErrors.length > 0 && (
                    <p className="text-xs text-amber-600">Before generating: {validationErrors[0]}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {doneDraftId === undefined && (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
            <button
              onClick={() => setStep((s) => Math.max(firstStep, s - 1))}
              disabled={step === firstStep || generating}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </button>
            {error && <span className="px-2 text-xs text-red-600 truncate">{error}</span>}
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                className="rounded-md bg-[#185FA5] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#1f6fb8]"
              >
                Continue
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => generate("en")}
                  disabled={generating || validationErrors.length > 0}
                  className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {generating && language === "en" ? "Generating…" : "Generate (English)"}
                </button>
                <button
                  onClick={() => generate("es")}
                  disabled={generating || validationErrors.length > 0}
                  className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {generating && language === "es" ? "Generando…" : "Generar (Español)"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        :global(.inp) {
          width: 100%;
          border: 1px solid #e2e8f0;
          border-radius: 0.375rem;
          padding: 0.4rem 0.6rem;
          font-size: 0.875rem;
          color: #0f172a;
          background: #fff;
        }
        :global(.inp:focus) {
          outline: none;
          border-color: #185fa5;
        }
      `}</style>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
