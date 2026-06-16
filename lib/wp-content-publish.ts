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
};

/** A draft is WordPress-publishable when its surface is long-form ("blog"). */
export function isWordPressFormat(format: string | null | undefined): boolean {
  return surfaceForFormat((format ?? "blog").toLowerCase()) === "blog";
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
}): Promise<WpContentItem[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_drafts")
    .select("id, title, topic, body, format, metadata, seo_brief")
    .eq("tenant_id", args.tenantId)
    .eq("status", "approved")
    .order("updated_at", { ascending: false })
    .limit(args.limit ?? 50);
  if (error) throw new Error(error.message);

  const out: WpContentItem[] = [];
  for (const d of data ?? []) {
    const metadata = (d.metadata as Record<string, unknown> | null) ?? null;
    const queued = Boolean(
      (metadata?.wp_publish as { queued?: unknown } | undefined)?.queued === true,
    );
    if (!queued || !isWordPressFormat(d.format as string | null)) continue;

    const seoBrief = (d.seo_brief as Record<string, unknown> | null) ?? null;
    const title = (d.title as string | null) ?? (d.topic as string | null) ?? "Untitled";
    const slug = pickMeta(metadata, seoBrief, "urlSlug", "slug") || slugify(title);
    const content_html = marked.parse((d.body as string | null) ?? "", {
      async: false,
    }) as string;

    out.push({
      id: d.id as string,
      title,
      slug,
      content_html,
      meta_title: pickMeta(metadata, seoBrief, "metaTitle", "meta_title") || title,
      meta_description: pickMeta(metadata, seoBrief, "metaDescription", "meta_description"),
      format: ((d.format as string | null) ?? "blog").toLowerCase(),
    });
  }
  return out;
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
      published_at: new Date().toISOString(),
      wp_post_id: args.wpPostId ?? null,
      url,
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
