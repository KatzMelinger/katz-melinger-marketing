"use client";

/**
 * HubSubNav — horizontal nav strip that keeps users inside an Ops Hub
 * once they click into a sub-page. Drop it at the top of any hub
 * sub-page (right after MarketingNav) and it auto-detects which hub
 * the page belongs to from the URL, renders the right route list, and
 * highlights the active route.
 *
 * Renders nothing if the current pathname isn't part of any tracked
 * hub (so it's safe to mount globally if we ever want to).
 *
 * Hub assignments are authored once below and kept in sync with the
 * hub landing pages at /seo, /ai, /social.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

type Route = { href: string; label: string };

const SEO_ROUTES: Route[] = [
  { href: "/seo", label: "Overview" },
  { href: "/seo/keywords", label: "Keywords" },
  { href: "/seo/opportunities", label: "Opportunities" },
  { href: "/seo/competitors", label: "Competitors" },
  { href: "/seo/backlinks", label: "Backlinks" },
  { href: "/seo/internal-links", label: "Internal links" },
  { href: "/seo/link-strategy", label: "Link strategy" },
  { href: "/seo/technical", label: "Technical" },
  { href: "/seo/cannibalization", label: "Cannibalization" },
  { href: "/seo/suggestions", label: "Suggestions" },
  { href: "/seo/generator", label: "Content generator" },
  { href: "/seo/pr-pitches", label: "PR pitches" },
  { href: "/keyword-research", label: "Keyword research" },
  { href: "/search-console", label: "Search Console" },
  { href: "/local-seo", label: "Local SEO" },
  { href: "/seo/recent", label: "Recent" },
];

const AI_ROUTES: Route[] = [
  { href: "/ai", label: "Overview" },
  { href: "/aeo", label: "AEO" },
  { href: "/ai-search", label: "AI search" },
  { href: "/llms-txt", label: "llms.txt" },
  { href: "/prompts", label: "Prompts" },
  { href: "/ai/referrals", label: "AI referrals" },
  { href: "/ai/bot-traffic", label: "Bot crawls" },
  { href: "/clarity", label: "Clarity" },
  { href: "/correlation", label: "Correlation" },
];

const SOCIAL_ROUTES: Route[] = [
  { href: "/social", label: "Overview" },
  { href: "/social/analytics", label: "Analytics" },
  { href: "/community", label: "Community" },
  { href: "/reviews", label: "Reviews" },
  { href: "/local-seo", label: "Local SEO + GBP" },
  { href: "/content", label: "Content" },
  { href: "/brand-voice", label: "Brand voice" },
];

const HUB_ROUTES = {
  seo: SEO_ROUTES,
  ai: AI_ROUTES,
  social: SOCIAL_ROUTES,
} as const;

type HubKey = keyof typeof HUB_ROUTES;

const HUB_LABEL: Record<HubKey, string> = {
  seo: "SEO Ops Hub",
  ai: "AI Ops Hub",
  social: "Social Ops Hub",
};

const HUB_ACCENT: Record<HubKey, string> = {
  seo: "text-[#185FA5]",
  ai: "text-violet-700",
  social: "text-rose-700",
};

/**
 * Resolve which hub owns a given pathname. The mapping is by URL prefix
 * because some routes (e.g. /local-seo, /content) appear in more than
 * one hub's card grid. We pick the most specific match.
 *
 * Returns `null` for pages that aren't part of any hub.
 */
function resolveHub(pathname: string): HubKey | null {
  if (!pathname) return null;
  // Most-specific prefixes first so /ai-search doesn't match /ai etc.
  if (pathname === "/aeo" || pathname.startsWith("/aeo/")) return "ai";
  if (pathname === "/ai-search" || pathname.startsWith("/ai-search/")) return "ai";
  if (pathname === "/llms-txt" || pathname.startsWith("/llms-txt/")) return "ai";
  if (pathname === "/prompts" || pathname.startsWith("/prompts/")) return "ai";
  if (pathname === "/clarity" || pathname.startsWith("/clarity/")) return "ai";
  if (pathname === "/correlation" || pathname.startsWith("/correlation/")) return "ai";
  if (pathname === "/ai" || pathname.startsWith("/ai/")) return "ai";

  if (pathname === "/social" || pathname.startsWith("/social/")) return "social";
  if (pathname === "/community" || pathname.startsWith("/community/")) return "social";
  if (pathname === "/reviews" || pathname.startsWith("/reviews/")) return "social";

  if (pathname === "/seo" || pathname.startsWith("/seo/")) return "seo";
  if (pathname === "/keyword-research" || pathname.startsWith("/keyword-research/"))
    return "seo";
  if (pathname === "/search-console" || pathname.startsWith("/search-console/"))
    return "seo";
  // /local-seo is in both SEO and Social hubs — pick SEO since that's where
  // the bulk of the routing context is.
  if (pathname === "/local-seo" || pathname.startsWith("/local-seo/")) return "seo";

  return null;
}

function isActive(currentPath: string, href: string): boolean {
  if (href === currentPath) return true;
  // Hub overview pages should only highlight when on the exact path,
  // not when on a deeper child.
  if (
    href === "/seo" ||
    href === "/ai" ||
    href === "/social" ||
    href === "/content"
  ) {
    return currentPath === href;
  }
  return currentPath.startsWith(href + "/") || currentPath === href;
}

/**
 * Optional `hub` prop forces a specific hub's nav (useful if the page
 * itself lives in a shared location and we want it to read as part of
 * a specific hub). Omit to auto-detect from the URL.
 */
export function HubSubNav({ hub: explicitHub }: { hub?: HubKey } = {}) {
  const pathname = usePathname() ?? "";
  const hub = explicitHub ?? resolveHub(pathname);
  if (!hub) return null;

  const routes = HUB_ROUTES[hub];
  const accent = HUB_ACCENT[hub];
  const label = HUB_LABEL[hub];

  return (
    <nav
      className="border-b border-slate-200 bg-white"
      aria-label={`${label} sub-navigation`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 py-2 overflow-x-auto">
          <Link
            href={`/${hub}`}
            className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider ${accent} hover:underline`}
          >
            {label} ↩
          </Link>
          <div className="flex flex-wrap items-center gap-1">
            {routes.map((r) => {
              const active = isActive(pathname, r.href);
              return (
                <Link
                  key={r.href}
                  href={r.href}
                  className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? `bg-slate-100 ${accent}`
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {r.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
