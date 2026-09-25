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
 *   - Nothing publishes automatically on its own. "Approve & schedule" and,
 *     per network, "Publish now" (S11 — one confirm, immediate) are the two
 *     deliberate steps; both reuse the same schedule + gate + Ayrshare path.
 *
 * Generation is untouched: the drafts come from the existing repurpose run.
 * Google Business is seeded from the Facebook copy; TikTok carries the short-
 * video script. Neither adds a generation format.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { judgeVertical, measureAspect, type Dimensions } from "@/lib/media-aspect";
import Link from "next/link";

import type { RepurposeDraft } from "@/components/repurpose-review-drawer";
import { checkSocialCompliance, type ComplianceFlag } from "@/lib/social-compliance";
import { bestSlot, topSlots, nyWallClockToUtc } from "@/lib/social-best-time";
import type { AngleConflict } from "@/lib/social-duplicate";

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

// Per-platform post formats (master-spec 4A). Each network exposes only its valid
// formats; the first is the default. Instagram now defaults to a single Post.
// Google Business Offer and Event are deliberately absent: both require a title
// and start/end dates that this composer has no fields for, and the firm doesn't
// post promotions or events to Google — it posts article updates. Offering them
// would only let someone pick a format that can't publish.
type PostFormat =
  | "post" | "reel" | "story" | "carousel" | "video"
  | "whats_new" | "pin" | "short";

const FORMAT_LABEL: Record<PostFormat, string> = {
  post: "Post", reel: "Reel", story: "Story", carousel: "Carousel", video: "Video",
  whats_new: "What's new", pin: "Pin", short: "Short",
};

// Media requirement per format, enforced by the media guard before scheduling.
type MediaRule = "none" | "media" | "vertical" | "carousel";
const FORMAT_MEDIA: Record<PostFormat, MediaRule> = {
  post: "none", reel: "vertical", story: "vertical", carousel: "carousel", video: "vertical",
  whats_new: "none", pin: "media", short: "vertical",
};

type NetworkMeta = {
  key: NetworkKey;
  label: string;
  /** Valid formats for this network; formats[0] is the default. */
  formats: PostFormat[];
  /** Character limit surfaced in the counter for this network. */
  charLimit: number;
  /** Dot color in the checklist + preview accent. */
  color: string;
};

const defaultFormat = (n: NetworkMeta): PostFormat => n.formats[0];

// The five KM networks, pre-selected. Order matches the checklist + tabs.
const KM_NETWORKS: NetworkMeta[] = [
  { key: "linkedin", label: "LinkedIn", formats: ["post"], charLimit: 3000, color: "#0A66C2" },
  { key: "facebook", label: "Facebook", formats: ["post", "reel", "story", "carousel"], charLimit: 2000, color: "#1877F2" },
  { key: "instagram", label: "Instagram", formats: ["post", "reel", "story", "carousel"], charLimit: 2200, color: "#C13584" },
  { key: "gmb", label: "Google", formats: ["whats_new"], charLimit: 1500, color: "#34A853" },
  { key: "tiktok", label: "TikTok", formats: ["video"], charLimit: 2200, color: "#111827" },
];

// Extra networks behind "+ add network". X is intentionally absent.
const EXTRA_NETWORKS: NetworkMeta[] = [
  { key: "threads", label: "Threads", formats: ["post"], charLimit: 500, color: "#111827" },
  { key: "pinterest", label: "Pinterest", formats: ["pin"], charLimit: 500, color: "#E60023" },
  { key: "youtube", label: "YouTube", formats: ["short"], charLimit: 1000, color: "#FF0000" },
];

const META_BY_KEY = new Map<NetworkKey, NetworkMeta>(
  [...KM_NETWORKS, ...EXTRA_NETWORKS].map((n) => [n.key, n]),
);

// Client-side upload validation (mirrors lib/social-assets.ts on the server).
const SOCIAL_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "video/mp4"];
const SOCIAL_MEDIA_ACCEPT = SOCIAL_MEDIA_TYPES.join(",");
const SOCIAL_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

/** S12 — the version history a rewrite/regenerate returns, shaped exactly as
 *  the API responds (snake_case, matching the spec's own field names). */
type RewriteVersionClient = { version_id: string; text: string; created_at: string; source: string };
type RewriteStateClient = {
  active_version_id: string;
  versions: RewriteVersionClient[];
  rejected_version_ids: string[];
};
type RewriteActionKey = "rewrite" | "more_engaging" | "cta_change" | "revert";

type Slide = { n: number; headline: string; url: string };

/** A manually-uploaded image/video (Metricool-style upload). Its `url` is also
 *  pushed into the variation's mediaUrls so it flows to Ayrshare. */
type UploadedAsset = { url: string; kind: "image" | "video"; filename: string };

