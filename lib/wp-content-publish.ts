/**
 * KM AutoPilot — server-side helpers for publishing long-form CONTENT (full
 * posts) to WordPress via the pull plugin, alongside the existing on-page-fix
 * queue (lib/wp-autopilot.ts).
 *
 * Flow: a long-form draft the marketer clicks "Publish" on is marked
 * `metadata.wp_publish.queued = true` and left at status `approved`. The plugin
 * polls GET /api/wp/content?status=approved for its tenant, creates a WordPress
 * post from each, then POSTs /api/wp/content/applied with the new post id + URL,
 * which flips the draft (and its pipeline row) to `published`.
 *
 * Auth for both endpoints is the plugin's bearer token (lib/wp-autopilot
 * authenticateToken), so these run with the service-role admin client and MUST
 * scope every query by tenant_id explicitly (no RLS session here).
 */

import { marked } from "marked";

import { surfaceForFormat } from "@/lib/agent/compliance-filter";
import { getSupabaseAdmin } from "./supabase-server";
import { authorForContent } from "./authors";
import { openCriticalFindings } from "./content-findings-store";

export type WpContentItem = {
  /** content_drafts.id — echoed back on confirm. */
  id: string;
  title: string;
  slug: string;
  /** Rendered HTML ready for wp_insert_post post_content. */
  content_html: string;
  meta_title: string;
  meta_description: string;
  format: string;
  /** employment | collections — for the plugin's own routing if it wants it. */
  practice_area: string | null;
  /**
   * The attorney this post should be authored by. `login` is the WordPress user
   * login the plugin sets as post_author; null when no WP account is mapped yet
   * (the plugin then uses its default account). Resolved by practice area/pillar.
   */
  author: { login: string; name: string; slug: string } | null;
  /**
   * When set, this is an UPDATE of an already-published page at this URL (a
   * Redraft), not a new post. The plugin resolves it to the existing WP post
   * and updates that post in place (same URL/slug/status) instead of creating.
   */
  update_url: string | null;
  /** Public URL of an auto-generated featured image, when one was generated at
   *  queue time (new posts only — see app/api/content/drafts/[id]/publish). */
  featured_image_url: string | null;
  /*
   * Oct 20 spec, Task A12 (plugin 0.7+; older plugins ignore these fields).
   */
  /** create: save as a WordPress draft (or, for a live page, a pending version) and report a preview link.
   *  go_live: publish what was saved. rollback: restore the previous version. */
  action: "create" | "go_live" | "rollback";
  /** The WordPress post, once created (go_live and rollback). */
  wp_post_id: number | null;
  /** The SEO plugin's focus keyphrase. */
  focus_keyphrase: string | null;
  /** FAQPage JSON-LD for the page head (Yoast already emits Article). */
  schema_jsonld: string | null;
  /** The reviewing attorney, for "reviewedBy" on Yoast's Article (Task A2). */
  reviewed_by: { name: string; url: string | null } | null;
  /** WordPress category from the pillar's practice area, and tags from the secondary keywords. */
  category: string | null;
  tags: string[];
  /** Descriptive alt text and file name for the featured image. */
  featured_image_alt: string | null;
  featured_image_name: string | null;
  /** 301 redirects this page replaces (merged or older pages), for the plugin to create. */
  redirects: { from: string; to: string }[];
  /** "en" or "es" (Task A13), and the other-language version, for the hreflang tags. */
  language?: "en" | "es";
  hreflang_pair?: { language: "en" | "es"; wp_post_id: number | null; url: string | null } | null;
};

