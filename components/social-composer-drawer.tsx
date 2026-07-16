"use client";

/**
 * Social composer (Phase 1 + 2 of the Social Module).
 *
 * The tabbed composer from the confirmed spec: one Post, a variation per
 * network, reviewed in one place.
 *
 *   - Platform checklist pre-selected to the five Katz Melinger networks
 *     (LinkedIn, Facebook, Instagram, Google Business, TikTok). Uncheck to
 *     exclude; "add network" reveals Threads / Pinterest / YouTube (X is gone).
 *   - One editable tab per selected network (plus a Template base), each with
 *     character + hashtag counts and its own staggered schedule time.
 *   - Live preview per platform, mobile and desktop.
 *   - Slides (carousel) and Script (reel/video) offered as post add-ons.
 *
 * Phase 2 — the approval + compliance gate:
 *   - Every variation is checked live against the brand + attorney-advertising
 *     rules (lib/social-compliance). A blocking flag stops that post from
 *     scheduling until it is cleared. The flagged tab shows a warning marker.
 *   - A legal-review checkbox must be confirmed before Approve is available.
 *   - Nothing publishes automatically. "Approve & schedule" is the deliberate
 *     step; it reuses the existing, unchanged schedule + Ayrshare path.
 *
 * Generation is untouched: the drafts come from the existing repurpose run.
 * Google Business is seeded from the Facebook copy; TikTok carries the short-
 * video script. Neither adds a generation format.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

import type { RepurposeDraft } from "@/components/repurpose-review-drawer";
import { checkSocialCompliance, type ComplianceFlag } from "@/lib/social-compliance";

/** The networks the composer can compose for. `platform` (the key) is the
 *  Ayrshare id used to schedule. */
type NetworkKey =
  | "linkedin"
  | "facebook"
  | "instagram"
  | "gmb"
  | "tiktok"
  | "threads"
  | "pinterest"
  | "youtube";

type NetworkMeta = {
  key: NetworkKey;
  label: string;
  /** Default post type shown next to the network (e.g. "Post", "Carousel"). */
  postType: string;
  /** Character limit surfaced in the counter for this network. */
  charLimit: number;
  /** Dot color in the checklist + preview accent. */
  color: string;
  /** True when Ayrshare rejects a text-only post (needs media). */
  needsMedia: boolean;
};

// The five KM networks, pre-selected. Order matches the checklist + tabs.
const KM_NETWORKS: NetworkMeta[] = [
  { key: "linkedin", label: "LinkedIn", postType: "Post", charLimit: 3000, color: "#0A66C2", needsMedia: false },
  { key: "facebook", label: "Facebook", postType: "Post", charLimit: 2000, color: "#1877F2", needsMedia: false },
  { key: "instagram", label: "Instagram", postType: "Carousel", charLimit: 2200, color: "#C13584", needsMedia: true },
  { key: "gmb", label: "Google", postType: "Post", charLimit: 1500, color: "#34A853", needsMedia: false },
  { key: "tiktok", label: "TikTok", postType: "Video", charLimit: 2200, color: "#111827", needsMedia: true },
];

// Extra networks behind "+ add network". X is intentionally absent.
const EXTRA_NETWORKS: NetworkMeta[] = [
  { key: "threads", label: "Threads", postType: "Post", charLimit: 500, color: "#111827", needsMedia: false },
  { key: "pinterest", label: "Pinterest", postType: "Pin", charLimit: 500, color: "#E60023", needsMedia: true },
  { key: "youtube", label: "YouTube", postType: "Short", charLimit: 1000, color: "#FF0000", needsMedia: true },
];

const META_BY_KEY = new Map<NetworkKey, NetworkMeta>(
  [...KM_NETWORKS, ...EXTRA_NETWORKS].map((n) => [n.key, n]),
);

// Client-side upload validation (mirrors lib/social-assets.ts on the server).
const SOCIAL_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "video/mp4"];
const SOCIAL_MEDIA_ACCEPT = SOCIAL_MEDIA_TYPES.join(",");
const SOCIAL_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

type Slide = { n: number; headline: string; url: string };

/** A manually-uploaded image/video (Metricool-style upload). Its `url` is also
 *  pushed into the variation's mediaUrls so it flows to Ayrshare. */
