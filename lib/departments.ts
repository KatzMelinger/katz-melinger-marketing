/**
 * Department taxonomy — the single source of truth for how Huraqan is
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
    // Sits first, directly under Dashboard: Peggy (the AI assistant) plus the
    // Production Board, where everything Peggy or the autonomous agent creates
    // lands for review/approval. Kept open by default so the inbox is one click
    // from anywhere.
    key: "ai-assistant",
    label: "AI Assistant",
    accent: "#8B5CF6",
    defaultOpen: true,
    items: [
      { label: "Peggy", href: "/agent", icon: "💬", status: "active" },
    ],
  },
  {
    key: "seo-content",
    label: "SEO Content",
    accent: "#116AB2",
    defaultOpen: true,
    items: [
      // Content Studio is one surface with a shared tab bar (ContentNav):
      // Marketing copy, SEO content, Multi-format batch, Intelligence, and the
      // Opportunity Radar — so it needs one sidebar entry, not five.
      { label: "Content Studio", href: "/content", icon: "▤", status: "active" },
      // The production line (Decisions, Briefs, Production Board, Publishing QA)
      // is reached from the Content Production page itself, so it needs only one
      // sidebar tab instead of five.
      { label: "Production Board", href: "/content-production", icon: "🗂", status: "active" },
      { label: "Refresh Queue", href: "/content/refresh", icon: "♻", status: "active" },
      { label: "Cluster Map", href: "/content/site-map", icon: "🗺", status: "active" },
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
      { label: "Directories & Citations", href: "/seo/citations", icon: "📎", status: "active" },
    ],
  },
  {
    key: "ai-visibility",
    label: "AI Visibility",
    accent: "#EA580C",
    defaultOpen: false,
    items: [
      // AEO (citation tracking) + AI Search (readiness score) share a tab bar
      // (AiVisibilityNav) under one entry.
      { label: "AEO (Answer Engine Optimization)", href: "/aeo", icon: "✦", status: "active" },
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
      { label: "Forms", href: "/forms", icon: "▤", status: "active" },
      { label: "Calls", href: "/calls", icon: "☎", status: "active" },
      { label: "Lead Response", href: "/lead-response", icon: "⚡", status: "active" },
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
      { label: "Content Calendar", href: "/social/content-calendar", icon: "🗓️", status: "active" },
      { label: "KPI Tracker", href: "/social/kpi-tracker", icon: "📈", status: "active" },
      { label: "Trends & Performance", href: "/social/trends-performance", icon: "📊", status: "active" },
      { label: "Hashtag Performance", href: "/social/hashtag-performance", icon: "#️⃣", status: "active" },
      { label: "Best Time to Post", href: "/social/best-time", icon: "⏰", status: "active" },
      { label: "Competitor Tracking", href: "/social/competitor-tracking", icon: "🥊", status: "active" },
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
      // Reporting (board-ready weekly/monthly export) is now a tab on /executive.
      { label: "Executive & Reporting", href: "/executive", icon: "📈", status: "active" },
      { label: "Recommendations", href: "/recommendations", icon: "💡", status: "active" },
      { label: "Alerts", href: "/alerts", icon: "🔔", status: "active" },
      { label: "Website Analytics", href: "/analytics", icon: "▣", status: "active" },
      { label: "Attribution", href: "/attribution", icon: "⎔", status: "active" },
      { label: "Correlation", href: "/correlation", icon: "⇄", status: "active" },
      { label: "Clarity", href: "/clarity", icon: "🔥", status: "active" },
      { label: "Marketing Spend", href: "/settings/marketing-spend", icon: "💵", status: "active" },
    ],
  },
  {
    key: "workspace",
    label: "Workspace",
    accent: "#7C3AED",
    defaultOpen: false,
    items: [
      { label: "Content Directions", href: "/brand-voice", icon: "🧭", status: "active" },
      { label: "Image Generator", href: "/content/images", icon: "🖼", status: "active" },
      { label: "Practice Areas", href: "/settings/practice-areas", icon: "⚖", status: "active" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    accent: "#475569",
    defaultOpen: false,
    items: [
      { label: "Integrations", href: "/integrations", icon: "🔌", status: "active", adminOnly: true },
      { label: "Users", href: "/admin/users", icon: "👥", status: "active", adminOnly: true },
      { label: "Settings", href: "/settings", icon: "⚙", status: "active", adminOnly: true },
    ],
  },
];

/**
 * SIDEBAR navigation — the Huraqan "Section 1" organization: every item filed
 * under its matching top-nav tab (Overview · Research · Optimize · Build ·
 * Social Media · Email · Track · Workspace · Admin).
 *
 * This is intentionally separate from DEPARTMENTS above: DEPARTMENTS is the
 * curated taxonomy the home executive board (`app/page.tsx`) is keyed to, while
 * the sidebar follows the firm-signed-off navigation structure. The two group
 * the same underlying routes differently on purpose. The sidebar component
 * (`components/marketing-sidebar.tsx`) renders THIS array.
 */