type Variation = {
  key: NetworkKey;
  /** Chosen post format for this platform (4A). Unset = the network's default. */
  format?: PostFormat;
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
  /** S12 — version history from the last rewrite/regenerate call, if any. */
  rewrite?: RewriteStateClient;
  rewriteBusy?: RewriteActionKey | null;
  rewriteMsg?: string | null;
  /** S13's legal alert (6.14) — set when the last rewrite's gate found a
   *  critical legal problem with the new text. Cleared by the next call that
   *  doesn't. */
  legalFlag?: string[] | null;
};

/** Human label for a duplicate/angle conflict, naming the matching post. */
function conflictLabel(c: AngleConflict): string {
  const d = new Date(c.date);
  const when = Number.isNaN(d.getTime()) ? "" : ` on ${d.toLocaleDateString()}`;
  const plat = META_BY_KEY.get(c.platform as NetworkKey)?.label ?? c.platform;
  return c.reason === "same-source"
    ? `Same source already posted (${plat}${when})`
    : `Similar angle already scheduled (${plat}${when})`;
}

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

/** "Now" as an America/New_York calendar date + hour, regardless of the
 *  browser's own timezone (the slots and the schedule inputs are all ET). */
function nyNow(): { base: Date; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0;
  // A UTC-midnight anchor for NY's calendar date, so getUTCDay/getUTCDate give
  // the ET weekday and clean day arithmetic (no DST drift on the date itself).
  const base = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  return { base, hour };
}

/** The next upcoming {date, time} whose weekday matches `targetDay` (0=Sun..6=Sat)
 *  at `targetHour`, skipping today if that hour has already passed. Computed in
 *  America/New_York (the zone the composer's date/time inputs represent). */
function nextSlotDate(targetDay: number, targetHour: number): { date: string; time: string } {
  const { base, hour: nyHour } = nyNow();
  const cursor = new Date(base);
  for (let i = 0; i < 8; i++) {
    if (i > 0) cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getUTCDay() !== targetDay) continue;
    if (i === 0 && targetHour <= nyHour) continue; // slot already passed today (ET)
    const d = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    return { date: d, time: `${String(targetHour).padStart(2, "0")}:00` };
  }
  const d = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
  return { date: d, time: `${String(targetHour).padStart(2, "0")}:00` };
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

/** Map the generated drafts onto per-network variations.
 *  presetDate (YYYY-MM-DD), when given, pins every network to that day —
 *  e.g. when opened by clicking a specific day on the Content Calendar —
 *  instead of the default staggered-across-business-days slots. Each
 *  network keeps its own default time so they don't literally collide. */
