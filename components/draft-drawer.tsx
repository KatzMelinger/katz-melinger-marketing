"use client";

/**
 * DraftReview — the full draft review experience, opened INLINE on the
 * Production Board (no navigation). This is Diana's reviewer layout:
 *
 *   stage bar (Opportunity → Brief → Draft → Approve → Publish)
 *   title + tags + verify chips
 *   SEO metadata bar (full width, on top)
 *   ┌───────────────────────────┬──────────────────────┐
 *   │ Draft content (read/edit) │ Approve → Publish     │
 *   │ Internal links panel      │ QA checklist          │
 *   │                           │ Content info card     │
 *   └───────────────────────────┴──────────────────────┘
 *
 * Everything reads from the one linked record (the spine): the draft body and
 * brief come from content_drafts, the scores from content_analyses. No new
 * data model — this is the spine's reviewer view.
 *
 * The editorial machine is review → approved → published. Approve re-runs the
 * compliance HARD gate server-side (/api/agent/approve) and fails closed to
 * needs_legal; Publish (/api/content/drafts/[id]/publish) re-gates and posts
 * social drafts live via Ayrshare. WordPress long-form publishing lands next.
 */

import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";

import { DashSpinner, DashPill } from "@/components/dashboard-ui";
import {
  AnalysisCard,
  ApplySuggestionModal,
  type Analysis,
} from "@/components/analysis-card";
import { ALL_KM_PILLARS } from "@/lib/km-content-system";
import { READABILITY_FLOOR, READABILITY_TARGET } from "@/lib/readability";

const PROSE_CLASS =
  "[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:my-2";

const PILLAR_LABEL: Record<string, string> = Object.fromEntries(
  ALL_KM_PILLARS.map((p) => [p.id, p.label]),
);
const PILLAR_URL: Record<string, string> = Object.fromEntries(
  ALL_KM_PILLARS.map((p) => [p.id, p.url]),
);

type PipelineStatus =
  | "idea"
  | "brief"
  | "draft"
  | "review"
  | "needs_legal"
  | "approved"
  | "published";