/** "0.7.0" >= "0.7.0". A plugin that sends no version is treated as 0.6. */
export function pluginAtLeast(version: string | null | undefined, want: string): boolean {
  const a = (version ?? "0.6.0").split(".").map((n) => Number(n) || 0);
  const b = want.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/** KM wizard long-form formats — pages/articles that publish to WordPress. */
const KM_WORDPRESS_FORMATS = new Set([
  "km_page_update", // Redraft of an existing page (update-in-place)
  "km_blog_post",
  "km_practice_page",
  "km_case_result",
]);

/**
 * A draft is WordPress-publishable when its surface is long-form ("blog") or it
 * is one of the KM long-form page/article formats (which `surfaceForFormat`
 * classifies as "other").
 */
export function isWordPressFormat(format: string | null | undefined): boolean {
  const f = (format ?? "blog").toLowerCase();
  return KM_WORDPRESS_FORMATS.has(f) || surfaceForFormat(f) === "blog";
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function pickMeta(
  metadata: Record<string, unknown> | null,
  seoBrief: Record<string, unknown> | null,
  ...keys: string[]
): string {
  for (const src of [metadata, seoBrief]) {
    if (!src) continue;
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

/**
 * The queue the plugin pulls: approved, long-form drafts the marketer has
 * queued for WordPress (metadata.wp_publish.queued === true).
 */
export async function listApprovedWpContent(args: {
  tenantId: string;
  limit?: number;
  /** The plugin's version (X-KM-AutoPilot-Version); 0.7+ also gets go_live and rollback. */
  pluginVersion?: string | null;
}): Promise<WpContentItem[]> {
  const sb = getSupabaseAdmin();
  const actions = pluginAtLeast(args.pluginVersion, "0.7.0");
  const { data, error } = await sb
    .from("content_drafts")
    .select("id, status, title, topic, body, format, metadata, seo_brief, practice_area")
    .eq("tenant_id", args.tenantId)
    .in("status", actions ? ["approved", "published"] : ["approved"])
    .order("updated_at", { ascending: false })
    .limit(args.limit ?? 50);
  if (error) throw new Error(error.message);

  // Oct 20 spec, Task A12: a "Publish live" or "Roll back" request goes to a
  // 0.7+ plugin as its own action; no gates re-run for those (the content
  // already passed them when it was queued, and a rollback must never wait).
  const wpOf = (d: { metadata: unknown }) => ((d.metadata as Record<string, unknown> | null)?.wp_publish ?? {}) as Record<string, unknown>;
  const actionItems: WpContentItem[] = [];
  if (actions) {
    for (const d of data ?? []) {
      const wp = wpOf(d);
      const postId = typeof wp.wp_post_id === "number" ? wp.wp_post_id : null;
      if (!postId) continue;
      const action = d.status === "approved" && wp.go_live_requested === true ? "go_live" : d.status === "published" && wp.rollback_requested === true ? "rollback" : null;
      if (!action) continue;
      actionItems.push({
        id: d.id as string,
        title: (d.title as string | null) ?? "Untitled",
        slug: "",
        content_html: "",
        meta_title: "",
        meta_description: "",
        format: ((d.format as string | null) ?? "blog").toLowerCase(),
        practice_area: (d.practice_area as string | null) ?? null,
        author: null,
        update_url: null,
        featured_image_url: null,
        action,
        wp_post_id: postId,
        focus_keyphrase: null,
        schema_jsonld: null,
        reviewed_by: null,
        category: null,
        tags: [],
        featured_image_alt: null,
        featured_image_name: null,
        redirects: [],
      });
    }
  }

  const queuedRows = (data ?? []).filter((d) => {
    const queued = d.status === "approved" && wpOf(d).queued === true;
    return queued && isWordPressFormat(d.format as string | null);
  });

  // Sept 28 spec 11.9: the queue refuses anything with an open Critical
  // finding AT THE MOMENT OF PUBLISHING, not just at approval — an approved
  // draft can still be edited or re-analysed afterwards. If the findings read
  // fails, nothing is served: an unverifiable draft does not go live.
  const critical = await openCriticalFindings(queuedRows.map((d) => d.id as string));
  if (critical === null) {
    console.warn("[wp-publish] could not read open findings; serving nothing new this pull.");
    return actionItems;
  }

  // Task A13: the other-language version of each paired draft, for hreflang.
  const pairIds = queuedRows
    .map((d) => ((d.metadata as Record<string, unknown> | null)?.language_pair as { draft_id?: string } | undefined)?.draft_id)
    .filter((x): x is string => typeof x === "string");
  const pairs = new Map<string, Record<string, unknown>>();
  if (pairIds.length) {
    const { data: pr } = await getSupabaseAdmin().from("content_drafts").select("id, metadata").eq("tenant_id", args.tenantId).in("id", pairIds);
    for (const p of pr ?? []) pairs.set(p.id as string, (p.metadata as Record<string, unknown> | null) ?? {});
  }

  const out: WpContentItem[] = [];
  for (const d of queuedRows) {
    const metadata = (d.metadata as Record<string, unknown> | null) ?? null;
    const held = critical.get(d.id as string);
    if (held && held.length > 0) {
      console.warn(
        `[wp-publish] ${d.id} is queued but has ${held.length} open critical finding(s); not served.`,
      );
      continue;
    }
    // Oct 20 spec, Task A2: a byline still pending attorney review never goes live.
    if (/^\s*[*_]*\s*(?:Pending attorney review|Pendiente de revisi[oó]n por abogado)\b/im.test((d.body as string | null) ?? "")) {
      console.warn(`[wp-publish] ${d.id} is queued but its byline is still pending attorney review; not served.`);
      continue;
    }

    const seoBrief = (d.seo_brief as Record<string, unknown> | null) ?? null;
    const title = (d.title as string | null) ?? (d.topic as string | null) ?? "Untitled";
    const slug = pickMeta(metadata, seoBrief, "urlSlug", "slug") || slugify(title);
    const content_html = marked.parse((d.body as string | null) ?? "", {
      async: false,
    }) as string;

    // A Redraft carries the source page URL — that's the page to update in place.
    const updateUrl =
      [metadata?.update_target_url, metadata?.source_url].find((u): u is string => typeof u === "string" && !!u.trim())?.trim() ?? null;

    // Resolve the authoring attorney by practice area + pillar (same rule the
    // byline uses), so the plugin can set post_author. Pillar lives on the brief.
    const km = (metadata?.km_brief as Record<string, unknown> | undefined) ?? undefined;
    const pillarId =
      pickMeta(metadata, seoBrief, "pillarId", "pillar_id") ||
      (typeof km?.pillarId === "string" ? km.pillarId : "");
    const author = authorForContent({ practiceArea: d.practice_area as string | null, pillarId });
    // No mapped login means the plugin quietly uses its default account and the
    // "Reviewed by" byline does not appear. That is a silent failure of an
    // E-E-A-T signal, so say it out loud — the same is true of a login that is
    // set but wrong, which WordPress resolves to nothing.
    if (!author.wpLogin) {
      console.warn(
        `[wp-publish] ${author.name} has no WordPress login mapped; this post will publish under the plugin's default account and carry no attorney byline.`,
      );
    }

    out.push({
      id: d.id as string,
      title,
      slug,
      content_html,
      meta_title: pickMeta(metadata, seoBrief, "metaTitle", "meta_title") || title,
      meta_description: pickMeta(metadata, seoBrief, "metaDescription", "meta_description"),
      format: ((d.format as string | null) ?? "blog").toLowerCase(),
      practice_area: (d.practice_area as string | null) ?? null,
      author: author.wpLogin
        ? { login: author.wpLogin, name: author.name, slug: author.id }
        : null,
      update_url: updateUrl,
      featured_image_url:
        typeof metadata?.featured_image_url === "string" ? metadata.featured_image_url : null,
      ...publishFields(metadata, seoBrief, title, pillarId, d.practice_area as string | null),
      ...hreflangFields(metadata, pairs),
    });
  }
  return [...actionItems, ...out];
}

/** The Task A12 fields for a create item. */
/** Language and the paired version's WordPress post (Oct 20 spec, Task A13). */
export function hreflangFields(metadata: Record<string, unknown> | null, pairs: Map<string, Record<string, unknown>>): Pick<WpContentItem, "language" | "hreflang_pair"> {
  const language = String(metadata?.language ?? "").toLowerCase().startsWith("es") ? "es" : "en";
  const pairId = (metadata?.language_pair as { draft_id?: string } | undefined)?.draft_id;
  const pm = pairId ? pairs.get(pairId) : undefined;
  if (!pm) return { language, hreflang_pair: null };
  const wp = (pm.wp_publish as Record<string, unknown> | undefined) ?? {};
  return {
    language,
    hreflang_pair: {
      language: language === "es" ? "en" : "es",
      wp_post_id: typeof wp.wp_post_id === "number" ? wp.wp_post_id : null,
      url: typeof wp.url === "string" ? wp.url : null,
    },
  };
}

function publishFields(
  metadata: Record<string, unknown> | null,
  seoBrief: Record<string, unknown> | null,
  title: string,
  pillarId: string,
  practiceArea: string | null,
): Pick<
  WpContentItem,
  "action" | "wp_post_id" | "focus_keyphrase" | "schema_jsonld" | "reviewed_by" | "category" | "tags" | "featured_image_alt" | "featured_image_name" | "redirects"
> {
  const m = metadata ?? {};
  const km = (m.km_brief as Record<string, unknown> | undefined) ?? {};
  const keyword =
    [m.primaryKeyword, m.primary_keyword, km.primaryKeyword, seoBrief?.primaryKeyword].find((k): k is string => typeof k === "string" && !!k.trim())?.trim() ?? null;
  const secondary = [m.secondary_keywords, km.secondaryKeywords, seoBrief?.targetKeywords]
    .find((v): v is unknown[] => Array.isArray(v))
    ?.filter((k): k is string => typeof k === "string" && !!k.trim() && k.trim().toLowerCase() !== keyword?.toLowerCase())
    .slice(0, 8) ?? [];
  const review = m.review as { attorney?: string; bio_url?: string | null } | undefined;
  const schema = m.schema_jsonld && typeof m.schema_jsonld === "object" ? JSON.stringify(m.schema_jsonld) : null;
  const area = (practiceArea ?? "").toLowerCase();
  const category = /judgment|enforcement|domestica/i.test(pillarId)
    ? "Judgment Enforcement"
    : area.includes("collect")
      ? "Commercial Collections"
      : area.includes("employ")
        ? "Employment Law"
        : null;
  const wp = (m.wp_publish as Record<string, unknown> | undefined) ?? {};
  const redirects = Array.isArray(m.redirects)
    ? (m.redirects as { from?: unknown; to?: unknown }[]).filter((r) => typeof r.from === "string" && typeof r.to === "string").map((r) => ({ from: r.from as string, to: r.to as string }))
    : [];
  return {
    action: "create",
    wp_post_id: typeof wp.wp_post_id === "number" ? wp.wp_post_id : null,
    focus_keyphrase: keyword,
    schema_jsonld: schema,
    reviewed_by: review?.attorney ? { name: `${review.attorney}, Esq.`, url: review.bio_url ?? null } : null,
    category,
    tags: secondary,
    // Descriptive alt text and file name from the H1 and keyword (Task A12).
    featured_image_alt: keyword ? `${title} (${keyword})` : title,
    featured_image_name: slugify(keyword || title),
    redirects,
  };
}

/**
 * What the plugin reports (Oct 20 spec, Task A12):
 *   wp_draft     saved as a WordPress draft / pending version; preview_url to read it
 *   published    live (also what a pre-0.7 plugin means by any confirmation)
 *   rolled_back  the previous version is back; the draft returns to review
 */
export async function confirmWpContent(args: {
  id: string;
  tenantId: string;
  wpPostId?: number | null;
  url?: string | null;
  state?: string | null;
  previewUrl?: string | null;
}): Promise<{ id: string; status: string; url: string | null; state: string }> {
  const state = args.state === "wp_draft" || args.state === "rolled_back" ? args.state : "published";
  if (state === "published") {
    const r = await markWpContentPublished(args);
    return { ...r, state };
  }
  const sb = getSupabaseAdmin();
  const { data: draft, error } = await sb
    .from("content_drafts")
    .select("id, status, metadata")
    .eq("tenant_id", args.tenantId)
    .eq("id", args.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error("draft not found");
  const meta = (draft.metadata as Record<string, unknown> | null) ?? {};
  const wp = (meta.wp_publish as Record<string, unknown> | undefined) ?? {};
  const now = new Date().toISOString();
  if (state === "wp_draft") {
    if (draft.status !== "approved") throw new Error(`cannot save a WordPress draft for status='${draft.status}' — must be 'approved'`);
    const next = {
      ...meta,
      wp_post_id: args.wpPostId ?? meta.wp_post_id ?? null,
      wp_publish: {
        ...wp,
        queued: false,
        state: "wp_draft",
        wp_post_id: args.wpPostId ?? wp.wp_post_id ?? null,
        preview_url: args.previewUrl ?? null,
        url: args.url ?? wp.url ?? null,
        drafted_at: now,
      },
    };
    const { error: e } = await sb.from("content_drafts").update({ metadata: next }).eq("tenant_id", args.tenantId).eq("id", args.id);
    if (e) throw new Error(e.message);
    return { id: args.id, status: "approved", url: args.url ?? null, state };
  }
  // rolled_back
  if (draft.status !== "published") throw new Error(`cannot roll back status='${draft.status}' — must be 'published'`);
  const next = {
    ...meta,
    wp_publish: { ...wp, state: "rolled_back", rollback_requested: false, rolled_back_at: now },
    publish_log: [...(Array.isArray(meta.publish_log) ? (meta.publish_log as unknown[]) : []), { action: "rollback", by: String(wp.rollback_by ?? "unknown"), at: now }].slice(-50),
  };
  const { error: e } = await sb.from("content_drafts").update({ status: "review", metadata: next }).eq("tenant_id", args.tenantId).eq("id", args.id);
  if (e) throw new Error(e.message);
  await sb.from("content_pipeline").update({ status: "review" }).eq("tenant_id", args.tenantId).eq("draft_id", args.id);
  return { id: args.id, status: "review", url: args.url ?? null, state };
}

/**
 * Confirm a WordPress post was created. Requires the draft to be `approved`
 * (refuse otherwise so a stale plugin can't flip arbitrary rows), then advances
 * the draft + its pipeline row to `published`, writes the public URL back, and
 * triggers the site-inventory ingest.
 */
export async function markWpContentPublished(args: {
  id: string;
  tenantId: string;
  wpPostId?: number | null;
  url?: string | null;
}): Promise<{ id: string; status: string; url: string | null }> {
  const sb = getSupabaseAdmin();

  const { data: draft, error: lookupErr } = await sb
    .from("content_drafts")
    .select("id, status, metadata")
    .eq("tenant_id", args.tenantId)
    .eq("id", args.id)
    .maybeSingle();
  if (lookupErr) throw new Error(lookupErr.message);
  if (!draft) throw new Error("draft not found");
  if (draft.status !== "approved") {
    throw new Error(
      `cannot publish draft in status='${draft.status}' — must be 'approved'`,
    );
  }

  const url = typeof args.url === "string" && args.url.trim() ? args.url.trim() : null;
  const prevMeta = (draft.metadata as Record<string, unknown> | null) ?? {};
  const prevWpPublish =
    (prevMeta.wp_publish as Record<string, unknown> | undefined) ?? {};
  const mergedMetadata = {
    ...prevMeta,
    ...(url ? { publishedUrl: url } : {}),
    wp_post_id: args.wpPostId ?? null,
    wp_publish: {
      ...prevWpPublish,
      queued: false,
      state: "published",
      go_live_requested: false,
      published_at: new Date().toISOString(),
      wp_post_id: args.wpPostId ?? prevWpPublish.wp_post_id ?? null,
      url: url ?? (prevWpPublish.url as string | null | undefined) ?? null,
    },
  };

  const { error: updErr } = await sb
    .from("content_drafts")
    .update({ status: "published", metadata: mergedMetadata })
    .eq("tenant_id", args.tenantId)
    .eq("id", args.id);
  if (updErr) throw new Error(updErr.message);

  await sb
    .from("content_pipeline")
    .update({ status: "published" })
    .eq("tenant_id", args.tenantId)
    .eq("draft_id", args.id);

  if (url && /^https?:\/\//i.test(url)) {
    try {
      const { ingestUrls } = await import("./site-inventory");
      void ingestUrls([url], args.tenantId).catch((err) =>
        console.warn("[wp-content] site-inventory ingest failed:", err),
      );
    } catch {
      /* non-fatal */
    }
  }

  return { id: args.id, status: "published", url };
}
