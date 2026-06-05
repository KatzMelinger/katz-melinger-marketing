/**
 * Link verification — the "Publishing QA" connection.
 *
 * Reads every link in a generated draft and checks each internal link against
 * the Cluster Map (site_pages) plus the known-live pillar/hub URLs. Internal
 * links that resolve to a live page are `confirmed`; internal links that don't
 * are `unverified` (likely invented by the model and should be removed before a
 * human publishes). External links are reported but not gated.
 *
 * Pairs with lib/internal-links.ts: the brief constrains the generator to
 * confirmed URLs up front; this is the check after the fact.
 */

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { ALL_KM_PILLARS, KM_HUB_LINKS } from "@/lib/km-content-system";

export type LinkType = "internal" | "external";
export type LinkStatus = "confirmed" | "unverified" | "external";

export type VerifiedLink = {
  href: string;
  anchor: string;
  type: LinkType;
  status: LinkStatus;
  /** The matched live page URL (for confirmed internal links). */
  matchedUrl?: string;
  /** The matched live page title, when known. */
  matchedTitle?: string | null;
};

export type LinkVerifyResult = {
  links: VerifiedLink[];
  counts: { total: number; confirmed: number; unverified: number; external: number };
};

const INTERNAL_HOST = "katzmelinger.com";

function normalizePath(path: string): string {
  let p = path.trim().toLowerCase();
  p = p.split("#")[0].split("?")[0]; // drop hash + query
  if (p.length > 1) p = p.replace(/\/+$/, ""); // drop trailing slash (keep root "/")
  return p;
}

/** Extract Markdown and HTML links from a draft body. */
export function extractLinks(body: string): { href: string; anchor: string }[] {
  const out: { href: string; anchor: string }[] = [];

  // Markdown: [anchor](url)  — url may carry an optional "title" we ignore.
  const md = /\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = md.exec(body)) !== null) {
    out.push({ anchor: m[1].trim(), href: m[2].trim() });
  }

  // HTML: <a href="url">anchor</a>  (also handles single quotes).
  // [\s\S] stands in for dotAll so anchors spanning newlines still match.
  const html = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = html.exec(body)) !== null) {
    out.push({ href: m[1].trim(), anchor: m[2].replace(/<[^>]+>/g, "").trim() });
  }

  return out;
}

/** True for links we don't verify (anchors, mail, tel, javascript). */
function isSkippable(href: string): boolean {
  return /^(#|mailto:|tel:|javascript:)/i.test(href);
}

export async function verifyLinks(body: string): Promise<LinkVerifyResult> {
  const raw = extractLinks(body).filter((l) => !isSkippable(l.href));

  // Build the set of known-live internal paths: site_pages ∪ pillars ∪ hubs.
  const liveByPath = new Map<string, { url: string; title: string | null }>();
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb.from("site_pages").select("url, title").limit(2000);
    for (const row of (data ?? []) as { url: string; title: string | null }[]) {
      try {
        const u = new URL(row.url, `https://www.${INTERNAL_HOST}`);
        liveByPath.set(normalizePath(u.pathname), { url: row.url, title: row.title });
      } catch {
        liveByPath.set(normalizePath(row.url), { url: row.url, title: row.title });
      }
    }
  } catch {
    /* no inventory — pillars/hubs below still verify the required up-links */
  }
  for (const p of ALL_KM_PILLARS) {
    liveByPath.set(normalizePath(p.url), { url: p.url, title: p.label });
  }
  for (const url of Object.values(KM_HUB_LINKS)) {
    if (!liveByPath.has(normalizePath(url))) {
      liveByPath.set(normalizePath(url), { url, title: null });
    }
  }

  const links: VerifiedLink[] = raw.map(({ href, anchor }) => {
    let isInternal = href.startsWith("/");
    let path = href;

    if (/^https?:\/\//i.test(href)) {
      try {
        const u = new URL(href);
        if (u.hostname.toLowerCase().includes(INTERNAL_HOST)) {
          isInternal = true;
          path = u.pathname;
        } else {
          return { href, anchor, type: "external", status: "external" };
        }
      } catch {
        return { href, anchor, type: "external", status: "external" };
      }
    } else if (!href.startsWith("/")) {
      // Protocol-relative or odd scheme — treat as external.
      return { href, anchor, type: "external", status: "external" };
    }

    if (isInternal) {
      const hit = liveByPath.get(normalizePath(path));
      if (hit) {
        return {
          href,
          anchor,
          type: "internal",
          status: "confirmed",
          matchedUrl: hit.url,
          matchedTitle: hit.title,
        };
      }
      return { href, anchor, type: "internal", status: "unverified" };
    }

    return { href, anchor, type: "external", status: "external" };
  });

  const counts = {
    total: links.length,
    confirmed: links.filter((l) => l.status === "confirmed").length,
    unverified: links.filter((l) => l.status === "unverified").length,
    external: links.filter((l) => l.status === "external").length,
  };

  return { links, counts };
}