type UploadedAsset = { url: string; kind: "image" | "video"; filename: string };

type Variation = {
  key: NetworkKey;
  copy: string;
  /** Per-network schedule slot (staggered by default). Local yyyy-mm-dd + HH:mm. */
  date: string;
  time: string;
  /** Carousel slide script (Instagram) kept so slides can be generated. */
  carouselScript?: string;
  /** Short-video script (TikTok) — this is a script, not a caption. */
  isScript?: boolean;
  /** Source draft id for write-back, when this network maps to a real draft. */
  draftId: string | null;
  slides?: Slide[];
  mediaUrls?: string[];
  /** Manually-uploaded media (kept for preview + removal; urls also live in mediaUrls). */
  uploads?: UploadedAsset[];
  mediaBusy?: boolean;
  mediaMsg?: string | null;
  genBusy?: boolean;
  genMsg?: string | null;
  /** Reel/video script asset (Script add-on). */
  reelScript?: { hook: string; body: string; cta: string };
  scriptBusy?: boolean;
  scriptMsg?: string | null;
};

/** Count hashtags in a body (the counter + preview chips read from the copy). */
function hashtagsOf(body: string): string[] {
  return body.match(/#[\p{L}\p{N}_]+/gu) ?? [];
}

/** Seed a Google Business post from the Facebook (or LinkedIn) copy. Kept short. */
function seedGmb(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= 700) return trimmed;
  const cut = trimmed.slice(0, 700);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (stop > 300 ? cut.slice(0, stop + 1) : cut).trim();
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** A staggered slot per network index: consecutive business days at 9:00am. */
function staggeredSlots(count: number): { date: string; time: string }[] {
  const cursor = new Date();
  const slots: { date: string; time: string }[] = [];
  for (let i = 0; i < count; i++) {
    do {
      cursor.setDate(cursor.getDate() + 1);
    } while (cursor.getDay() === 0 || cursor.getDay() === 6);
    slots.push({ date: ymd(cursor), time: "09:00" });
  }
  return slots;
}

/** Map the generated drafts onto per-network variations. */
function buildVariations(drafts: RepurposeDraft[]): Map<NetworkKey, Variation> {
  const byFormat = new Map(drafts.map((d) => [d.format, d]));
  const linkedin = byFormat.get("linkedin");
  const facebook = byFormat.get("facebook");
  const instagram = byFormat.get("instagram");
  const carousel = byFormat.get("carousel");
  const video = byFormat.get("video_short");
  const base = facebook?.body ?? linkedin?.body ?? instagram?.body ?? "";

  // Staggered slots, one per network (KM + extra) in checklist order.
  const slots = staggeredSlots(KM_NETWORKS.length + EXTRA_NETWORKS.length);
  const slot = (i: number) => slots[i] ?? { date: ymd(new Date()), time: "09:00" };

  const v = new Map<NetworkKey, Variation>();
  v.set("linkedin", { key: "linkedin", copy: linkedin?.body ?? base, draftId: linkedin?.id ?? null, ...slot(0) });
  v.set("facebook", { key: "facebook", copy: facebook?.body ?? base, draftId: facebook?.id ?? null, ...slot(1) });
  v.set("instagram", {
    key: "instagram",
    copy: instagram?.body ?? base,
    carouselScript: carousel?.body,
    draftId: instagram?.id ?? null,
    ...slot(2),
  });
  v.set("gmb", { key: "gmb", copy: seedGmb(base), draftId: null, ...slot(3) });
  v.set("tiktok", { key: "tiktok", copy: video?.body ?? "", isScript: true, draftId: null, ...slot(4) });
  // Extra networks (Threads / Pinterest / YouTube) are seeded too, so choosing
  // one from "+ add network" opens an editable, schedulable tab rather than an
  // inert empty one. They start from the base message and default to unselected.
  EXTRA_NETWORKS.forEach((n, i) => {
    v.set(n.key, { key: n.key, copy: base, draftId: null, ...slot(KM_NETWORKS.length + i) });
  });
  return v;
}

/** The shared "Template" base — the core message the variations came from. */
function templateSeed(drafts: RepurposeDraft[]): string {
  const byFormat = new Map(drafts.map((d) => [d.format, d]));
  return byFormat.get("linkedin")?.body ?? byFormat.get("facebook")?.body ?? drafts[0]?.body ?? "";
}

export function SocialComposerDrawer({
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
  const [variations, setVariations] = useState<Map<NetworkKey, Variation>>(() =>
    buildVariations(drafts),
  );
  const [template, setTemplate] = useState<string>(() => templateSeed(drafts));
  const [selected, setSelected] = useState<Set<NetworkKey>>(
    () => new Set(KM_NETWORKS.map((n) => n.key)),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [active, setActive] = useState<"template" | NetworkKey>("linkedin");
  const [preview, setPreview] = useState<"mobile" | "desktop">("mobile");
  const [slidesOn, setSlidesOn] = useState(true);
  const [scriptOn, setScriptOn] = useState(false);
  // Phase 2 gate: legal review must be confirmed before Approve is available.
  const [legalOk, setLegalOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn"; text: string; recorded: boolean } | null>(
    null,
  );
  const [postErrors, setPostErrors] = useState<Map<NetworkKey, string>>(new Map());

  const selectedList = useMemo(
    () => [...KM_NETWORKS, ...EXTRA_NETWORKS].filter((n) => selected.has(n.key)),
    [selected],
  );

  // Live compliance flags per selected network. A blocking flag stops that post
  // from scheduling until it's cleared (the spec's brand/compliance gate).
  const flagsByNet = useMemo(() => {
    const m = new Map<NetworkKey, ComplianceFlag[]>();
    for (const n of selectedList) {
      const copy = variations.get(n.key)?.copy ?? "";
      if (copy.trim()) m.set(n.key, checkSocialCompliance(copy));
    }
    return m;
  }, [selectedList, variations]);

  const blockedNets = useMemo(
    () => selectedList.filter((n) => (flagsByNet.get(n.key) ?? []).some((f) => f.severity === "block")),
    [selectedList, flagsByNet],
  );

  // Media guard: networks that reject text-only posts (Instagram, TikTok, …)
  // can't schedule until an image or video is attached. Generated slides and
  // manual uploads both land in mediaUrls, so one check covers both.
  const mediaMissingNets = useMemo(
    () =>
      selectedList.filter(
        (n) => n.needsMedia && (variations.get(n.key)?.mediaUrls?.length ?? 0) === 0,
      ),
    [selectedList, variations],
  );

  const toggleNetwork = (key: NetworkKey) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) {
        next.delete(key);
        if (active === key) setActive("template");
      } else {
        next.add(key);
      }
      return next;
    });

  const patchVar = (key: NetworkKey, p: Partial<Variation>) =>
    setVariations((m) => {
      const next = new Map(m);
      const cur = next.get(key);
      if (cur) next.set(key, { ...cur, ...p });
      return next;
    });

  // ---- Manual media upload (Metricool-style) --------------------------------
  const [dragOverNet, setDragOverNet] = useState<NetworkKey | null>(null);

  // Upload one or more files to Supabase and append their URLs to this
  // variation's media. URL only — Ayrshare fetches the stored file at publish.
  const uploadMedia = async (key: NetworkKey, files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const valid = list.filter(
      (f) => SOCIAL_MEDIA_TYPES.includes(f.type) && f.size <= SOCIAL_MEDIA_MAX_BYTES,
    );
    const skipped = list.length - valid.length;
    if (!valid.length) {
      patchVar(key, { mediaMsg: "Only JPG, PNG, or MP4 up to 100MB." });
      return;
    }
    patchVar(key, { mediaBusy: true, mediaMsg: null });
    try {
      const fd = new FormData();
      valid.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/social/assets", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok || !Array.isArray(j?.uploaded) || j.uploaded.length === 0) {
        patchVar(key, { mediaBusy: false, mediaMsg: j?.error || "Upload failed." });
        return;
      }
      const added: UploadedAsset[] = (j.uploaded as UploadedAsset[]).map((a) => ({
        url: a.url,
        kind: a.kind,
        filename: a.filename,
      }));
      setVariations((m) => {
        const next = new Map(m);
        const cur = next.get(key);
        if (cur) {
          next.set(key, {
            ...cur,
            uploads: [...(cur.uploads ?? []), ...added],
            mediaUrls: [...(cur.mediaUrls ?? []), ...added.map((a) => a.url)],
            mediaBusy: false,
            mediaMsg: skipped ? `${skipped} file(s) skipped (type or size).` : null,
          });
        }
        return next;
      });
    } catch {
      patchVar(key, { mediaBusy: false, mediaMsg: "Upload failed." });
    }
  };

  const removeUpload = (key: NetworkKey, url: string) =>
    setVariations((m) => {
      const next = new Map(m);
      const cur = next.get(key);
      if (cur) {
        next.set(key, {
          ...cur,
          uploads: (cur.uploads ?? []).filter((a) => a.url !== url),
          mediaUrls: (cur.mediaUrls ?? []).filter((u) => u !== url),
        });
      }
      return next;
    });

  const generateSlides = async (key: NetworkKey) => {
    const v = variations.get(key);
    if (!v) return;
    patchVar(key, { genBusy: true, genMsg: null });
    try {
      const res = await fetch("/api/content-production/repurpose/carousel-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: v.draftId, script: v.carouselScript ?? v.copy, referenceImages: [] }),
      });
      const j = await res.json();
      if (!res.ok) {
        patchVar(key, { genBusy: false, genMsg: j?.error || "Slide generation failed." });
        return;
      }
      patchVar(key, {
        genBusy: false,
        slides: j.slides as Slide[],
        mediaUrls: j.urls as string[],
        copy: (j.caption as string)?.trim() || v.copy,
        genMsg: j.message || null,
      });
    } catch {
      patchVar(key, { genBusy: false, genMsg: "Slide generation failed." });
    }
  };

  // Script add-on: turn the active variation's copy into a 30–60s reel/video
  // script (hook, body, CTA) and keep it as an asset on the post. Mirrors Slides.
  const generateScript = async (key: NetworkKey) => {
    const v = variations.get(key);
    if (!v?.copy.trim()) return;
    patchVar(key, { scriptBusy: true, scriptMsg: null });
    try {
      const res = await fetch("/api/content-production/repurpose/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: v.draftId, copy: v.copy, platform: key }),
      });
      const j = await res.json();
      if (!res.ok) {
        patchVar(key, { scriptBusy: false, scriptMsg: j?.error || "Script generation failed." });
        return;
      }
      patchVar(key, { scriptBusy: false, reelScript: j.script, scriptMsg: null });
    } catch {
      patchVar(key, { scriptBusy: false, scriptMsg: "Script generation failed." });
    }
  };

  // Approve & schedule — gated on legal review + zero blocking flags. Reuses the
  // existing schedule route (unchanged Ayrshare path). Nothing publishes here on
  // its own; posts land on the Content Calendar at their scheduled time.
  const schedule = async () => {
    if (!legalOk || blockedNets.length > 0 || mediaMissingNets.length > 0) return;
    const posts = buildPosts(true);
    if (!posts.length) return;

    setBusy(true);
    setResult(null);
    setPostErrors(new Map());
    try {
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
      const errs = new Map<NetworkKey, string>();
      for (const r of (j.results ?? []) as Array<{ platform?: string; status?: string; error?: string }>) {
        if (r.status === "failed" && r.platform) errs.set(r.platform as NetworkKey, r.error || "Rejected by Ayrshare.");
      }
      setPostErrors(errs);
      const failed = (j.failed ?? 0) as number;
      setResult({ tone: failed > 0 ? "warn" : "ok", text: j.message || "Scheduled.", recorded: !!j.ok });
      onScheduled?.();
    } catch {
      setResult({ tone: "warn", text: "Scheduling failed.", recorded: false });
    } finally {
      setBusy(false);
    }
  };

  // Build the schedule payload from every ready network. `compliant` = drop any
  // post that still has a blocking flag (used for Approve, not for Save-as-draft).
  const buildPosts = (compliant: boolean) =>
    selectedList
      .map((n) => {
        const v = variations.get(n.key);
        const copy = v?.copy?.trim();
        if (!copy) return null;
        if (compliant && checkSocialCompliance(copy).some((f) => f.severity === "block")) return null;
        // Guard a cleared date/time input: fall back to a default rather than
        // letting `new Date("T09:00")` throw an unhandled RangeError.
        const dt = new Date(`${v?.date || ymd(new Date())}T${v?.time || "09:00"}`);
        if (Number.isNaN(dt.getTime())) return null;
        return {
          draftId: v?.draftId ?? null,
          format: n.key,
          platform: n.key,
          body: copy,
          mediaUrls: v?.mediaUrls ?? [],
          scheduleDate: dt.toISOString(),
        };
      })
      .filter((p): p is NonNullable<{ draftId: string | null; format: NetworkKey; platform: NetworkKey; body: string; mediaUrls: string[]; scheduleDate: string }> => p !== null);

  // Save every ready variation as a draft on the Content Calendar — no Ayrshare,
  // no gate. Drafts are allowed to still carry flags; you clear them before you
  // approve. Approving a draft (from the calendar) is what schedules it.
  const saveDraft = async () => {
    const posts = buildPosts(false);
    if (!posts.length) return;
    setDraftBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/content-production/repurpose/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts, asDraft: true }),
      });
      const j = await res.json();
      if (!res.ok) {
        setResult({ tone: "warn", text: j?.error || "Could not save drafts.", recorded: false });
        return;
      }
      setResult({ tone: "ok", text: j.message || "Saved as drafts.", recorded: !!j.ok });
      onScheduled?.();
    } catch {
      setResult({ tone: "warn", text: "Could not save drafts.", recorded: false });
    } finally {
      setDraftBusy(false);
    }
  };

  const activeVar = active === "template" ? null : variations.get(active) ?? null;
  const activeMeta = active === "template" ? null : META_BY_KEY.get(active) ?? null;
  const activeCopy = active === "template" ? template : activeVar?.copy ?? "";
  const activeTags = hashtagsOf(activeCopy);
  const activeFlags = active === "template" ? [] : flagsByNet.get(active) ?? [];
  const readyCount = selectedList.filter((n) => (variations.get(n.key)?.copy ?? "").trim()).length;
  const canApprove =
    !busy &&
    !draftBusy &&
    readyCount > 0 &&
    legalOk &&
    blockedNets.length === 0 &&
    mediaMissingNets.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-6xl flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Social composer</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              From <span className="font-medium text-slate-700">{topic}</span>. Every platform
              variation is drafted. Review, uncheck any network, then schedule.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-500 hover:border-brand hover:text-brand"
          >
            Close
          </button>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[1fr_360px]">
          {/* ---------------- Composer (left) ---------------- */}
          <div className="flex flex-col overflow-y-auto px-6 py-4">
            {/* Platform checklist */}
            <section>
              <h3 className="text-sm font-semibold text-slate-700">
                Platforms <span className="font-normal text-slate-400">· pre-selected · uncheck to exclude</span>
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {KM_NETWORKS.map((n) => {
                  const on = selected.has(n.key);
                  const flagged = (flagsByNet.get(n.key) ?? []).some((f) => f.severity === "block");
                  return (
                    <button
                      key={n.key}
                      onClick={() => toggleNetwork(n.key)}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        on ? "border-brand/40 bg-brand/5 text-slate-800" : "border-slate-200 bg-slate-50 text-slate-400"
                      }`}
                    >
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: on ? n.color : "#CBD5E1" }} />
                      <span className="font-medium">{n.label}</span>
                      <span className={on ? "text-slate-400" : "text-slate-300"}>· {n.postType}</span>
                      {on && flagged && <span title="Flagged for brand or compliance review" aria-hidden>⚠️</span>}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2">
                {addOpen ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {EXTRA_NETWORKS.map((n) => (
                      <button
                        key={n.key}
                        onClick={() => toggleNetwork(n.key)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
                          selected.has(n.key)
                            ? "border-brand/40 bg-brand/5 text-slate-800"
                            : "border-dashed border-slate-300 text-slate-500 hover:border-brand hover:text-brand"
                        }`}
                      >
                        <span aria-hidden>＋</span> {n.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => setAddOpen(true)}
                    className="rounded-lg border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-brand hover:text-brand"
                  >
                    + add network (Threads, Pinterest, YouTube)
                  </button>
                )}
              </div>
            </section>

            {/* Variation tabs */}
            <section className="mt-5">
              <h3 className="text-sm font-semibold text-slate-700">
                Variations <span className="font-normal text-slate-400">· auto-generated · one tab per platform</span>
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200">
                <TabButton label="Template" activeTab={active === "template"} onClick={() => setActive("template")} />
                {selectedList.map((n) => (
                  <TabButton
                    key={n.key}
                    label={n.label}
                    dot={n.color}
                    flagged={(flagsByNet.get(n.key) ?? []).some((f) => f.severity === "block")}
                    activeTab={active === n.key}
                    onClick={() => setActive(n.key)}
                  />
                ))}
              </div>

              {/* Editor */}
              <textarea
                value={activeCopy}
                onChange={(e) =>
                  active === "template" ? setTemplate(e.target.value) : patchVar(active, { copy: e.target.value })
                }
                rows={9}
                className="mt-3 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-relaxed text-slate-800 focus:border-brand focus:outline-none"
              />
              <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                <span>
                  {activeCopy.length}
                  {activeMeta ? ` / ${activeMeta.charLimit.toLocaleString()}` : ""} characters
                </span>
                <span>{activeTags.length} / 30 hashtags</span>
              </div>

              {/* Compliance flags for the active variation — blocks scheduling. */}
              {activeFlags.length > 0 && (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800">
                    ⚠️ Flagged for review — clear these before this post can schedule:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {activeFlags.map((f, i) => (
                      <li key={i} className="text-xs text-amber-800">
                        {f.label}
                        {f.excerpt ? <span className="text-amber-600"> — “{f.excerpt}”</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {active === "template" && (
                <p className="mt-1 text-xs text-slate-400">
                  The shared base message. Each platform tab is its own copy — edit them per network.
                </p>
              )}

              {/* Per-network staggered schedule slot. */}
              {activeVar && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Schedule this {activeMeta?.label} post</span>
                  <input
                    type="date"
                    value={activeVar.date}
                    onChange={(e) => patchVar(activeVar.key, { date: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <input
                    type="time"
                    value={activeVar.time}
                    onChange={(e) => patchVar(activeVar.key, { time: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                  <span className="text-slate-400">· staggered per platform</span>
                </div>
              )}

              {/* Manual media upload (drag-and-drop + file picker) per platform. */}
              {activeVar && (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-600">
                      Media
                      {activeMeta?.needsMedia && (
                        <span className="ml-1 text-amber-600">· required for {activeMeta.label}</span>
                      )}
                    </span>
                    {activeVar.mediaBusy && <span className="text-xs text-slate-400">Uploading…</span>}
                  </div>
                  <label
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverNet(activeVar.key);
                    }}
                    onDragLeave={() => setDragOverNet(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverNet(null);
                      void uploadMedia(activeVar.key, e.dataTransfer.files);
                    }}
                    className={`mt-1.5 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs transition-colors ${
                      dragOverNet === activeVar.key
                        ? "border-brand bg-brand/5 text-brand"
                        : "border-slate-300 text-slate-500 hover:border-brand/50"
                    }`}
                  >
                    <input
                      type="file"
                      accept={SOCIAL_MEDIA_ACCEPT}
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) void uploadMedia(activeVar.key, e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <span aria-hidden className="text-base">⬆︎</span>
                    <span className="mt-1">
                      <strong className="text-slate-700">Drag &amp; drop</strong> or click to upload
                    </span>
                    <span className="text-slate-400">
                      JPG, PNG, or MP4 · up to 100MB · stored in Supabase, sent to Ayrshare by URL
                    </span>
                  </label>
                  {activeVar.mediaMsg && (
                    <p className="mt-1 text-xs text-amber-700">{activeVar.mediaMsg}</p>
                  )}
                  {(activeVar.uploads?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {activeVar.uploads!.map((a) => (
                        <div key={a.url} className="relative">
                          {a.kind === "video" ? (
                            <video
                              src={a.url}
                              muted
                              className="h-20 w-20 rounded-md border border-slate-200 object-cover"
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={a.url}
                              alt={a.filename}
                              className="h-20 w-20 rounded-md border border-slate-200 object-cover"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => removeUpload(activeVar.key, a.url)}
                            title={`Remove ${a.filename}`}
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-xs text-slate-500 shadow-sm hover:text-red-600"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {active !== "template" && postErrors.get(active) && (
                <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  Rejected: {postErrors.get(active)}
                </p>
              )}
            </section>

            {/* Post add-ons */}
            <section className="mt-5">
              <h3 className="text-sm font-semibold text-slate-700">Post add-ons</h3>
              <div className="mt-2 flex flex-wrap items-center gap-6">
                <Toggle label="Generate slides (carousel)" on={slidesOn} onChange={setSlidesOn} />
                <Toggle label="Generate script (reel or video)" on={scriptOn} onChange={setScriptOn} />
              </div>

              {slidesOn && activeVar && activeMeta?.postType === "Carousel" && (
                <div className="mt-3 rounded-lg border border-brand/30 bg-brand/5 p-3">
                  {activeVar.slides?.length ? (
                    <>
                      <div className="mb-1.5 text-xs font-medium text-emerald-700">
                        ✓ {activeVar.slides.length} slide image{activeVar.slides.length > 1 ? "s" : ""} attached — posts as a carousel.
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {activeVar.slides.map((s) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={s.url} src={s.url} alt={`Slide ${s.n}`} className="h-24 w-[76px] shrink-0 rounded-md border border-slate-200 object-cover" />
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-700">
                      <strong>Make it post-ready.</strong> Turn the slide script into on-brand images — the post text becomes the caption.
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => generateSlides(activeVar.key)}
                      disabled={activeVar.genBusy}
                      className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand/90 disabled:opacity-50"
                    >
                      {activeVar.genBusy ? "Generating slide images…" : activeVar.slides?.length ? "Regenerate images" : "Generate slide images →"}
                    </button>
                    {activeVar.genMsg && <span className="text-xs text-slate-500">{activeVar.genMsg}</span>}
                  </div>
                </div>
              )}

              {scriptOn && activeVar && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {activeVar.reelScript ? (
                    <div className="space-y-2 text-xs text-slate-700">
                      <div>
                        <span className="font-semibold text-slate-500">Hook</span>
                        <p className="mt-0.5">{activeVar.reelScript.hook}</p>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Body</span>
                        <p className="mt-0.5 whitespace-pre-wrap">{activeVar.reelScript.body}</p>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Call to action</span>
                        <p className="mt-0.5">{activeVar.reelScript.cta}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-700">
                      <strong>Generate a reel/video script.</strong> A 30–60 second hook, body, and
                      call to action from this post&apos;s copy — record it, then add the video in your channel.
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => generateScript(activeVar.key)}
                      disabled={activeVar.scriptBusy || !activeVar.copy.trim()}
                      className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand/90 disabled:opacity-50"
                    >
                      {activeVar.scriptBusy
                        ? "Writing script…"
                        : activeVar.reelScript
                          ? "Regenerate script"
                          : "Generate script →"}
                    </button>
                    {activeVar.scriptMsg && <span className="text-xs text-slate-500">{activeVar.scriptMsg}</span>}
                  </div>
                </div>
              )}
            </section>

            {/* Approval gate + schedule bar */}
            <section className="mt-6 border-t border-slate-200 pt-4">
              {result && (
                <p
                  className={`mb-3 rounded-md border px-3 py-2 text-sm ${
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

              {/* Legal review — required before Approve. */}
              <label className="flex cursor-pointer items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={legalOk}
                  onChange={(e) => setLegalOk(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-brand"
                />
                <span>
                  I have reviewed these posts for legal accuracy and attorney-advertising compliance.
                </span>
              </label>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-xs text-slate-400">{readyCount} network(s) ready</span>
                {blockedNets.length > 0 && (
                  <span className="text-xs font-medium text-amber-700">
                    ⚠️ {blockedNets.length} flagged post(s) — clear the flags to schedule.
                  </span>
                )}
                {mediaMissingNets.length > 0 && (
                  <span className="text-xs font-medium text-amber-700">
                    🖼️ {mediaMissingNets.map((n) => n.label).join(", ")}{" "}
                    need{mediaMissingNets.length === 1 ? "s" : ""} an image or video attached.
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={onClose}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
                  >
                    {result?.tone === "ok" ? "Done" : "Cancel"}
                  </button>
                  <button
                    onClick={saveDraft}
                    disabled={busy || draftBusy || readyCount === 0}
                    title="Save all variations as drafts on the Content Calendar. Approve each one there to schedule it."
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {draftBusy ? "Saving…" : "Save as draft"}
                  </button>
                  <button
                    onClick={schedule}
                    disabled={!canApprove}
                    title={
                      blockedNets.length > 0
                        ? "Clear the flagged posts first."
                        : mediaMissingNets.length > 0
                          ? `Attach media for ${mediaMissingNets.map((n) => n.label).join(", ")} first.`
                          : !legalOk
                            ? "Confirm the legal review first."
                            : undefined
                    }
                    className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? "Scheduling…" : "Approve & schedule"}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Nothing publishes automatically. Posts stay a draft on the Content Calendar until their scheduled time.
              </p>
            </section>
          </div>

          {/* ---------------- Live preview (right) ---------------- */}
          <div className="hidden flex-col border-l border-slate-200 bg-slate-50 px-5 py-4 lg:flex">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Live preview</h3>
              <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
                {(["mobile", "desktop"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPreview(m)}
                    className={`rounded px-2 py-0.5 text-xs capitalize ${preview === m ? "bg-brand text-white" : "text-slate-500"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex justify-center overflow-y-auto">
              <PreviewCard
                widthClass={preview === "mobile" ? "w-[300px]" : "w-full"}
                network={activeMeta}
                copy={activeCopy}
                tags={activeTags}
                slides={activeVar?.slides}
                uploads={activeVar?.uploads}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  label,
  dot,
  flagged,
  activeTab,
  onClick,
}: {
  label: string;
  dot?: string;
  flagged?: boolean;
  activeTab: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 text-sm transition-colors ${
        activeTab ? "border-brand font-semibold text-brand" : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {dot && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />}
      {label}
      {flagged && <span title="Flagged for brand or compliance review" aria-hidden>⚠️</span>}
    </button>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="flex items-center gap-2 text-sm text-slate-700">
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-slate-300"}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
      </span>
      {label}
      <span className={`text-xs font-semibold ${on ? "text-emerald-600" : "text-slate-400"}`}>{on ? "ON" : "OFF"}</span>
    </button>
  );
}

/** A light platform-styled preview of the active variation. */
function PreviewCard({
  widthClass,
  network,
  copy,
  tags,
  slides,
  uploads,
}: {
  widthClass: string;
  network: NetworkMeta | null;
  copy: string;
  tags: string[];
  slides?: Slide[];
  uploads?: UploadedAsset[];
}) {
  const bodyText = copy.replace(/(^|\n)\s*(#[\p{L}\p{N}_]+(\s+#[\p{L}\p{N}_]+)*)\s*$/u, "").trim();
  const upload = uploads?.[0];
  return (
    <div className={`${widthClass} rounded-xl border border-slate-200 bg-white p-4 shadow-sm`}>
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">KM</span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-800">Katz Melinger PLLC</p>
          <p className="text-xs text-slate-400">{network ? network.label : "Base message"}</p>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{bodyText || "…"}</p>
      {tags.length > 0 && <p className="mt-2 text-sm text-brand">{tags.slice(0, 8).join(" ")}</p>}
      {upload ? (
        upload.kind === "video" ? (
          <video src={upload.url} muted controls className="mt-3 w-full rounded-lg border border-slate-200 object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={upload.url} alt={upload.filename} className="mt-3 w-full rounded-lg border border-slate-200 object-cover" />
        )
      ) : slides?.length ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slides[0].url} alt="Carousel" className="mt-3 w-full rounded-lg border border-slate-200 object-cover" />
      ) : network?.needsMedia ? (
        <div className="mt-3 flex h-40 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">Image / carousel</div>
      ) : null}
      <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">Like · Comment · Share</div>
    </div>
  );
}