const STAGES: { key: PipelineStatus; label: string }[] = [
  { key: "idea", label: "Opportunity" },
  { key: "brief", label: "Brief" },
  { key: "draft", label: "Draft review" },
  { key: "review", label: "Approve" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
];

// Soft quality floor: drafts scoring below these on the latest analysis trigger
// an advisory warning at approval (the owner can still approve). Unlike the
// compliance gate, this never blocks — it's a quality nudge, not a hard stop.
const QUALITY_MIN = { seo: 75, aeo: 75, cash: 75 };

/** Which of SEO/AEO/CASH on this analysis fall below the soft target. */
function qualityShortfall(a: Analysis | null): { label: string; score: number }[] {
  if (!a) return [];
  const out: { label: string; score: number }[] = [];
  if (typeof a.seo_score === "number" && a.seo_score < QUALITY_MIN.seo)
    out.push({ label: "SEO", score: a.seo_score });
  if (typeof a.aeo_score === "number" && a.aeo_score < QUALITY_MIN.aeo)
    out.push({ label: "AEO", score: a.aeo_score });
  if (typeof a.cash_score === "number" && a.cash_score < QUALITY_MIN.cash)
    out.push({ label: "CASH", score: a.cash_score });
  return out;
}

const SOURCE_LABEL: Record<string, string> = {
  opportunity_quickwin: "DataForSEO",
  opportunity_missing: "DataForSEO",
  opportunity_longtail: "DataForSEO",
  semrush: "DataForSEO",
  dataforseo: "DataForSEO",
  competitor_gap: "Competitor gap",
  keyword_tracker: "Keyword tracker",
  imported: "Imported",
  manual: "Manual",
};

type ReviewItem = {
  id: number;
  draft_id: string | null;
  /** brief_suggestions.id — present on rows created from a brief. Lets the
   *  drawer show the brief even before a draft has been generated. */
  suggestion_id?: string | null;
  status: PipelineStatus;
  title: string;
  bucket?: string | null;
  keywords?: string | null;
};

type Brief = {
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  metaTitle?: string;
  metaDescription?: string;
  urlSlug?: string;
  pillarId?: string;
  searchIntent?: string;
  internalPillarLink?: string;
  internalLinks?: { url: string; anchor: string; section: string }[];
  cannibalizationConfirmed?: boolean;
  contentType?: string;
};

type DraftRow = {
  id: string;
  title: string | null;
  body: string;
  created_at?: string;
  seo_brief?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

function readBrief(draft: DraftRow): Brief {
  const meta = (draft.metadata ?? {}) as Record<string, unknown>;
  const km = (meta.km_brief ?? {}) as Record<string, unknown>;
  const seo = (draft.seo_brief ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const src of [km, seo]) {
      for (const k of keys) {
        const v = src[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    return "";
  };
  const links = Array.isArray(km.internalLinks)
    ? (km.internalLinks as Brief["internalLinks"])
    : [];
  const secondary = Array.isArray(km.secondaryKeywords)
    ? (km.secondaryKeywords as string[])
    : Array.isArray(seo.secondaryKeywords)
      ? (seo.secondaryKeywords as string[])
      : Array.isArray(seo.targetKeywords)
        ? (seo.targetKeywords as string[])
        : [];
  return {
    primaryKeyword: pick("primaryKeyword"),
    secondaryKeywords: secondary,
    metaTitle: pick("metaTitle"),
    metaDescription: pick("metaDescription"),
    urlSlug: pick("urlSlug"),
    pillarId: pick("pillarId"),
    searchIntent: pick("searchIntent"),
    internalPillarLink: pick("internalPillarLink"),
    internalLinks: links,
    cannibalizationConfirmed: km.cannibalizationConfirmed === true,
    contentType: pick("contentType"),
  };
}

type RedraftAnalysis = {
  contentType?: string;
  detectedBy?: string;
  missingSections?: string[];
  missingKeywords?: string[];
  notes?: string[];
  headingChanges?: {
    before?: number;
    after?: number;
    kept?: number;
    h1Before?: string | null;
    h1After?: string | null;
    h1Changed?: boolean;
    added?: string[];
  };
};

/** The Redraft stages 1–2 result (only present on drafts from Redraft). */
function readRedraftAnalysis(draft: DraftRow): RedraftAnalysis | null {
  const meta = (draft.metadata ?? {}) as Record<string, unknown>;
  const a = meta.redraft_analysis;
  return a && typeof a === "object" ? (a as RedraftAnalysis) : null;
}

/**
 * The post-generation structure check (lib/structure-check.ts). Present on KM
 * drafts. When present and not passed, it's a HARD QA gate (missing required
 * sections). Absent = older draft with no check → don't gate.
 */
function readStructureCheck(
  draft: DraftRow | null,
): { passed: boolean; missing: string[] } | null {
  if (!draft) return null;
  const meta = (draft.metadata ?? {}) as Record<string, unknown>;
  const s = meta.structure_check;
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  return {
    passed: o.passed === true,
    missing: Array.isArray(o.missing) ? (o.missing as string[]) : [],
  };
}

type FreshnessFlagMeta = {
  kind?: string;
  match?: string;
  sentence?: string;
  /** Authoritative current value, when the flag maps to a known current fact. */
  current_value?: string;
  current_label?: string;
  effective_date?: string;
};

/**
 * Time-sensitive figures flagged at generation/refresh (lib/freshness-check.ts).
 * When any exist, approval is gated on the reviewer confirming them.
 */
function readFreshness(draft: DraftRow | null): FreshnessFlagMeta[] {
  if (!draft) return [];
  const meta = (draft.metadata ?? {}) as Record<string, unknown>;
  const f = meta.freshness as Record<string, unknown> | undefined;
  const flags = f?.flags;
  return Array.isArray(flags) ? (flags as FreshnessFlagMeta[]) : [];
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
          ok ? "bg-emerald-100 text-emerald-700" : "border border-slate-300 text-transparent"
        }`}
        aria-hidden
      >
        ✓
      </span>
      <span className={ok ? "text-slate-700" : "text-slate-500"}>{label}</span>
    </div>
  );
}

export function DraftDrawer({
  item,
  onClose,
  onChanged,
  onEditMeta,
}: {
  item: ReviewItem;
  onClose: () => void;
  /** Refresh the board after a save / status change. */
  onChanged: () => void;
  /** Open the metadata form (the row "Edit" / "Edit all fields"). */
  onEditMeta?: () => void;
}) {
  const draftId = item.draft_id ?? "";
  const suggestionId = item.suggestion_id ?? "";
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState<PipelineStatus>(item.status);
  const [legalReview, setLegalReview] = useState(false);
  const [proofread, setProofread] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // When the row has no draft yet (brief stage), we load the linked brief so
  // the reviewer still sees the brief they built — not "Draft not found".
  const [briefOnly, setBriefOnly] = useState<Brief | null>(null);
  const [suggestedRaw, setSuggestedRaw] = useState<Record<string, unknown> | null>(null);
  const [generating, setGenerating] = useState(false);
  // Findings the reviewer chose to apply — opens the AI rewrite/diff modal.
  const [applyingFindings, setApplyingFindings] = useState<string[] | null>(null);
  // Bumped after an Apply to remount AnalysisCard, which clears its finding
  // selection (so the "Apply N selected" button resets).
  const [applyNonce, setApplyNonce] = useState(0);
  // Reviewer confirmation that flagged time-sensitive figures are current.
  const [freshnessAck, setFreshnessAck] = useState(false);
  // Live link-verification counts (Cluster-Map membership) for the QA gate.
  const [linkVerify, setLinkVerify] = useState<
    { total: number; confirmed: number; unverified: number } | null
  >(null);
  const [linksOpen, setLinksOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDraft(null);
    setBriefOnly(null);
    setSuggestedRaw(null);

    if (draftId) {
      fetch(`/api/content/drafts/${draftId}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          setDraft(data.draft ?? null);
          setAnalysis(data.latest_analysis ?? null);
          setEditBody(data.draft?.body ?? "");
          setLoading(false);
          if (data.draft && !data.latest_analysis) void runAnalysis(data.draft);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    } else if (suggestionId) {
      // No draft generated yet — show the brief from the linked suggestion.
      fetch(`/api/seo/suggestions/${suggestionId}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          const raw = (data?.suggested_brief ?? null) as Record<string, unknown> | null;
          setSuggestedRaw(raw);
          setBriefOnly(
            raw
              ? readBrief({ id: "", title: null, body: "", metadata: { km_brief: raw } } as DraftRow)
              : ({} as Brief),
          );
          setLoading(false);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [draftId, suggestionId]);

  // Verify internal links against the Cluster Map (site_pages ∪ pillars ∪ hubs)
  // for the QA gate + panel. Re-runs when the body changes (e.g. after an edit).
  useEffect(() => {
    if (!draftId || !draft?.body) {
      setLinkVerify(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/content/drafts/${draftId}/verify-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.counts) setLinkVerify(d.counts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [draftId, draft?.body]);

  const brief = useMemo(
    () => (draft ? readBrief(draft) : (briefOnly ?? ({} as Brief))),
    [draft, briefOnly],
  );
  const redraft = useMemo(() => (draft ? readRedraftAnalysis(draft) : null), [draft]);
  const body = editing ? editBody : (draft?.body ?? "");
  const renderedBody = useMemo(
    () =>
      body.trim()
        ? (marked.parse(body, { async: false }) as string)
        : "<p class='text-slate-400'>No content.</p>",
    [body],
  );

  const wordCount =
    analysis?.word_count ?? (draft?.body ? draft.body.trim().split(/\s+/).filter(Boolean).length : 0);

  // Post-generation gates read off the draft metadata.
  const structureCheck = readStructureCheck(draft);
  const freshnessFlags = readFreshness(draft);

  // Automatic QA checks — computed from the linked record + latest analysis.
  const metaTitle = brief.metaTitle || item.title;
  const primaryKw = (brief.primaryKeyword || "").toLowerCase();
  const qa = {
    metaDescription: !!brief.metaDescription,
    h1Keyword: !!primaryKw && (draft?.title ?? item.title).toLowerCase().includes(primaryKw),
    pillarLink: !!(brief.internalPillarLink || brief.pillarId),
    // Passes when 3+ internal links resolve to live Cluster-Map pages and none
    // are unverified. Null (still checking) reads as not-yet-passed (advisory).
    internalLinks: !!linkVerify && linkVerify.confirmed >= 3 && linkVerify.unverified === 0,
    // Absent structure check (older drafts) is treated as passing so it can't
    // retroactively block; present-and-failed blocks (added to qaRequired below).
    structure: structureCheck ? structureCheck.passed : true,
    // Readability floor. No analysis yet = treated as passing (advisory until
    // the score exists); gated only when an analysis is present (see qaRequired).
    readability: analysis ? analysis.readability_score >= READABILITY_FLOOR : true,
    wordCount: wordCount >= 600,
    titleLen: metaTitle.length > 0 && metaTitle.length <= 60,
  };
  const autoPassCount = Object.values(qa).filter(Boolean).length;
  const manualPass = (legalReview ? 1 : 0) + (proofread ? 1 : 0);
  const qaTotal = `${autoPassCount + manualPass}/${Object.keys(qa).length + 2}`;

  // HARD QA gate — these four completeness checks must pass (or be explicitly
  // overridden) before approval. The other auto-checks (internal links, title
  // length) stay advisory and don't block. This is a content-completeness gate,
  // not the compliance gate — the owner can override with a deliberate tick.
  const qaRequired: { key: keyof typeof qa; label: string }[] = [
    { key: "metaDescription", label: "Meta description present" },
    { key: "h1Keyword", label: "H1 contains primary keyword" },
    { key: "pillarLink", label: "Pillar link present" },
    { key: "wordCount", label: "Word count meets minimum" },
  ];
  // Required section structure is a hard gate only when the draft carries a
  // structure check (KM generator). A failed check means sections are missing.
  if (structureCheck) {
    qaRequired.push({ key: "structure", label: "Required section structure present" });
  }
  // Readability floor is a hard gate once the draft has been analyzed, so a low
  // draft can't pass quietly. Below the floor blocks; 60-70 is an advisory band.
  if (analysis) {
    qaRequired.push({
      key: "readability",
      label: `Readability ${READABILITY_FLOOR}+ (aim ${READABILITY_TARGET})`,
    });
  }
  const qaFailed = qaRequired.filter((c) => !qa[c.key]);
  const qaGatePassed = qaFailed.length === 0;

  const canPublish = legalReview && proofread;

  async function runAnalysis(d: DraftRow) {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/content/drafts/${d.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) setAnalysis(data);
    } finally {
      setAnalyzing(false);
    }
  }

  // Generate the draft from the linked brief (brief-stage rows that have no
  // draft yet). On success the new draft is pulled straight into the drawer.
  const generateDraft = async () => {
    if (!suggestedRaw) return;
    setGenerating(true);
    setMsg("Generating draft from brief…");
    try {
      const res = await fetch("/api/content/km-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...suggestedRaw, language: "en", suggestionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data?.draft_id === "string") {
        const r = await fetch(`/api/content/drafts/${data.draft_id}`);
        const dj = await r.json();
        setDraft(dj.draft ?? null);
        setAnalysis(dj.latest_analysis ?? null);
        setEditBody(dj.draft?.body ?? "");
        setBriefOnly(null);
        setStatus("draft");
        setMsg("Draft generated.");
        onChanged();
        if (dj.draft && !dj.latest_analysis) void runAnalysis(dj.draft);
      } else {
        setMsg(data?.error ? `Generation failed: ${data.error}` : "Generation failed.");
      }
    } catch {
      setMsg("Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  // Persist an AI-proposed edit after the reviewer accepts it in the diff modal.
  // After saving, clear the finding selection (via the AnalysisCard remount) and
  // re-run the analysis so the scores (readability etc.) and findings reflect the
  // applied change — otherwise the panel keeps showing the pre-apply score and a
  // stale "Apply N selected" button.
  const acceptApply = async (newBody: string) => {
    if (!draft) return;
    const res = await fetch(`/api/content/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newBody }),
    });
    setApplyingFindings(null);
    if (res.ok) {
      const returned = (await res.json().catch(() => null)) as DraftRow | null;
      const updated: DraftRow = returned && typeof returned === "object" ? returned : { ...draft, body: newBody };
      setDraft(updated);
      setEditBody(updated.body ?? newBody);
      setFreshnessAck(false);
      setApplyNonce((n) => n + 1);
      onChanged();
      setMsg("Applied — re-scoring…");
      await runAnalysis(updated);
      setMsg("Applied. Scores updated.");
    }
  };

  // Apply an internal link from the overlap check: turn the first plain-text
  // mention of `term` in the body into a markdown link to the existing page, so
  // the writer can "link, don't redefine" with one click. No AI step.
  const applyOverlapLink = async (term: string, url: string) => {
    if (!draft) return;
    const source = draft.body ?? "";
    if (source.includes(`](${url})`)) {
      setMsg("That page is already linked in the draft.");
      return;
    }
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // First standalone occurrence not already inside a markdown link.
    const re = new RegExp(`(?<!\\[)\\b(${esc})\\b`, "i");
    if (!re.test(source)) {
      setMsg(`Couldn't find "${term}" in the draft — add the link manually.`);
      return;
    }
    const newBody = source.replace(re, `[$1](${url})`);
    const res = await fetch(`/api/content/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newBody }),
    });
    if (res.ok) {
      const updated = (await res.json().catch(() => null)) as DraftRow | null;
      const next: DraftRow = updated && typeof updated === "object" ? updated : { ...draft, body: newBody };
      setDraft(next);
      setEditBody(next.body ?? newBody);
      setFreshnessAck(false);
      setMsg(`Linked "${term}" to the existing page.`);
      onChanged();
      await runAnalysis(next);
    } else {
      setMsg("Failed to apply link.");
    }
  };

  // Apply a suggested title — a quick PATCH, no AI step.
  const applyTitle = async (newTitle: string) => {
    if (!draft) return;
    const res = await fetch(`/api/content/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
    if (res.ok) {
      setDraft({ ...draft, title: newTitle });
      setMsg("Title updated.");
      onChanged();
    }
  };

  // Apply actions operate on the SAVED draft body; if the editor has unsaved
  // changes, running one would silently discard them. Block with a nudge.
  const unsavedEditGuard = (): boolean => {
    if (editing && editBody !== (draft?.body ?? "")) {
      setMsg("Save or discard your edits first — Apply works on the saved draft.");
      return true;
    }
    return false;
  };

  const saveBody = async () => {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/content/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editBody }),
      });
      if (res.ok) {
        // Use the server's returned row so the recomputed freshness flags land in
        // the drawer; re-verify freshness and re-run analysis so no QA gate shows
        // a pre-edit value.
        const updated = (await res.json().catch(() => null)) as DraftRow | null;
        const next: DraftRow = updated && typeof updated === "object" ? updated : { ...draft, body: editBody };
        setDraft(next);
        setEditBody(next.body ?? editBody);
        setEditing(false);
        setFreshnessAck(false);
        onChanged();
        setMsg("Saved — re-checking…");
        await runAnalysis(next);
        setMsg("Saved. Checks updated.");
      } else {
        setMsg("Save failed.");
      }
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (next: PipelineStatus, note: string) => {
    setStatus(next);
    setMsg(note);
    await fetch(`/api/content/pipeline/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    onChanged();
  };

  // Move the draft's editorial status. When a draft_id exists we go through the
  // draft endpoint so content_drafts and content_pipeline stay in lockstep (and
  // the site_pages ingest fires on publish); brief-only rows fall back to the
  // pipeline row.
  const setDraftStage = async (next: PipelineStatus, note: string) => {
    setStatus(next);
    setMsg(note);
    if (draftId) {
      await fetch(`/api/content/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } else {
      await fetch(`/api/content/pipeline/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    }
    onChanged();
  };

  // Approve = the human sign-off. The server re-runs the compliance HARD gate;
  // a 422 means it was held at needs_legal (with violations), not approved.
  const [approving, setApproving] = useState(false);
  const [qaOverride, setQaOverride] = useState(false);
  const approve = async () => {
    if (!draftId) {
      setMsg("No draft to approve yet.");
      return;
    }
    // HARD QA gate: required completeness checks must pass unless overridden.
    if (!qaGatePassed && !qaOverride) {
      setMsg(
        `QA checklist incomplete: ${qaFailed.map((c) => c.label).join(", ")}. ` +
          `Fix these, or tick "Approve despite QA" to override.`,
      );
      return;
    }
    // HARD gate for time-sensitive figures: a refresh must not carry stale wage
    // rates / thresholds / deadlines forward. Block until the reviewer confirms.
    if (freshnessFlags.length > 0 && !freshnessAck && !qaOverride) {
      setMsg(
        `Verify the ${freshnessFlags.length} time-sensitive figure${freshnessFlags.length === 1 ? "" : "s"} ` +
          `(wage rates, thresholds, deadlines) and tick "Time-sensitive figures verified" before approving.`,
      );
      return;
    }
    // Soft quality gate: warn (don't block) if SEO/AEO/CASH are below target.
    const short = qualityShortfall(analysis);
    if (short.length > 0) {
      const lines = short.map((s) => `  • ${s.label} ${s.score} (target ${QUALITY_MIN[s.label.toLowerCase() as "seo" | "aeo" | "cash"]})`);
      const ok = window.confirm(
        `This draft is below your quality target:\n\n${lines.join("\n")}\n\nApprove anyway?`,
      );
      if (!ok) return;
    }
    setApproving(true);
    setMsg("Running compliance check…");
    try {
      // The approve endpoint only accepts a draft at status "review", but a card
      // opened from the Production Board is at "initial_review"/"draft" and nothing
      // else moves it. Promote it to "review" first (this also syncs the pipeline),
      // so approving works from the board, not just the Drafts studio.
      await fetch(`/api/content/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "review" }),
      }).catch(() => {});
      const res = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "content", id: draftId, action: "approve" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("approved");
        setMsg("Approved — ready to publish.");
      } else if (res.status === 422) {
        setStatus("needs_legal");
        const n = data?.compliance?.violations?.length ?? 0;
        setMsg(
          data?.error ??
            `Held by the compliance gate${n ? ` (${n} issue${n === 1 ? "" : "s"})` : ""}.`,
        );
      } else {
        setMsg(data?.error ?? "Approve failed.");
      }
    } catch {
      setMsg("Approve failed.");
    } finally {
      setApproving(false);
      onChanged();
    }
  };

  // Publish = approved → published. The server re-runs the compliance gate and,
  // for social-format drafts, actually posts via Ayrshare. A 502/400 means the
  // external post failed and the draft stays approved (we never mark something
  // published that didn't go out); a 422 means it was held at needs_legal.
  const [publishing, setPublishing] = useState(false);
  const [queuedForWp, setQueuedForWp] = useState(false);
  const publish = async () => {
    if (!draftId) {
      setMsg("No draft to publish yet.");
      return;
    }
    setPublishing(true);
    setMsg("Publishing…");
    try {
      const res = await fetch(`/api/content/drafts/${draftId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.status === "queued") {
        // Long-form → handed to the WordPress plugin; stays approved until the
        // plugin confirms the post was created.
        setQueuedForWp(true);
        setMsg(data?.message ?? "Queued for WordPress.");
      } else if (res.ok) {
        setStatus("published");
        const urls: string[] = Array.isArray(data?.postUrls) ? data.postUrls : [];
        setMsg(
          data?.channel === "social"
            ? `Published to social${urls[0] ? ` — ${urls[0]}` : "."}`
            : "Published.",
        );
      } else if (res.status === 422) {
        setStatus("needs_legal");
        setMsg(data?.error ?? "Held by the compliance gate.");
      } else {
        setMsg(data?.error ?? "Publish failed — left as approved.");
      }
    } catch {
      setMsg("Publish failed.");
    } finally {
      setPublishing(false);
      onChanged();
    }
  };

  // Compliance verdict the gate stored on the draft (shown when held).
  const compliance = (draft?.metadata as Record<string, unknown> | undefined)
    ?.compliance as
    | {
        score?: number;
        violations?: { rule?: string; severity?: string; reason?: string }[];
      }
    | undefined;

  // A long-form draft handed to the WordPress plugin (queued just now, or still
  // queued from a prior Publish click) sits in approved until the plugin confirms.
  const isQueuedForWp =
    queuedForWp ||
    ((draft?.metadata as Record<string, unknown> | undefined)?.wp_publish as
      | { queued?: unknown }
      | undefined)?.queued === true;

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(draft?.body ?? "");
      setMsg("Copied to clipboard.");
    } catch {
      setMsg("Copy failed.");
    }
  };

  const sourceRaw =
    ((draft?.metadata as Record<string, unknown>)?.origin_source as string) ?? "";
  const sourceLabel = SOURCE_LABEL[sourceRaw] ?? (sourceRaw ? sourceRaw : "—");
  const generated = draft?.created_at ? new Date(draft.created_at).toLocaleString() : "—";
  // needs_legal is a hold off the Approve stage, not its own column on the bar.
  const stageStatus: PipelineStatus = status === "needs_legal" ? "review" : status;
  const currentStage = STAGES.findIndex((s) => s.key === stageStatus);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-3 sm:p-6">
      <div className="mx-auto max-w-6xl rounded-xl bg-white shadow-2xl">
        {/* Top: stage bar + close */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {STAGES.map((s, i) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                    i < currentStage
                      ? "bg-emerald-50 text-emerald-700"
                      : i === currentStage
                        ? "bg-brand text-white"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {i < currentStage ? "✓" : i + 1} {s.label}
                </span>
                {i < STAGES.length - 1 && <span className="text-slate-300">→</span>}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">
              {wordCount.toLocaleString()} words · {generated}
            </span>
            <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-slate-500">
            <DashSpinner /> Loading draft…
          </div>
        ) : !draft && !briefOnly ? (
          <div className="py-20 text-center text-sm text-slate-500">
            {suggestionId || draftId ? "Draft not found." : "No brief linked to this item yet."}
          </div>
        ) : (
          <div className="px-5 py-4">
            {/* Title + tags + toolbar */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {brief.contentType && <DashPill tone="blue">{brief.contentType.replace(/_/g, " ")}</DashPill>}
                  {item.bucket && <DashPill tone="violet">{item.bucket.replace(/_/g, " ")}</DashPill>}
                  {sourceLabel !== "—" && <DashPill tone="neutral">{sourceLabel}</DashPill>}
                  {qa.internalLinks && <DashPill tone="emerald">Internal links verified</DashPill>}
                  {brief.cannibalizationConfirmed && <DashPill tone="emerald">No cannibalization</DashPill>}
                </div>
              </div>
              {draft && (
                <div className="flex items-center gap-1.5">
                  <button onClick={copyBody} className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:border-brand hover:text-brand">
                    Copy
                  </button>
                  <button
                    onClick={() => draft && runAnalysis(draft)}
                    disabled={analyzing}
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs hover:border-brand hover:text-brand disabled:opacity-50"
                  >
                    {analyzing ? "Analyzing…" : "Run analysis"}
                  </button>
                </div>
              )}
            </div>

            {/* Redraft summary — what the Redraft flow detected + set out to fill.
                Only present on drafts created via Redraft (page updates). */}
            {redraft && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Redraft summary
                </div>
                <p className="text-xs text-slate-700">
                  Detected content type:{" "}
                  <span className="font-medium">
                    {(redraft.contentType ?? "").replace(/_/g, " ") || "unknown"}
                  </span>
                  {redraft.detectedBy ? (
                    <span className="text-slate-500"> ({redraft.detectedBy})</span>
                  ) : null}
                </p>
                {(redraft.missingSections?.length ?? 0) > 0 && (
                  <p className="mt-1.5 text-xs text-slate-700">
                    <span className="font-medium">Gaps filled:</span>{" "}
                    {redraft.missingSections!.join("; ")}
                  </p>
                )}
                {(redraft.missingKeywords?.length ?? 0) > 0 && (
                  <p className="mt-1.5 text-xs text-slate-700">
                    <span className="font-medium">Keywords added:</span>{" "}
                    {redraft.missingKeywords!.join(", ")}
                  </p>
                )}
                {redraft.headingChanges && (
                  <div className="mt-1.5 text-xs text-slate-700">
                    <span className="font-medium">Headings:</span>{" "}
                    {redraft.headingChanges.kept ?? 0} of{" "}
                    {redraft.headingChanges.before ?? 0} kept
                    {(redraft.headingChanges.added?.length ?? 0) > 0
                      ? ` · ${redraft.headingChanges.added!.length} added`
                      : ""}
                    {redraft.headingChanges.h1Changed ? " · H1 improved for SEO" : ""}
                    {redraft.headingChanges.h1Changed && redraft.headingChanges.h1After ? (
                      <span
                        className="block text-slate-500"
                        title={`Before: ${redraft.headingChanges.h1Before ?? "—"}`}
                      >
                        H1 → “{redraft.headingChanges.h1After}”
                      </span>
                    ) : null}
                    {(redraft.headingChanges.added?.length ?? 0) > 0 ? (
                      <span className="block text-slate-500">
                        Added: {redraft.headingChanges.added!.join("; ")}
                      </span>
                    ) : null}
                  </div>
                )}
                {(redraft.notes?.length ?? 0) > 0 && (
                  <p className="mt-1.5 text-xs text-slate-500">{redraft.notes!.join(" ")}</p>
                )}
                {(redraft.missingSections?.length ?? 0) === 0 &&
                  (redraft.missingKeywords?.length ?? 0) === 0 && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      No structural gaps found — light voice/clarity improvements only.
                    </p>
                  )}
              </div>
            )}

            {/* SEO metadata bar — full width, on top */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">SEO metadata</span>
                {onEditMeta && (
                  <button onClick={onEditMeta} className="text-xs font-medium text-brand hover:underline">
                    Edit all fields
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <MetaField label="Meta title" value={brief.metaTitle} />
                <MetaField label="URL slug" value={brief.urlSlug} />
                <MetaField label="Pillar link" value={brief.internalPillarLink || PILLAR_URL[brief.pillarId ?? ""]} />
                <MetaField label="Search intent" value={brief.searchIntent} />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <MetaField label="Meta description" value={brief.metaDescription} multiline />
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Secondary keywords</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(brief.secondaryKeywords ?? []).length === 0 ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      brief.secondaryKeywords!.map((k) => (
                        <span key={k} className="rounded bg-brand/10 px-1.5 py-0.5 text-[11px] text-brand">
                          {k}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Two-column body */}
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
              {/* LEFT: draft content + internal links */}
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Draft content</span>
                    {draft &&
                      (editing ? (
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setEditing(false); setEditBody(draft.body); }} className="text-xs text-slate-500 hover:text-slate-700">
                            Cancel
                          </button>
                          <button onClick={saveBody} disabled={saving} className="text-xs font-medium text-brand hover:underline disabled:opacity-50">
                            {saving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditBody(draft.body); setEditing(true); }} className="text-xs font-medium text-brand hover:underline">
                          Edit
                        </button>
                      ))}
                  </div>
                  {!draft ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm font-medium text-slate-700">No draft generated yet</p>
                      <p className="mx-auto mt-1 max-w-sm text-xs text-slate-400">
                        This brief is ready. Generate the draft to review, QA, and publish it.
                      </p>
                      <button
                        onClick={generateDraft}
                        disabled={generating || !suggestedRaw}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {generating ? (
                          <>
                            <DashSpinner /> Generating…
                          </>
                        ) : (
                          "Generate draft from brief"
                        )}
                      </button>
                    </div>
                  ) : editing ? (
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="h-[60vh] w-full resize-none px-4 py-3 font-mono text-sm leading-relaxed text-slate-800 focus:outline-none"
                    />
                  ) : (
                    <div
                      className={`max-h-[60vh] overflow-y-auto px-4 py-3 text-sm text-slate-800 ${PROSE_CLASS}`}
                      dangerouslySetInnerHTML={{ __html: renderedBody }}
                    />
                  )}
                </div>

                {/* Internal links panel — status line, list collapsed behind a
                    toggle. QA passes at 3+ links confirmed in the Cluster Map. */}
                <div className="rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Internal links
                    </span>
                    {linkVerify ? (
                      <span
                        className={`text-xs font-medium ${
                          qa.internalLinks ? "text-emerald-600" : "text-amber-600"
                        }`}
                      >
                        {linkVerify.confirmed} inserted, confirmed in site map
                        {linkVerify.unverified > 0 ? ` · ${linkVerify.unverified} unverified` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Checking…</span>
                    )}
                  </div>
                  <div className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">
                        {linkVerify
                          ? `${linkVerify.confirmed} internal link${linkVerify.confirmed === 1 ? "" : "s"} inserted and confirmed in the Cluster Map${
                              linkVerify.confirmed >= 3 ? "." : " (QA passes at 3 or more)."
                            }`
                          : "Verifying internal links against the Cluster Map…"}
                      </p>
                      {(brief.internalLinks?.length ?? 0) > 0 && (
                        <button
                          onClick={() => setLinksOpen((v) => !v)}
                          className="shrink-0 text-xs font-medium text-brand hover:underline"
                        >
                          {linksOpen ? "Hide links" : "View links"}
                        </button>
                      )}
                    </div>
                    {linksOpen && (brief.internalLinks?.length ?? 0) > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {brief.internalLinks!.map((l, i) => (
                          <li key={`${l.url}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-1.5 text-slate-700">
                              <span className="text-emerald-600">✓</span>
                              <span className="font-mono">{l.url}</span>
                            </span>
                            <span className="text-slate-400">Confirmed in site map · {l.section}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {linksOpen && (
                      <p className="mt-2 text-[11px] text-slate-400">
                        Generator used only confirmed Cluster Map pages. No invented links.
                        “Confirmed in site map” means the URL is a known live page in the site
                        inventory.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT: publish + QA + content info */}
              <div className="space-y-4">
                {draft ? (
                  status === "needs_legal" ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                      <div className="text-sm font-semibold text-amber-900">Held by compliance</div>
                      <p className="mt-0.5 text-xs text-amber-700">
                        The compliance gate held this draft
                        {typeof compliance?.score === "number" ? ` (score ${compliance.score})` : ""}.
                        Edit it to compliance, then approve again.
                      </p>
                      {compliance?.violations?.length ? (
                        <ul className="mt-2 space-y-1">
                          {compliance.violations.slice(0, 5).map((v, i) => (
                            <li key={i} className="text-[11px] text-amber-800">
                              <span className="font-medium capitalize">{v.severity ?? "issue"}:</span>{" "}
                              {v.reason ?? v.rule}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <button
                        onClick={() => setDraftStage("draft", "Sent back to draft.")}
                        className="mt-2 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
                      >
                        Send back to draft
                      </button>
                    </div>
                  ) : status === "published" ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <div className="text-sm font-semibold text-emerald-900">Published</div>
                      <p className="mt-0.5 text-xs text-emerald-700">
                        This draft is marked published.
                      </p>
                      <button
                        onClick={() => setDraftStage("draft", "Sent back to draft.")}
                        className="mt-2 w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                      >
                        Send back to draft
                      </button>
                    </div>
                  ) : status === "approved" ? (
                    isQueuedForWp ? (
                      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                        <div className="text-sm font-semibold text-sky-900">Queued for WordPress</div>
                        <p className="mt-0.5 text-xs text-sky-700">
                          The site plugin will create the post on its next sync, then this flips to
                          Published automatically.
                        </p>
                        <button
                          onClick={() => setDraftStage("draft", "Sent back to draft.")}
                          className="mt-2 w-full rounded-md border border-sky-300 bg-white px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
                        >
                          Send back to draft
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                        <div className="text-sm font-semibold text-emerald-900">Approved — ready to publish</div>
                        <p className="mt-0.5 text-xs text-emerald-700">Signed off and compliance-cleared.</p>
                        <button
                          onClick={publish}
                          disabled={publishing}
                          className="mt-2 w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {publishing ? "Publishing…" : "Publish"}
                        </button>
                        <button
                          onClick={() => setDraftStage("draft", "Sent back to draft.")}
                          className="mt-2 w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                        >
                          Send back to draft
                        </button>
                        <p className="mt-2 text-[10px] text-emerald-700/80">
                          Social drafts post live via Ayrshare; long-form drafts are queued for
                          WordPress — both run a final compliance check on Publish.
                        </p>
                      </div>
                    )
                  ) : (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <div className="text-sm font-semibold text-emerald-900">Ready to approve</div>
                      <p className="mt-0.5 text-xs text-emerald-700">
                        {canPublish ? "Manual checks complete." : "Complete 2 manual checks then approve."}
                      </p>
                      {!qaGatePassed && (
                        <div className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
                          <span className="font-medium">QA checklist incomplete — fix before approving:</span>
                          <ul className="mt-1 list-disc pl-4">
                            {qaFailed.map((c) => (
                              <li key={c.key}>{c.label}</li>
                            ))}
                          </ul>
                          <label className="mt-1.5 flex items-center gap-1.5 font-medium">
                            <input
                              type="checkbox"
                              checked={qaOverride}
                              onChange={(e) => setQaOverride(e.target.checked)}
                              className="h-3.5 w-3.5"
                            />
                            Approve despite QA
                          </label>
                        </div>
                      )}
                      {qualityShortfall(analysis).length > 0 && (
                        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                          <span className="font-medium">Below quality target ({QUALITY_MIN.seo}):</span>{" "}
                          {qualityShortfall(analysis)
                            .map((s) => `${s.label} ${s.score}`)
                            .join(" · ")}
                          . You can still approve, or improve it first using the analysis findings below.
                        </div>
                      )}
                      <button
                        onClick={approve}
                        disabled={!canPublish || approving || (!qaGatePassed && !qaOverride)}
                        className="mt-2 w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                        title={
                          !canPublish
                            ? "Complete the manual checks first"
                            : !qaGatePassed && !qaOverride
                              ? "QA checklist incomplete — fix the flagged items or override"
                              : undefined
                        }
                      >
                        {approving ? "Checking compliance…" : "Approve"}
                      </button>
                      <button
                        onClick={() => setDraftStage("draft", "Sent back to draft.")}
                        className="mt-2 w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                      >
                        Send back to draft
                      </button>
                      <p className="mt-2 text-[10px] text-emerald-700/80">
                        Approve re-runs the compliance check; if it fails the draft is held for legal.
                      </p>
                    </div>
                  )
                ) : (
                  <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
                    <div className="text-sm font-semibold text-slate-900">Brief ready</div>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Generate the draft from this brief to start the review.
                    </p>
                    <button
                      onClick={generateDraft}
                      disabled={generating || !suggestedRaw}
                      className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {generating ? (
                        <>
                          <DashSpinner /> Generating…
                        </>
                      ) : (
                        "Generate draft from brief"
                      )}
                    </button>
                  </div>
                )}

                {/* Structure gap — which required sections are missing. Only
                    shown when the KM structure check failed. */}
                {structureCheck && !structureCheck.passed && structureCheck.missing.length > 0 && (
                  <div className="rounded-lg border border-rose-300 bg-rose-50 p-3">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-800">
                      Missing required sections
                    </div>
                    <p className="text-[11px] text-rose-700">
                      The draft is missing sections the {brief.contentType?.replace(/_/g, " ") || "content"}{" "}
                      scaffold requires. Add them (or edit the body) before approving.
                    </p>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-slate-700">
                      {structureCheck.missing.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Freshness — time-sensitive figures the reviewer must verify
                    before approval (hard gate). Only shown when flags exist. */}
                {freshnessFlags.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                        Verify time-sensitive figures
                      </span>
                      <span className="text-xs font-medium text-amber-700">{freshnessFlags.length}</span>
                    </div>
                    <p className="text-[11px] text-amber-700">
                      These can go stale (wage rates, thresholds, years, deadlines). Confirm each is
                      current before approving. Never carry a dated figure forward unverified.
                    </p>
                    <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
                      {freshnessFlags.map((f, i) => (
                        <li key={i} className="text-[11px] text-slate-700">
                          <span className="rounded bg-amber-100 px-1 font-mono font-medium text-amber-900">
                            {f.match}
                          </span>{" "}
                          <span className="text-slate-500">{f.sentence}</span>
                          {f.current_value && (
                            <span className="mt-0.5 block font-medium text-emerald-700">
                              Current verified value: {f.current_value}
                              {f.effective_date ? ` (effective ${f.effective_date})` : ""}
                              {f.current_label ? ` — ${f.current_label}` : ""}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-amber-900">
                      <input
                        type="checkbox"
                        checked={freshnessAck}
                        onChange={(e) => setFreshnessAck(e.target.checked)}
                      />
                      Time-sensitive figures verified / updated
                    </label>
                  </div>
                )}

                {/* QA checklist */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">QA checklist</span>
                    <span className="text-xs font-medium text-slate-600">{qaTotal}</span>
                  </div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Automatic</div>
                  <div className="mt-1 space-y-1">
                    <Check ok={qa.metaDescription} label="Meta description present" />
                    <Check ok={qa.h1Keyword} label="H1 contains primary keyword" />
                    <Check ok={qa.pillarLink} label="Pillar link present" />
                    <Check
                      ok={qa.internalLinks}
                      label={`Internal links (3+ confirmed)${linkVerify ? ` — ${linkVerify.confirmed}` : ""}`}
                    />
                    {structureCheck && (
                      <Check ok={qa.structure} label="Required section structure present" />
                    )}
                    {analysis && (
                      <Check
                        ok={qa.readability}
                        label={`Readability ${READABILITY_FLOOR}+ (${analysis.readability_score}, aim ${READABILITY_TARGET})`}
                      />
                    )}
                    <Check ok={qa.wordCount} label="Word count meets minimum" />
                    <Check ok={qa.titleLen} label="Title under 60 characters" />
                  </div>
                  <div className="mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    Manual certification
                  </div>
                  <div className="mt-1 space-y-1">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={legalReview} onChange={(e) => setLegalReview(e.target.checked)} />
                      Legal review complete
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={proofread} onChange={(e) => setProofread(e.target.checked)} />
                      Proofread and on-brand
                    </label>
                  </div>
                </div>

                {/* Content info */}
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Content info</div>
                  <dl className="space-y-1.5 text-xs">
                    <InfoRow label="Type" value={brief.contentType ? brief.contentType.replace(/_/g, " ") : "—"} />
                    <InfoRow label="Primary keyword" value={brief.primaryKeyword || "—"} />
                    <InfoRow label="Pillar" value={PILLAR_LABEL[brief.pillarId ?? ""] || "—"} />
                    <InfoRow label="Word count" value={wordCount.toLocaleString()} />
                    <InfoRow
                      label="Cannibalization"
                      value={brief.cannibalizationConfirmed ? "No conflict" : "Review"}
                      valueClass={brief.cannibalizationConfirmed ? "text-emerald-600" : "text-amber-600"}
                    />
                    <InfoRow label="Source" value={sourceLabel} />
                    <InfoRow label="Generated" value={generated} />
                  </dl>
                </div>

                {msg && <p className="text-xs text-slate-500">{msg}</p>}
              </div>
            </div>

            {/* Analysis results — full width, at the bottom. The same rich card
                used in the Drafts studio: scores, findings (apply-to-rewrite),
                suggested titles/images/links, compliance, and overlap. */}
            {draft &&
              (analysis ? (
                <div className="mt-4">
                  <AnalysisCard
                    key={applyNonce}
                    analysis={analysis}
                    onRerun={() => runAnalysis(draft)}
                    rerunning={analyzing}
                    onApplyFindings={(fs) => {
                      if (unsavedEditGuard()) return;
                      setApplyingFindings(fs);
                    }}
                    onApplyTitle={(t) => {
                      if (unsavedEditGuard()) return;
                      void applyTitle(t);
                    }}
                    onApplyLink={(term, url) => {
                      if (unsavedEditGuard()) return;
                      return applyOverlapLink(term, url);
                    }}
                    currentTitle={draft.title}
                  />
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-slate-200 p-4 text-xs text-slate-500">
                  {analyzing ? (
                    <span className="inline-flex items-center gap-2">
                      <DashSpinner /> Running analysis…
                    </span>
                  ) : (
                    "No analysis yet — click “Run analysis” above."
                  )}
                </div>
              ))}

            {draft && applyingFindings && (
              <ApplySuggestionModal
                draftId={draft.id}
                findings={applyingFindings}
                onAccept={acceptApply}
                onClose={() => setApplyingFindings(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaField({ label, value, multiline }: { label: string; value?: string; multiline?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div
        className={`mt-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 ${
          multiline ? "min-h-[3.5rem] italic" : "truncate"
        }`}
        title={value || undefined}
      >
        {value || <span className="text-slate-300">—</span>}
      </div>
    </div>
  );
}

function InfoRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right font-medium ${valueClass ?? "text-slate-800"}`}>{value}</dd>
    </div>
  );
}
