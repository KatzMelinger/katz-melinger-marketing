/**
 * Department taxonomy — the single source of truth for how MarketOS is
 * organized into departments. Both the global sidebar
 * (`components/marketing-sidebar.tsx`) and the executive board on the home
 * page (`app/page.tsx` → `components/dept-board.tsx`) derive their structure
 * from this file so the grouping can never drift between the two.
 *
 * Mirrors the structure the firm signed off on in the dashboard mockup:
 * the three departments worked daily (SEO Content, On-Page SEO, Off-Page SEO)
 * default to open/expanded; the rest are visible but collapsed until needed.
 *
 * This module is intentionally free of server-only imports so it can be
 * pulled into both Server and Client Components.
 */

export type DeptItemStatus =
  /** Page exists and is wired up. */
  | "active"
  /** Planned surface that doesn't have a page yet — rendered dimmed + badged. */
  | "phase2";

export type DeptItem = {
  label: string;
  href: string;
  /** Single-glyph icon shown in the sidebar (keeps parity with prior nav). */
  icon?: string;
  status: DeptItemStatus;
  /** Hidden from non-admins (Integrations, Users, Settings). */
  adminOnly?: boolean;
};

export type Department = {
  /** Stable key used for localStorage state + board panel ids. */
  key: string;
  label: string;
  /** Hex accent matching the mockup's colored department headers. */
  accent: string;
  /** Open/expanded by default on first load (the daily-driver departments). */
  defaultOpen: boolean;
  items: DeptItem[];
};

