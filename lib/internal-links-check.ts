/**
 * D3 — confirm internal links against the Cluster Map (spec 2.9).
 *
 * "Add and confirm at least the minimum internal links against the Cluster
 * Map, warn or block below three." lib/internal-link-audit.ts already exists,
 * but it crawls up to 100 LIVE pages over HTTP to find orphans/thin-pages
 * site-wide — it has no notion of "this one draft," and a draft being
 * reviewed isn't published yet, so there's no URL to crawl. This is the
 * actually-needed, much simpler check: parse the draft's OWN markdown links
 * and see how many resolve to a real page already in site_pages (the Cluster
 * Map built by lib/site-inventory.ts) — no network fetch required.
 *
 * A link to a URL not yet in the Cluster Map isn't necessarily wrong (the
 * target could be brand new, or an external citation), so this only counts
 * matches — it never flags an unmatched link as broken.
 */

import { getSupabaseAdmin } from "./supabase-server";

export const MIN_CONFIRMED_INTERNAL_LINKS = 3;

function normalizeUrlForMatch(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.host.replace(/^www\./, "").toLowerCase();
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    return `${host}${path}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Markdown links only `[text](url)` — an internal link has to be a real,
 *  clickable link in the body, not just a mention of a page's title. */
function extractLinkUrls(body: string): string[] {
  const re = /\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

export type InternalLinksCheck = {
  confirmedCount: number;
  totalLinks: number;
  findings: string[];
};

/**
 * Counts how many of this draft's own markdown links resolve to a page
 * already in the tenant's Cluster Map (site_pages). Degrades to "0 confirmed"
 * (never throws) so a Supabase hiccup reads as a real gap to fill, not a
 * crash — consistent with every other best-effort check in this pipeline.
 */
export async function checkInternalLinks(
  body: string,
  tenantId: string,
): Promise<InternalLinksCheck> {
  const urls = extractLinkUrls(body ?? "");
  if (urls.length === 0) {
    return {
      confirmedCount: 0,
      totalLinks: 0,
      findings: [
        `No internal links in the body. Add at least ${MIN_CONFIRMED_INTERNAL_LINKS} links to other pages on the site (see the Cluster Map).`,
      ],
    };
  }

  let known: Set<string>;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from("site_pages").select("url").eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    known = new Set((data ?? []).map((r) => normalizeUrlForMatch(r.url as string)));
  } catch (e) {
    console.warn("[internal-links-check] Cluster Map lookup failed:", e);
    known = new Set();
  }

  const normalizedLinks = urls.map(normalizeUrlForMatch);
  const confirmedCount = new Set(normalizedLinks.filter((u) => known.has(u))).size;

  const findings: string[] = [];
  if (confirmedCount < MIN_CONFIRMED_INTERNAL_LINKS) {
    findings.push(
      `Only ${confirmedCount} internal link${confirmedCount === 1 ? "" : "s"} confirmed against the Cluster Map ` +
        `(need ${MIN_CONFIRMED_INTERNAL_LINKS}+). ${urls.length} link${urls.length === 1 ? "" : "s"} found in the body` +
        (urls.length > confirmedCount
          ? `; ${urls.length - confirmedCount} didn't match a known page — confirm those URLs are correct or new.`
          : "."),
    );
  }

  return { confirmedCount, totalLinks: urls.length, findings };
}
