/**
 * DataForSEO Backlinks API wrappers — backlink summary, referring domains, and
 * the backlinks list, consumed by lib/seo-intelligence.ts.
 *
 * NOTE ON SCHEMA VERIFICATION: these field mappings follow DataForSEO's
 * documented Backlinks API response shapes. They couldn't be verified against a
 * live response at authoring time (the build environment can't reach
 * api.dataforseo.com). Parsing is fully defensive — a wrong field name yields 0
 * / "" / null, never a crash. Run scripts/dfs-schema-probe.mjs from a
 * DataForSEO-reachable network to confirm the field names, then adjust here.
 *
 * DataForSEO "rank" is a 0-1000 score; we scale it to a 0-100 authority-style
 * number to match the shape the UI expects from the domain-authority score.
 */

import { cachedDataForSeoPost } from "./dataforseo-cache";

function host(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** DataForSEO domain/page rank is 0-1000 → scale to a 0-100 authority score. */
export function rankToScore(rank: unknown): number {
  return Math.round(Math.min(100, Math.max(0, num(rank) / 10)));
}

/** DataForSEO timestamps look like "2021-08-13 04:30:35 +00:00" — normalize. */
function toIso(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v.replace(" ", "T").replace(" ", ""));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function firstResult(json: any): any {
  return json?.tasks?.[0]?.result?.[0] ?? null;
}
function resultItems(json: any): any[] {
  const r = firstResult(json);
  return Array.isArray(r?.items) ? r.items : [];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type DfsBacklinkSummary = {
  rank: number;
  backlinks: number;
  referringDomains: number;
  referringDomainsNofollow: number;
  brokenBacklinks: number;
};

export async function getBacklinkSummary(target: string): Promise<DfsBacklinkSummary> {
  const json = await cachedDataForSeoPost("backlinks/summary/live", {
    target: host(target),
    internal_list_limit: 1,
    backlinks_status_type: "live",
    include_subdomains: true,
  });
  const r = firstResult(json) ?? {};
  return {
    rank: num(r.rank),
    backlinks: num(r.backlinks),
    referringDomains: num(r.referring_domains),
    referringDomainsNofollow: num(r.referring_domains_nofollow),
    brokenBacklinks: num(r.broken_backlinks),
  };
}

export type DfsReferringDomain = {
  domain: string;
  rank: number;
  backlinks: number;
  spamScore: number;
};

export async function getReferringDomains(
  target: string,
  limit = 30,
): Promise<DfsReferringDomain[]> {
  const json = await cachedDataForSeoPost("backlinks/referring_domains/live", {
    target: host(target),
    limit: Math.min(Math.max(limit, 1), 1000),
    order_by: ["backlinks,desc"],
    backlinks_status_type: "live",
  });
  return resultItems(json)
    .map((it) => ({
      domain: String(it?.domain ?? "").replace(/^www\./, "").toLowerCase(),
      rank: num(it?.rank),
      backlinks: num(it?.backlinks),
      spamScore: num(it?.backlinks_spam_score),
    }))
    .filter((d) => d.domain);
}

export type DfsBacklink = {
  urlFrom: string;
  title: string;
  domainFrom: string;
  pageRank: number;
  firstSeen: string | null;
  lastSeen: string | null;
  dofollow: boolean;
};

export async function getBacklinksList(
  target: string,
  opts: { limit?: number; order?: "first_seen,desc" | "last_seen,asc" } = {},
): Promise<DfsBacklink[]> {
  const json = await cachedDataForSeoPost("backlinks/backlinks/live", {
    target: host(target),
    limit: Math.min(Math.max(opts.limit ?? 50, 1), 1000),
    mode: "one_per_domain",
    order_by: [opts.order ?? "first_seen,desc"],
    backlinks_status_type: "live",
  });
  return resultItems(json)
    .map((it) => ({
      urlFrom: String(it?.url_from ?? ""),
      title: String(it?.page_from_title ?? it?.url_from_title ?? it?.title ?? ""),
      domainFrom: String(it?.domain_from ?? "").replace(/^www\./, "").toLowerCase(),
      pageRank: num(it?.rank),
      firstSeen: toIso(it?.first_seen),
      lastSeen: toIso(it?.last_seen),
      dofollow: it?.dofollow === true,
    }))
    .filter((b) => b.urlFrom);
}