export const DEPARTMENTS: Department[] = [
  {
    key: "seo-content",
    label: "SEO Content",
    accent: "#185FA5",
    defaultOpen: true,
    items: [
      { label: "Marketing copy", href: "/content", icon: "▤", status: "active" },
      { label: "Website Pages", href: "/content/km", icon: "✎", status: "active" },
      { label: "Batch Generator", href: "/content/batch", icon: "🧪", status: "active" },
      { label: "Opportunities", href: "/seo/opportunities", icon: "✨", status: "active" },
      { label: "Content Decisions", href: "/content/decisions", icon: "✓", status: "active" },
      { label: "Briefs", href: "/content/briefs", icon: "📋", status: "active" },
      { label: "Production Board", href: "/content/pipeline", icon: "▥", status: "active" },
      { label: "Publishing QA", href: "/content/publishing-qa", icon: "🔍", status: "active" },
      { label: "Refresh Queue", href: "/content/refresh", icon: "♻", status: "active" },
      { label: "Cluster Map", href: "/content/site-map", icon: "🗺", status: "active" },
      { label: "Intelligence", href: "/content/intelligence", icon: "💡", status: "active" },
      { label: "Drafts", href: "/content/drafts", icon: "📝", status: "active" },
      { label: "Sources", href: "/content/sources", icon: "📥", status: "active" },
    ],
  },
  {
    key: "on-page-seo",
    label: "On-Page SEO",
    accent: "#2563EB",
    defaultOpen: true,
    items: [
      { label: "Dashboard", href: "/seo", icon: "◎", status: "active" },
      { label: "Keyword Tracker", href: "/seo/keywords", icon: "⌕", status: "active" },
      { label: "Search Console", href: "/search-console", icon: "🔍", status: "active" },
      { label: "Internal Links", href: "/seo/internal-links", icon: "⇄", status: "active" },
      { label: "Cannibalization", href: "/seo/cannibalization", icon: "⚠", status: "active" },
      { label: "Schema Generator", href: "/seo/schema-generator", icon: "📐", status: "active" },
      { label: "Technical SEO", href: "/seo/technical", icon: "🛠", status: "active" },
      { label: "Topical Maps", href: "/seo/topical-maps", icon: "🗺", status: "active" },
      { label: "Keyword Research", href: "/keyword-research", icon: "🔎", status: "active" },
      { label: "Recent Activity", href: "/seo/recent", icon: "🕒", status: "active" },
    ],
  },
  {
    key: "off-page-seo",
    label: "Off-Page SEO",
    accent: "#15803D",
    defaultOpen: true,
    items: [
      { label: "Backlinks", href: "/seo/backlinks", icon: "🔗", status: "active" },
      { label: "Link Strategy", href: "/seo/link-strategy", icon: "🧩", status: "active" },
      { label: "Competitors", href: "/seo/competitors", icon: "⚔", status: "active" },
      { label: "Competitor Gaps", href: "/seo/competitor-gaps", icon: "▱", status: "active" },
      { label: "PR Pitches", href: "/seo/pr-pitches", icon: "📰", status: "active" },
      { label: "Legal Directories", href: "/seo/directories", icon: "⚖", status: "active" },
      { label: "Citations", href: "/seo/citations", icon: "📎", status: "active" },
    ],
  },
  {
    key: "ai-visibility",
    label: "AI Visibility",
    accent: "#EA580C",
    defaultOpen: false,
    items: [
      { label: "AEO", href: "/aeo", icon: "✦", status: "active" },
      { label: "AI Search", href: "/ai-search", icon: "🤖", status: "active" },
      { label: "AI Referrals", href: "/ai/referrals", icon: "↗", status: "active" },
      { label: "Bot Crawls", href: "/ai/bot-traffic", icon: "🕷", status: "active" },
      { label: "llms.txt", href: "/llms-txt", icon: "📜", status: "active" },
      { label: "Prompts", href: "/prompts", icon: "✨", status: "active" },
    ],
  },
  {
    key: "local-seo",
    label: "Local SEO",
    accent: "#DC2626",
    defaultOpen: false,
    items: [
      { label: "Local SEO / GBP", href: "/local-seo", icon: "⌖", status: "active" },
      { label: "Local Listings", href: "/local", icon: "📍", status: "active" },
    ],
  },
  {
    key: "campaigns",
    label: "Campaigns & Lead Gen",
    accent: "#D97706",
    defaultOpen: false,
    items: [
      { label: "Paid Ads", href: "/ads", icon: "💰", status: "active" },
      { label: "Email", href: "/email", icon: "✉", status: "active" },
      { label: "Constant Contact", href: "/constant-contact", icon: "📨", status: "active" },
      { label: "Forms", href: "/forms", icon: "▤", status: "active" },
      { label: "Calls", href: "/calls", icon: "☎", status: "active" },
      { label: "Agent Coaching", href: "/coaching", icon: "🎯", status: "active" },
      { label: "Sales Pipeline", href: "/pipeline", icon: "▥", status: "active" },
    ],
  },
  {
    key: "social",
    label: "Social Ops",
    accent: "#0D9488",
    defaultOpen: false,
    items: [
      { label: "Social Analytics", href: "/social/analytics", icon: "📊", status: "active" },
      { label: "Trends & Playbooks", href: "/social/trends", icon: "🔥", status: "active" },
      { label: "Community", href: "/community", icon: "💬", status: "active" },
      { label: "Reviews", href: "/reviews", icon: "★", status: "active" },
    ],
  },
  {
    key: "intelligence",
    label: "Intelligence & Insights",
    accent: "#4F46E5",
    defaultOpen: false,
    items: [
      { label: "Reporting", href: "/reporting", icon: "📑", status: "active" },
      { label: "Recommendations", href: "/recommendations", icon: "💡", status: "active" },
      { label: "Alerts", href: "/alerts", icon: "🔔", status: "active" },
      { label: "Website Analytics", href: "/analytics", icon: "▣", status: "active" },
      { label: "Attribution", href: "/attribution", icon: "⎔", status: "active" },
      { label: "Correlation", href: "/correlation", icon: "⇄", status: "active" },
      { label: "Clarity", href: "/clarity", icon: "🔥", status: "active" },
      { label: "Executive", href: "/executive", icon: "📈", status: "active" },
      { label: "Marketing Spend", href: "/settings/marketing-spend", icon: "💵", status: "active" },
    ],
  },
  {
    key: "workspace",
    label: "Workspace",
    accent: "#7C3AED",
    defaultOpen: false,
    items: [
      { label: "Agent Assistant", href: "/agent", icon: "💬", status: "active" },
      { label: "Content Directions", href: "/brand-voice", icon: "🧭", status: "active" },
      { label: "Image Generator", href: "/content/images", icon: "🖼", status: "active" },
      { label: "Practice Areas", href: "/settings/practice-areas", icon: "⚖", status: "active" },
      { label: "Sales Coach", href: "/settings/sales-training", icon: "🎯", status: "active" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    accent: "#475569",
    defaultOpen: false,
    items: [
      { label: "Connect WordPress", href: "/settings/wordpress", icon: "🌐", status: "active", adminOnly: true },
      { label: "Integrations", href: "/integrations", icon: "🔌", status: "active", adminOnly: true },
      { label: "Users", href: "/admin/users", icon: "👥", status: "active", adminOnly: true },
      { label: "Settings", href: "/settings", icon: "⚙", status: "active", adminOnly: true },
    ],
  },
];

/** Top-level link rendered above the department groups in the sidebar. */
export const HOME_NAV_ITEM: DeptItem = {
  label: "Dashboard",
  href: "/",
  icon: "⌂",
  status: "active",
};