export const SIDEBAR_SECTIONS: Department[] = [
  {
    // First screen checked every session: Peggy + the Production Board inbox,
    // plus the recommendation/activity feeds.
    key: "overview",
    label: "Overview",
    accent: "#8B5CF6",
    defaultOpen: true,
    items: [
      { label: "Opportunities", href: "/seo/opportunities", icon: "✨", status: "active" },
      { label: "Recommendations", href: "/recommendations", icon: "💡", status: "active" },
      { label: "Peggy", href: "/agent", icon: "💬", status: "active" },
      { label: "Production Board", href: "/content-production", icon: "🗂", status: "active" },
      { label: "Recent Activity", href: "/seo/recent", icon: "🕒", status: "active" },
    ],
  },
  {
    key: "research",
    label: "Research",
    accent: "#116AB2",
    defaultOpen: true,
    items: [
      { label: "SEO Dashboard", href: "/seo", icon: "◎", status: "active" },
      // Site Inventory = the former "Cluster Map" (sitemap-crawled page index).
      { label: "Site Inventory", href: "/content/site-map", icon: "🗺", status: "active" },
      { label: "Keyword Tracker", href: "/seo/keywords", icon: "⌕", status: "active" },
      { label: "Keyword Research", href: "/keyword-research", icon: "🔎", status: "active" },
      { label: "Topical Maps", href: "/seo/topical-maps", icon: "🗺", status: "active" },
      { label: "Competitors", href: "/seo/competitors", icon: "⚔", status: "active" },
      { label: "Competitor Gaps", href: "/seo/competitor-gaps", icon: "▱", status: "active" },
      { label: "Search Console", href: "/search-console", icon: "🔍", status: "active" },
      { label: "AEO (Answer Engine Optimization)", href: "/aeo", icon: "✦", status: "active" },
      { label: "AI Referrals", href: "/ai/referrals", icon: "↗", status: "active" },
      { label: "Bot Crawls", href: "/ai/bot-traffic", icon: "🕷", status: "active" },
      { label: "llms.txt", href: "/llms-txt", icon: "📜", status: "active" },
      { label: "Prompts", href: "/prompts", icon: "✨", status: "active" },
    ],
  },
  {
    key: "optimize",
    label: "Optimize",
    accent: "#2563EB",
    defaultOpen: true,
    items: [
      { label: "Technical SEO", href: "/seo/technical", icon: "🛠", status: "active" },
      { label: "Cannibalization", href: "/seo/cannibalization", icon: "⚠", status: "active" },
      { label: "Schema Generator", href: "/seo/schema-generator", icon: "📐", status: "active" },
      { label: "Internal Links", href: "/seo/internal-links", icon: "⇄", status: "active" },
      { label: "Local SEO / GBP", href: "/local-seo", icon: "⌖", status: "active" },
      { label: "Directories & Citations", href: "/seo/citations", icon: "📎", status: "active" },
      { label: "Refresh Queue", href: "/content/refresh", icon: "♻", status: "active" },
    ],
  },
  {
    key: "build",
    label: "Build",
    accent: "#15803D",
    defaultOpen: true,
    items: [
      { label: "Content Studio", href: "/content", icon: "▤", status: "active" },
      { label: "Content Approvals", href: "/content/drafts", icon: "📝", status: "active" },
      { label: "PR Pitches", href: "/seo/pr-pitches", icon: "📰", status: "active" },
      { label: "Paid Ads", href: "/ads", icon: "💰", status: "active" },
      { label: "Forms", href: "/forms", icon: "▤", status: "active" },
    ],
  },
  {
    key: "social",
    label: "Social Media",
    accent: "#0D9488",
    defaultOpen: false,
    items: [
      { label: "Content Calendar", href: "/social/content-calendar", icon: "🗓️", status: "active" },
      { label: "KPI Tracker", href: "/social/kpi-tracker", icon: "📈", status: "active" },
      { label: "Trends & Performance", href: "/social/trends-performance", icon: "📊", status: "active" },
      { label: "Best Time to Post", href: "/social/best-time", icon: "⏰", status: "active" },
      { label: "Hashtag Performance", href: "/social/hashtag-performance", icon: "#️⃣", status: "active" },
      { label: "Competitor Tracking", href: "/social/competitor-tracking", icon: "🥊", status: "active" },
      { label: "Trends & Playbooks", href: "/social/trends", icon: "🔥", status: "active" },
      { label: "Community", href: "/community", icon: "💬", status: "active" },
      { label: "Reviews", href: "/reviews", icon: "★", status: "active" },
    ],
  },
  {
    // Own top-level section so it can grow independently. Features to come.
    key: "email",
    label: "Email",
    accent: "#0EA5E9",
    defaultOpen: false,
    items: [
      { label: "Email", href: "/email", icon: "✉", status: "active" },
    ],
  },
  {
    key: "track",
    label: "Track",
    accent: "#4F46E5",
    defaultOpen: false,
    items: [
      { label: "Backlinks", href: "/seo/backlinks", icon: "🔗", status: "active" },
      { label: "Link Strategy", href: "/seo/link-strategy", icon: "🧩", status: "active" },
      { label: "Social Analytics", href: "/social/analytics", icon: "📊", status: "active" },
      { label: "Monthly Social Report", href: "/social/report", icon: "🧾", status: "active" },
      { label: "Calls", href: "/calls", icon: "☎", status: "active" },
      { label: "Lead Response", href: "/lead-response", icon: "⚡", status: "active" },
      { label: "Sales Pipeline", href: "/pipeline", icon: "▥", status: "active" },
      { label: "Executive Reporting", href: "/executive", icon: "📈", status: "active" },
      { label: "Website Analytics", href: "/analytics", icon: "▣", status: "active" },
      { label: "Attribution", href: "/attribution", icon: "⎔", status: "active" },
      { label: "Correlation", href: "/correlation", icon: "⇄", status: "active" },
      { label: "Marketing Spend", href: "/settings/marketing-spend", icon: "💵", status: "active" },
    ],
  },
  {
    key: "workspace",
    label: "Workspace",
    accent: "#7C3AED",
    defaultOpen: false,
    items: [
      { label: "Content Directions", href: "/brand-voice", icon: "🧭", status: "active" },
      { label: "Image Generator", href: "/content/images", icon: "🖼", status: "active" },
      { label: "Practice Areas", href: "/settings/practice-areas", icon: "⚖", status: "active" },
      { label: "Agent Coaching", href: "/coaching", icon: "🎯", status: "active" },
      { label: "Alerts", href: "/alerts", icon: "🔔", status: "active" },
      { label: "Clarity", href: "/clarity", icon: "🔥", status: "active" },
      // In-app help: what every section does + a glossary. Generated from this
      // same SIDEBAR_SECTIONS list, so it can't drift from the nav.
      { label: "Guide", href: "/guide", icon: "📖", status: "active" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    accent: "#475569",
    defaultOpen: false,
    items: [
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