function buildVariations(
  drafts: RepurposeDraft[],
  presetDate?: string | null,
): Map<NetworkKey, Variation> {
  const byFormat = new Map(drafts.map((d) => [d.format, d]));
  const linkedin = byFormat.get("linkedin");
  const facebook = byFormat.get("facebook");
  const instagram = byFormat.get("instagram");
  const carousel = byFormat.get("carousel");
  const video = byFormat.get("video_short");
  const base = facebook?.body ?? linkedin?.body ?? instagram?.body ?? "";

  // Staggered slots, one per network (KM + extra) in checklist order — the
  // fallback for a network with no best-time benchmark at all.
  const slots = staggeredSlots(KM_NETWORKS.length + EXTRA_NETWORKS.length);
  // S7/6.8 — pre-fill the network's OWN top best-time slot by default rather
  // than a generic staggered time, so "best time" is what a reviewer sees
  // without having to click anything first. When opened from a specific
  // calendar day (presetDate), the day is already fixed, so only the hour
  // comes from the benchmark; with no presetDate, both the day and hour do.
  const slot = (i: number, key: NetworkKey) => {
    const fallback = slots[i] ?? { date: ymd(new Date()), time: "09:00" };
    const top = bestSlot(key);
    if (presetDate) {
      return { date: presetDate, time: top ? `${String(top.hour).padStart(2, "0")}:00` : fallback.time };
    }
    return top ? nextSlotDate(top.day, top.hour) : fallback;
  };

  const v = new Map<NetworkKey, Variation>();
  v.set("linkedin", { key: "linkedin", copy: linkedin?.body ?? base, draftId: linkedin?.id ?? null, ...slot(0, "linkedin") });
  v.set("facebook", { key: "facebook", copy: facebook?.body ?? base, draftId: facebook?.id ?? null, ...slot(1, "facebook") });
  v.set("instagram", {
    key: "instagram",
    copy: instagram?.body ?? base,
    carouselScript: carousel?.body,
    draftId: instagram?.id ?? null,
    ...slot(2, "instagram"),
  });
  v.set("gmb", { key: "gmb", copy: seedGmb(base), draftId: null, ...slot(3, "gmb") });
  // draftId wired to the video_short draft (was hardcoded null) so TikTok's
  // script can be rewritten (6.13) like the other AI-generated formats.
  v.set("tiktok", { key: "tiktok", copy: video?.body ?? "", isScript: true, draftId: video?.id ?? null, ...slot(4, "tiktok") });
  // Extra networks (Threads / Pinterest / YouTube) are seeded too, so choosing
  // one from "+ add network" opens an editable, schedulable tab rather than an
  // inert empty one. They start from the base message and default to unselected.
  EXTRA_NETWORKS.forEach((n, i) => {
    v.set(n.key, { key: n.key, copy: base, draftId: null, ...slot(KM_NETWORKS.length + i, n.key) });
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
  initialDate,
  onClose,
  onScheduled,
}: {
  topic: string;
  drafts: RepurposeDraft[];
  /** YYYY-MM-DD to preset every network's schedule date to — set when the
   *  composer was opened by clicking a day (or day+hour) on the Content
   *  Calendar rather than the toolbar's "+ Create post" button. */
  initialDate?: string | null;
  onClose: () => void;
  onScheduled?: () => void;
}) {
  const [variations, setVariations] = useState<Map<NetworkKey, Variation>>(() =>
    buildVariations(drafts, initialDate),
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
  // Feature 8 — live duplicate/angle check against the whole calendar.
  const [dupByNet, setDupByNet] = useState<Map<NetworkKey, AngleConflict>>(new Map());
  const [dupAck, setDupAck] = useState(false);

  // S1 operating brief (social phone/offer) — fetched once so the LIVE compliance
  // preview below actually catches the same wrong_phone/missing_offer flags the
  // server-side gate does at approve/schedule time, instead of silently never
  // firing them because it never received the context. No ctaType is available
  // here (the composer doesn't compute one per variation the way generateSocialPosts
  // does), so missing_offer still can't fire from this component — only wrong_phone
  // and the Instagram link-CTA check (which only needs `platform`) are covered.
  // No hardcoded default here: checkSocialCompliance's wrong_phone check is a
  // no-op while ctx.socialPhone is falsy (lib/social-compliance.ts), so the
  // check simply stays inactive until the real value loads — no local copy of
  // lib/social-operating-brief.ts's server-only default to keep in sync.
  const [socialPhone, setSocialPhone] = useState<string | undefined>(undefined);
  // Same reasoning for the disclaimer URL: while it is undefined the
  // missing_disclaimer_link check is a no-op, so the composer never demands a
  // link it does not yet know the address of.
  const [disclaimerUrl, setDisclaimerUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/brand-voice/settings")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const settings = (j?.settings ?? {}) as Record<string, string>;
        if (settings.socialPhone) setSocialPhone(settings.socialPhone);
        if (settings.socialDisclaimerUrl) setDisclaimerUrl(settings.socialDisclaimerUrl);
      })
      .catch(() => {
        /* stays undefined — the wrong_phone check just doesn't run */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedList = useMemo(
    () => [...KM_NETWORKS, ...EXTRA_NETWORKS].filter((n) => selected.has(n.key)),
    [selected],
  );

  // Debounced duplicate check: compare each selected variation's copy against the
  // calendar and surface "similar angle already scheduled" before the user
  // schedules. Keyed on the copies only, so it doesn't re-run on time/media edits.
  const dupPayload = useMemo(
    () =>
      selectedList
        .map((n) => ({ platform: n.key, body: variations.get(n.key)?.copy ?? "" }))
        .filter((p) => p.body.trim().length > 0),
    [selectedList, variations],
  );
  const dupKey = useMemo(() => JSON.stringify(dupPayload), [dupPayload]);
  // Monotonic request id so a slow earlier response can't clobber a newer one;
  // and the signature of the last duplicate set, so we only force re-ack when the
  // matched networks actually change (not on every keystroke elsewhere).
  const dupReqRef = useRef(0);
  const dupSigRef = useRef("");
  useEffect(() => {
    if (!dupPayload.length) {
      setDupByNet(new Map());
      dupSigRef.current = "";
      return;
    }
    const mySeq = ++dupReqRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/social/duplicate-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ posts: dupPayload }),
        });
        const j = await res.json();
        if (mySeq !== dupReqRef.current) return; // a newer request superseded this one
        if (!res.ok || !Array.isArray(j?.matches)) return;
        const next = new Map<NetworkKey, AngleConflict>();
        for (const m of j.matches as { platform: string; conflict: AngleConflict | null }[]) {
          if (m.conflict) next.set(m.platform as NetworkKey, m.conflict);
        }
        setDupByNet(next);
        // Only require re-acknowledgement when the set of duplicate networks
        // changed — editing unrelated copy shouldn't silently uncheck the box.
        const sig = [...next.keys()].sort().join(",");
        if (sig !== dupSigRef.current) {
          dupSigRef.current = sig;
          setDupAck(false);
        }
      } catch {
        /* advisory only */
      }
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey]);

  const duplicateNets = useMemo(
    () => selectedList.filter((n) => dupByNet.has(n.key)),
    [selectedList, dupByNet],
  );

  // Live compliance flags per selected network. A blocking flag stops that post
  // from scheduling until it's cleared (the spec's brand/compliance gate).
  const flagsByNet = useMemo(() => {
    const m = new Map<NetworkKey, ComplianceFlag[]>();
    for (const n of selectedList) {
      const copy = variations.get(n.key)?.copy ?? "";
      if (copy.trim()) {
        m.set(
          n.key,
          checkSocialCompliance(copy, {
            socialPhone,
            platform: n.key,
            format: variations.get(n.key)?.format,
            disclaimerUrl,
          }),
        );
      }
    }
    return m;
  }, [selectedList, variations, socialPhone, disclaimerUrl]);

  const blockedNets = useMemo(
    () => selectedList.filter((n) => (flagsByNet.get(n.key) ?? []).some((f) => f.severity === "block")),
    [selectedList, flagsByNet],
  );

  // Media guard: networks that reject text-only posts (Instagram, TikTok, …)
  // can't schedule until an image or video is attached. Generated slides and
  // manual uploads both land in mediaUrls, so one check covers both.
  // Resolve a network's chosen format (falls back to its default).
  const formatOf = (key: NetworkKey): PostFormat =>
    variations.get(key)?.format ?? defaultFormat(META_BY_KEY.get(key)!);

  // Measured pixel dimensions per media URL, so the vertical guard can check the
  // shape and not just the count. null = measured and unreadable (CORS, decode
  // failure); absent = not measured yet. Both are treated as "don't block".
  const [aspects, setAspects] = useState<Map<string, Dimensions | null>>(new Map());

  useEffect(() => {
    const urls = new Set<string>();
    for (const v of variations.values()) for (const u of v.mediaUrls ?? []) urls.add(u);
    const pending = [...urls].filter((u) => !aspects.has(u));
    if (pending.length === 0) return;

    let cancelled = false;
    void Promise.all(pending.map(async (u) => [u, await measureAspect(u)] as const)).then((pairs) => {
      if (cancelled) return;
      setAspects((prev) => {
        const next = new Map(prev);
        for (const [u, d] of pairs) next.set(u, d);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [variations, aspects]);

  // Format-aware media guard: Reel/Story need a vertical asset, carousel needs
  // 2+ images, feed Post needs nothing. Returns the shortfall reason, or null.
  const mediaShortfall = (n: NetworkMeta): string | null => {
    const rule = FORMAT_MEDIA[formatOf(n.key)];
    if (rule === "none") return null;
    const urls = variations.get(n.key)?.mediaUrls ?? [];
    const count = urls.length;
    if (rule === "carousel") return count >= 2 ? null : "needs 2+ images";
    if (rule === "vertical") {
      if (count < 1) return "needs a vertical (9:16) video or image";
      // The first attachment is the one that becomes the Reel/Story, so it's the
      // one whose shape matters. Unmeasured assets pass — see judgeVertical.
      const verdict = judgeVertical(aspects.get(urls[0]) ?? null);
      return verdict.ok ? null : verdict.reason;
    }
    return count >= 1 ? null : "needs an image or video";
  };
  const mediaMissingNets = useMemo(
    () => selectedList.filter((n) => mediaShortfall(n) !== null),
    // mediaShortfall closes over `variations` (a dep), so this stays correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedList, variations],
  );

  // S13's legal alert (6.14): a network whose last rewrite came back legally
  // flagged can't schedule until a fresh, unflagged rewrite (or a revert to a
  // clean version) clears it — same "cannot be scheduled" bar as a blocking
  // compliance flag.
  const legalFlaggedNets = useMemo(
    () => selectedList.filter((n) => (variations.get(n.key)?.legalFlag?.length ?? 0) > 0),
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

  // S12 — Rewrite / More engaging / Change CTA, plus reverting to a past
  // version. All three actions and revert go through the same endpoint;
  // the server re-runs the S3 + legal gate (6.14) against the new text
  // before returning, so a legal problem shows up here immediately rather
  // than only surfacing later at Schedule.
  const applyRewriteResult = (
    key: NetworkKey,
    j: {
      body: string;
      rewrite: RewriteStateClient;
      gate: { legalFlagged: boolean; reasons: string[] };
    },
  ) =>
    patchVar(key, {
      copy: j.body,
      rewrite: j.rewrite,
      legalFlag: j.gate.legalFlagged ? j.gate.reasons.filter((r) => r.startsWith("Legal review:")) : null,
      rewriteBusy: null,
      rewriteMsg: null,
    });

  const runRewrite = async (key: NetworkKey, action: "rewrite" | "more_engaging" | "cta_change") => {
    const v = variations.get(key);
    if (!v?.draftId) return;
    patchVar(key, { rewriteBusy: action, rewriteMsg: null });
    try {
      const res = await fetch(`/api/content-production/social/${v.draftId}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, platforms: [key] }),
      });
      const j = await res.json();
      if (!res.ok) {
        patchVar(key, { rewriteBusy: null, rewriteMsg: j?.error || "Rewrite failed." });
        return;
      }
      applyRewriteResult(key, j);
    } catch {
      patchVar(key, { rewriteBusy: null, rewriteMsg: "Rewrite failed." });
    }
  };

  const revertToVersion = async (key: NetworkKey, versionId: string) => {
    const v = variations.get(key);
    if (!v?.draftId) return;
    patchVar(key, { rewriteBusy: "revert", rewriteMsg: null });
    try {
      const res = await fetch(`/api/content-production/social/${v.draftId}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revert", versionId, platforms: [key] }),
      });
      const j = await res.json();
      if (!res.ok) {
        patchVar(key, { rewriteBusy: null, rewriteMsg: j?.error || "Revert failed." });
        return;
      }
      applyRewriteResult(key, j);
    } catch {
      patchVar(key, { rewriteBusy: null, rewriteMsg: "Revert failed." });
    }
  };

  const REWRITE_SOURCE_LABEL: Record<string, string> = {
    original: "Original",
    rewrite: "Rewrite",
    more_engaging: "More engaging",
    cta_change: "CTA change",
  };

  // Fill this network's slot with ONE specific recommended time (day/hour from
  // a benchmark slot, per lib/social-best-time.ts). Used by each inline chip,
  // not just the top one — 6.8 wants every ranked slot pickable, not only the
  // single best.
  const applySlot = (key: NetworkKey, day: number, hour: number) => {
    const { date, time } = nextSlotDate(day, hour);
    patchVar(key, { date, time });
  };

  const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function formatSlotLabel(day: number, hour: number): string {
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    const ampm = hour < 12 ? "AM" : "PM";
    return `${WEEKDAY_ABBR[day]} ${h12}:00 ${ampm}`;
  }
  /** Best-effort highlight: does this variation's current date/time already
   *  match this slot's weekday + hour? Parsed as UTC to match how
   *  nextSlotDate/staggeredSlots compute the date string in the first place. */
  function isSlotActive(v: Variation, day: number, hour: number): boolean {
    if (!v.date) return false;
    const d = new Date(`${v.date}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.getUTCDay() === day && v.time === `${String(hour).padStart(2, "0")}:00`;
  }

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
        // Keep any manually-uploaded media and swap in the fresh slide URLs —
        // rebuilding from `uploads` avoids both losing the upload and piling up
        // stale slide URLs on regenerate.
        mediaUrls: [...(v.uploads ?? []).map((a) => a.url), ...(j.urls as string[])],
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
  // publishNow (item 15) sends straight out instead of queueing; it clears the
  // same gates either way — a "Publish now" that skipped the legal-flag check
  // would be the one path around it.
  const schedule = async (publishNow = false) => {
    if (!legalOk || blockedNets.length > 0 || legalFlaggedNets.length > 0 || mediaMissingNets.length > 0) return;
    if (duplicateNets.length > 0 && !dupAck) return;
    const posts = buildPosts(true);
    if (!posts.length) {
      setResult({ tone: "warn", text: "Nothing ready to schedule — add copy (and a valid time) to a platform.", recorded: false });
      return;
    }

    // S11 — Publish now goes out immediately and cannot be recalled, so it is
    // the one action here that asks first. Every gate above still applies: this
    // confirm is about timing, not about bypassing a check.
    if (publishNow) {
      const names = selectedList.map((n) => n.label).join(", ");
      const ok = window.confirm(
        `Publish to ${names} right now?

This posts immediately instead of waiting for the scheduled time. It cannot be undone from here.`,
      );
      if (!ok) return;
    }

    setBusy(true);
    setResult(null);
    setPostErrors(new Map());
    try {
      const res = await fetch("/api/content-production/repurpose/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts, ackDuplicates: dupAck, publishNow }),
      });
      const j = await res.json();
      if (!res.ok) {
        setResult({ tone: "warn", text: j?.error || "Scheduling failed.", recorded: false });
        return;
      }
      const errs = new Map<NetworkKey, string>();
      for (const r of (j.results ?? []) as Array<{ platform?: string; status?: string; error?: string }>) {
        // "flagged" (held by the compliance/legal gate) is just as much a
        // not-actually-scheduled outcome as "failed" (Ayrshare rejection) —
        // both need to show up as a per-network error, not read as success.
        if ((r.status === "failed" || r.status === "flagged") && r.platform) {
          errs.set(r.platform as NetworkKey, r.error || "Held for review.");
        }
      }
      setPostErrors(errs);
      const failed = (j.failed ?? 0) as number;
      const flagged = (j.flagged ?? 0) as number;
      setResult({
        tone: failed > 0 || flagged > 0 ? "warn" : "ok",
        text: j.message || (publishNow ? "Published." : "Scheduled."),
        recorded: !!j.ok,
      });
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
        if (
          compliant &&
          checkSocialCompliance(copy, {
            socialPhone,
            platform: n.key,
            format: variations.get(n.key)?.format,
            disclaimerUrl,
          }).some((f) => f.severity === "block")
        )
          return null;
        // A legal alert (6.14) from the last rewrite is just as blocking as a
        // compliance flag — a stale "it passed before I clicked Rewrite" post
        // must not slip through Approve.
        if (compliant && (v?.legalFlag?.length ?? 0) > 0) return null;
        // The date/time inputs are America/New_York wall-clock. Convert to the
        // correct UTC instant explicitly (offset-less strings would otherwise be
        // parsed as browser-local, wrong on any non-ET machine). Ayrshare +
        // scheduled_at both expect UTC ISO.
        const dt = nyWallClockToUtc(v?.date || ymd(new Date()), v?.time || "09:00");
        if (Number.isNaN(dt.getTime())) return null;
        return {
          draftId: v?.draftId ?? null,
          format: n.key,
          platform: n.key,
          postType: formatOf(n.key),
          body: copy,
          mediaUrls: v?.mediaUrls ?? [],
          scheduleDate: dt.toISOString(),
        };
      })
      .filter((p): p is NonNullable<{ draftId: string | null; format: NetworkKey; platform: NetworkKey; postType: PostFormat; body: string; mediaUrls: string[]; scheduleDate: string }> => p !== null);

  // Save every ready variation as a draft on the Content Calendar — no Ayrshare,
  // no gate. Drafts park as-is even if they'd trip a rule; the brand/compliance
  // gate is re-checked when the draft is approved from the calendar.
  const saveDraft = async () => {
    const posts = buildPosts(false);
    if (!posts.length) {
      setResult({ tone: "warn", text: "Nothing to save — add copy to at least one platform.", recorded: false });
      return;
    }
    setDraftBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/content-production/repurpose/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts, asDraft: true, ackDuplicates: dupAck }),
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
  const activeDup = active === "template" ? null : dupByNet.get(active) ?? null;
  const readyCount = selectedList.filter((n) => (variations.get(n.key)?.copy ?? "").trim()).length;
  const canApprove =
    !busy &&
    !draftBusy &&
    readyCount > 0 &&
    legalOk &&
    blockedNets.length === 0 &&
    legalFlaggedNets.length === 0 &&
    mediaMissingNets.length === 0 &&
    (duplicateNets.length === 0 || dupAck);

  // S11 — "Publish now": the single active tab's post, immediately, behind a
  // confirm. Depends on S10 (done) and still requires the S3 gate — that gate
  // is enforced server-side (gateSocialPost runs for every non-draft post
  // regardless of scheduleDate), this is just the same set of client-side
  // preconditions Approve already checks, scoped to one network instead of
  // the whole selected set.
  const canPublishNow =
    !busy &&
    !draftBusy &&
    activeVar !== null &&
    activeMeta !== null &&
    activeCopy.trim().length > 0 &&
    legalOk &&
    activeFlags.every((f) => f.severity !== "block") &&
    !(activeVar.legalFlag && activeVar.legalFlag.length > 0) &&
    mediaShortfall(activeMeta) === null;

  const publishNow = async () => {
    if (!activeVar || active === "template") return;
    const key = active;
    const copy = activeVar.copy.trim();
    if (!copy) return;
    const label = META_BY_KEY.get(key)?.label ?? key;
    if (!window.confirm(`Publish this ${label} post now? It goes live immediately — this isn't a scheduled time, it's real right now.`)) {
      return;
    }
    setBusy(true);
    setResult(null);
    setPostErrors(new Map());
    try {
      // A moment in the past, not the future — the schedule route already
      // treats an elapsed time as "publish now" rather than a stale slot
      // (see app/api/content-production/repurpose/schedule/route.ts's
      // `futureAt` check), so this reuses that path exactly rather than
      // adding a second one.
      const scheduleDate = new Date(Date.now() - 60_000).toISOString();
      const post = {
        draftId: activeVar.draftId,
        format: key,
        platform: key,
        postType: formatOf(key),
        body: copy,
        mediaUrls: activeVar.mediaUrls ?? [],
        scheduleDate,
      };
      const res = await fetch("/api/content-production/repurpose/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts: [post], ackDuplicates: true }),
      });
      const j = await res.json();
      if (!res.ok) {
        setResult({ tone: "warn", text: j?.error || "Publish failed.", recorded: false });
        return;
      }
      const r = (j.results ?? [])[0] as { status?: string; error?: string } | undefined;
      if (r && (r.status === "failed" || r.status === "flagged")) {
        setPostErrors(new Map([[key, r.error || "Held for review."]]));
        setResult({ tone: "warn", text: r.error || "Could not publish.", recorded: false });
      } else {
        setResult({ tone: "ok", text: `Published to ${label} now.`, recorded: true });
        onScheduled?.();
      }
    } catch {
      setResult({ tone: "warn", text: "Publish failed.", recorded: false });
    } finally {
      setBusy(false);
    }
  };

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
                  const fmt = formatOf(n.key);
                  return (
                    <div
                      key={n.key}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm transition-colors ${
                        on ? "border-brand/40 bg-brand/5 text-slate-800" : "border-slate-200 bg-slate-50 text-slate-400"
                      }`}
                    >
                      <button type="button" onClick={() => toggleNetwork(n.key)} className="inline-flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: on ? n.color : "#CBD5E1" }} />
                        <span className="font-medium">{n.label}</span>
                      </button>
                      {on && n.formats.length > 1 ? (
                        <select
                          value={fmt}
                          onChange={(e) => patchVar(n.key, { format: e.target.value as PostFormat })}
                          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-600"
                          title="Post format"
                        >
                          {n.formats.map((f) => (
                            <option key={f} value={f}>{FORMAT_LABEL[f]}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={on ? "text-slate-400 text-xs" : "text-slate-300 text-xs"}>· {FORMAT_LABEL[fmt]}</span>
                      )}
                      {on && flagged && <span title="Flagged for brand or compliance review" aria-hidden>⚠️</span>}
                    </div>
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

              {/* S12 — Rewrite / More engaging / Change CTA. Only for networks
                  with a real generated draft behind them (the derived/manual
                  tabs like GMB or Threads have no draft to regenerate). */}
              {activeVar?.draftId && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runRewrite(activeVar.key, "rewrite")}
                    disabled={!!activeVar.rewriteBusy}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title="A distinctly different angle on the same source"
                  >
                    {activeVar.rewriteBusy === "rewrite" ? "Rewriting…" : "↻ Rewrite"}
                  </button>
                  <button
                    type="button"
                    onClick={() => runRewrite(activeVar.key, "more_engaging")}
                    disabled={!!activeVar.rewriteBusy}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title="Same angle, sharper hook and energy"
                  >
                    {activeVar.rewriteBusy === "more_engaging" ? "Punching up…" : "⚡ More engaging"}
                  </button>
                  <button
                    type="button"
                    onClick={() => runRewrite(activeVar.key, "cta_change")}
                    disabled={!!activeVar.rewriteBusy}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    title="Keep the hook and body, swap the closing CTA"
                  >
                    {activeVar.rewriteBusy === "cta_change" ? "Changing CTA…" : "Change CTA"}
                  </button>
                  {activeVar.rewrite && activeVar.rewrite.versions.length > 1 && (
                    <label className="flex items-center gap-1 text-xs text-slate-500">
                      <span>
                        Version{" "}
                        {activeVar.rewrite.versions.findIndex(
                          (v) => v.version_id === activeVar.rewrite!.active_version_id,
                        ) + 1}{" "}
                        of {activeVar.rewrite.versions.length}
                      </span>
                      <select
                        value={activeVar.rewrite.active_version_id}
                        onChange={(e) => revertToVersion(activeVar.key, e.target.value)}
                        disabled={!!activeVar.rewriteBusy}
                        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                      >
                        {activeVar.rewrite.versions.map((ver, i) => (
                          <option key={ver.version_id} value={ver.version_id}>
                            {i + 1}. {REWRITE_SOURCE_LABEL[ver.source] ?? ver.source}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {activeVar.rewriteMsg && <span className="text-xs text-rose-600">{activeVar.rewriteMsg}</span>}
                </div>
              )}

              {/* S13's legal alert (6.14) — the last rewrite's legal check
                  found a real problem. Separate from the brand/compliance
                  flags above: this one can only be cleared by another rewrite
                  or a revert, never by editing the text by hand (an edit
                  doesn't re-run the legal check until the next rewrite). */}
              {activeVar?.legalFlag && activeVar.legalFlag.length > 0 && (
                <div className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2">
                  <p className="text-xs font-semibold text-rose-800">
                    ⚠ Legal alert — this version cannot be scheduled:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {activeVar.legalFlag.map((r, i) => (
                      <li key={i} className="text-xs text-rose-800">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* S11 — Publish now: one confirm, this network only, immediately.
                  Only for networks with a real draft — same scope as the
                  rewrite actions above. */}
              {activeVar?.draftId && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={publishNow}
                    disabled={!canPublishNow}
                    title={
                      !legalOk
                        ? "Confirm the legal review first."
                        : activeFlags.some((f) => f.severity === "block")
                          ? "Clear the flagged issues first."
                          : activeVar.legalFlag && activeVar.legalFlag.length > 0
                            ? "Clear the legal alert first."
                            : activeMeta && mediaShortfall(activeMeta)
                              ? "Attach the required media first."
                              : undefined
                    }
                    className="rounded-md border border-rose-300 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? "Publishing…" : "🚀 Publish now"}
                  </button>
                </div>
              )}

              {/* Duplicate/angle alert for the active variation. */}
              {activeDup && (
                <div className="mt-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2">
                  <p className="text-xs font-semibold text-orange-800">
                    ≈ {conflictLabel(activeDup)}
                  </p>
                  <p className="mt-0.5 text-xs text-orange-700">
                    Review the existing post before scheduling — or acknowledge below to schedule anyway.
                  </p>
                </div>
              )}

              {active === "template" && (
                <p className="mt-1 text-xs text-slate-400">
                  The shared base message. Each platform tab is its own copy — edit them per network.
                </p>
              )}

              {/* Per-network schedule slot — pre-filled to the network's own
                  top best-time slot by buildVariations (S7/6.8), still
                  editable here directly. */}
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
                  <span className="text-slate-400">· Eastern</span>
                </div>
              )}

              {/* S7/6.8 — the ranked best-time slots themselves, inline and
                  clickable, tinted by strength, instead of hidden behind a
                  single "Apply best time" button. The currently-set slot (the
                  default above, or whatever's been edited) is ringed. */}
              {activeVar && topSlots(activeVar.key).length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
                  <span className="text-slate-400">Best times for {activeMeta?.label}:</span>
                  {topSlots(activeVar.key).map((s, i) => {
                    const tone =
                      s.score >= 9
                        ? "border-emerald-400 bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                        : s.score >= 7
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          : "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100";
                    const active = isSlotActive(activeVar, s.day, s.hour);
                    return (
                      <button
                        key={`${s.day}-${s.hour}-${i}`}
                        type="button"
                        onClick={() => applySlot(activeVar.key, s.day, s.hour)}
                        title={`Recommended slot for ${activeMeta?.label} (score ${s.score}/10, Eastern).`}
                        className={`rounded-full border px-2 py-0.5 font-medium ${tone} ${
                          active ? "ring-2 ring-brand ring-offset-1" : ""
                        }`}
                      >
                        {formatSlotLabel(s.day, s.hour)}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Manual media upload (drag-and-drop + file picker) per platform. */}
              {activeVar && (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-600">
                      Media
                      {activeMeta && FORMAT_MEDIA[formatOf(activeMeta.key)] !== "none" && (
                        <span className="ml-1 text-amber-600">
                          · {mediaShortfall(activeMeta) ?? `ready for ${FORMAT_LABEL[formatOf(activeMeta.key)]}`}
                        </span>
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

              {slidesOn && activeVar && activeMeta && formatOf(activeMeta.key) === "carousel" && (
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

              {/* Duplicate/angle acknowledgement — required before Approve when a
                  near-duplicate is detected on the calendar. */}
              {duplicateNets.length > 0 && (
                <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-800">
                  <input
                    type="checkbox"
                    checked={dupAck}
                    onChange={(e) => setDupAck(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-orange-600"
                  />
                  <span>
                    I reviewed the similar post(s) already on the calendar
                    {" "}({duplicateNets.map((n) => n.label).join(", ")}) and want to schedule anyway.
                  </span>
                </label>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-xs text-slate-400">{readyCount} network(s) ready</span>
                {blockedNets.length > 0 && (
                  <span className="text-xs font-medium text-amber-700">
                    ⚠️ {blockedNets.length} flagged post(s) — clear the flags to schedule.
                  </span>
                )}
                {duplicateNets.length > 0 && !dupAck && (
                  <span className="text-xs font-medium text-orange-700">
                    ≈ {duplicateNets.map((n) => n.label).join(", ")} look like a repeat — review or acknowledge.
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
                    onClick={() => void schedule(true)}
                    disabled={!canApprove || busy}
                    title={
                      canApprove
                        ? "Publish immediately instead of waiting for the scheduled time."
                        : "Clear the gate first — Publish now does not skip any check."
                    }
                    className="rounded-md border border-brand px-3 py-2 text-sm font-semibold text-brand hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Publish now
                  </button>
                  <button
                    onClick={() => void schedule(false)}
                    disabled={!canApprove}
                    title={
                      blockedNets.length > 0
                        ? "Clear the flagged posts first."
                        : mediaMissingNets.length > 0
                          ? `Attach media for ${mediaMissingNets.map((n) => n.label).join(", ")} first.`
                          : duplicateNets.length > 0 && !dupAck
                            ? "Review the similar posts or acknowledge to schedule anyway."
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
                Nothing publishes automatically. Posts stay a draft on the Content Calendar until their
                scheduled time — except “Publish now”, which asks first and then posts immediately.
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
      ) : network && network.formats.some((f) => FORMAT_MEDIA[f] !== "none") ? (
        <div className="mt-3 flex h-40 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">Image / carousel</div>
      ) : null}
      <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">Like · Comment · Share</div>
    </div>
  );
}
