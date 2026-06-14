/**
 * Department taxonomy — the single source of truth for how Huraqan is
 * organized into nine departments. Both the global sidebar
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

export type DeptItem = {
  label: string;
  href: string;
  /** Single-glyph icon shown in the sidebar (keeps parity with prior nav). */
  icon?: string;
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
      { label: "Marketing copy", href: "/content", icon: "▤" },
      { label: "Opportunities", href: "/seo/opportunities", icon: "✨" },
      { label: "Research Queue", href: "/content/research", icon: "📚" },
      { label: "Content Decisions", href: "/content/decisions", icon: "✓" },
      { label: "Briefs", href: "/content/briefs", icon: "📋" },
      { label: "Production Board", href: "/content/pipeline", icon: "▥" },
      { label: "Publishing QA", href: "/content/publishing-qa", icon: "🔍" },
      { label: "Refresh Queue", href: "/content/refresh", icon: "♻" },
      { label: "Cluster Map", href: "/content/site-map", icon: "🗺" },
      { label: "Intelligence", href: "/content/intelligence", icon: "💡" },
      { label: "Batch Generator", href: "/content/batch", icon: "🧪" },
      { label: "Drafts", href: "/content/drafts", icon: "📝" },
      { label: "Sources", href: "/content/sources", icon: "📥" },
      { label: "Skills", href: "/content/skills", icon: "📚" },
    ],
  },
  {
    key: "on-page-seo",
    label: "On-Page SEO",
    accent: "#2563EB",
    defaultOpen: true,
    items: [
      { label: "Dashboard", href: "/seo", icon: "◎" },
      { label: "Keyword Tracker", href: "/seo/keywords", icon: "⌕" },
      { label: "Search Console", href: "/search-console", icon: "🔍" },
      { label: "Internal Links", href: "/seo/internal-links", icon: "⇄" },
      { label: "Cannibalization", href: "/seo/cannibalization", icon: "⚠" },
      { label: "Schema Generator", href: "/seo/schema-generator", icon: "📐" },
      { label: "Technical SEO", href: "/seo/technical", icon: "🛠" },
      { label: "Topical Maps", href: "/seo/topical-maps", icon: "🗺" },
      { label: "Keyword Research", href: "/keyword-research", icon: "🔎" },
      { label: "Recent Activity", href: "/seo/recent", icon: "🕒" },
    ],
  },
  {
    key: "off-page-seo",
    label: "Off-Page SEO",
    accent: "#15803D",
    defaultOpen: true,
    items: [
      { label: "Backlinks", href: "/seo/backlinks", icon: "🔗" },
      { label: "Link Strategy", href: "/seo/link-strategy", icon: "🧩" },
      { label: "Competitors", href: "/seo/competitors", icon: "⚔" },
      { label: "Competitor Gaps", href: "/seo/competitor-gaps", icon: "▱" },
      { label: "PR Pitches", href: "/seo/pr-pitches", icon: "📰" },
      { label: "Legal Directories", href: "/seo/directories", icon: "⚖" },
      { label: "Citations", href: "/seo/citations", icon: "📎" },
    ],
  },
  {
    key: "ai-visibility",
    label: "AI Visibility",
    accent: "#EA580C",
    defaultOpen: false,
    items: [
      { label: "AEO", href: "/aeo", icon: "✦" },
      { label: "AI Search", href: "/ai-search", icon: "🤖" },
      { label: "AI Referrals", href: "/ai/referrals", icon: "↗" },
      { label: "Bot Crawls", href: "/ai/bot-traffic", icon: "🕷" },
      { label: "llms.txt", href: "/llms-txt", icon: "📜" },
      { label: "Prompts", href: "/prompts", icon: "✨" },
    ],
  },
  {
    key: "local-seo",
    label: "Local SEO",
    accent: "#DC2626",
    defaultOpen: false,
    items: [
      { label: "Local SEO / GBP", href: "/local-seo", icon: "⌖" },
      { label: "Local Listings", href: "/local", icon: "📍" },
    ],
  },
  {
    key: "campaigns",
    label: "Campaigns & Lead Gen",
    accent: "#D97706",
    defaultOpen: false,
    items: [
      { label: "Paid Ads", href: "/ads", icon: "💰" },
      { label: "Email", href: "/email", icon: "✉" },
      { label: "Constant Contact", href: "/constant-contact", icon: "📨" },
      { label: "Forms", href: "/forms", icon: "▤" },
      { label: "Calls", href: "/calls", icon: "☎" },
      { label: "Lead Response", href: "/lead-response", icon: "⚡" },
      { label: "Agent Coaching", href: "/coaching", icon: "🎯" },
      { label: "Sales Pipeline", href: "/pipeline", icon: "▥" },
    ],
  },
  {
    key: "social",
    label: "Social Ops",
    accent: "#0D9488",
    defaultOpen: false,
    items: [
      { label: "Social Analytics", href: "/social/analytics", icon: "📊" },
      { label: "Trends & Playbooks", href: "/social/trends", icon: "🔥" },
      { label: "Community", href: "/community", icon: "💬" },
      { label: "Reviews", href: "/reviews", icon: "★" },
      { label: "Request Reviews", href: "/reviews?tab=requests", icon: "✉️" },
    ],
  },
  {
    key: "intelligence",
    label: "Intelligence & Insights",
    accent: "#4F46E5",
    defaultOpen: false,
    items: [
      { label: "Recommendations", href: "/recommendations", icon: "💡" },
      { label: "Alerts", href: "/alerts", icon: "🔔" },
      { label: "Website Analytics", href: "/analytics", icon: "▣" },
      { label: "Attribution", href: "/attribution", icon: "⎔" },
      { label: "Correlation", href: "/correlation", icon: "⇄" },
      { label: "Clarity", href: "/clarity", icon: "🔥" },
      { label: "Executive", href: "/executive", icon: "📈" },
      { label: "Marketing Spend", href: "/settings/marketing-spend", icon: "💵" },
    ],
  },
  {
    key: "workspace",
    label: "Workspace",
    accent: "#7C3AED",
    defaultOpen: false,
    items: [
      { label: "Agent Assistant", href: "/agent", icon: "💬" },
      { label: "Content Standards", href: "/brand-voice", icon: "🎙" },
      { label: "SEO content", href: "/content/km", icon: "✎" },
      { label: "Image Generator", href: "/content/images", icon: "🖼" },
      { label: "Practice Areas", href: "/settings/practice-areas", icon: "⚖" },
      { label: "Sales Coach", href: "/settings/sales-training", icon: "🎯" },
      { label: "Integrations", href: "/integrations", icon: "🔌", adminOnly: true },
      { label: "Users", href: "/admin/users", icon: "👥", adminOnly: true },
      { label: "Settings", href: "/settings", icon: "⚙", adminOnly: true },
    ],
  },
];

/** Top-level link rendered above the department groups in the sidebar. */
export const HOME_NAV_ITEM: DeptItem = {
  label: "Dashboard",
  href: "/",
  icon: "⌂",
};
