"use client";

/**
 * Collapsible sidebar that replaces the old horizontal MarketingNav.
 *
 * Items are organized into four buckets — Acquisition, Search & AI,
 * Reach & Reputation, Settings — to keep the nav scannable as we keep
 * adding features. Each section is independently collapsible; the whole
 * sidebar can collapse to icons-only via the chevron at the top.
 *
 * State (sidebar collapsed + per-section open) is persisted in
 * localStorage so the user's preference survives navigation and reload.
 *
 * Rendered once globally from app/layout.tsx — pages should not import or
 * render this directly.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = { label: string; href: string; icon: string };
type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "Acquisition",
    items: [
      { label: "Dashboard", href: "/", icon: "⌂" },
      { label: "Calls", href: "/calls", icon: "☎" },
      { label: "Forms", href: "/forms", icon: "▤" },
      { label: "Pipeline", href: "/pipeline", icon: "▥" },
      { label: "Attribution", href: "/attribution", icon: "⎔" },
      { label: "Analytics", href: "/analytics", icon: "▣" },
    ],
  },
  {
    label: "Search & AI",
    items: [
      { label: "Search Console", href: "/search-console", icon: "🔍" },
      { label: "SEO", href: "/seo", icon: "◎" },
      { label: "Keyword Research", href: "/keyword-research", icon: "⌕" },
      { label: "AI Search", href: "/ai-search", icon: "🤖" },
      { label: "AEO", href: "/aeo", icon: "✦" },
      { label: "Recommendations", href: "/recommendations", icon: "💡" },
      { label: "Alerts", href: "/alerts", icon: "🔔" },
      { label: "Correlation", href: "/correlation", icon: "⇄" },
      { label: "llms.txt", href: "/llms-txt", icon: "📜" },
    ],
  },
  {
    label: "Reach & Reputation",
    items: [
      { label: "Social", href: "/social", icon: "♺" },
      { label: "Email", href: "/email", icon: "✉" },
      { label: "Local SEO", href: "/local-seo", icon: "⌖" },
      { label: "Reviews", href: "/reviews", icon: "★" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Brand Voice", href: "/brand-voice", icon: "🎙" },
      { label: "Content", href: "/content", icon: "✎" },
      { label: "Sales coach", href: "/settings/sales-training", icon: "🎯" },
      { label: "Settings", href: "/settings", icon: "⚙" },
    ],
  },
];

const STORAGE_COLLAPSED = "km_sidebar_collapsed";
const STORAGE_GROUPS = "km_sidebar_groups";

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MarketingSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.label, true])),
  );
  // Wait for client mount before applying persisted state — avoids hydration
  // mismatch when the server renders the default and the client renders the
  // user's saved preference.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      setCollapsed(localStorage.getItem(STORAGE_COLLAPSED) === "1");
      const raw = localStorage.getItem(STORAGE_GROUPS);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        setOpenGroups((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_COLLAPSED, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const toggleGroup = (label: string) => {
    const next = { ...openGroups, [label]: !openGroups[label] };
    setOpenGroups(next);
    try {
      localStorage.setItem(STORAGE_GROUPS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const width = collapsed ? "60px" : "232px";

  return (
    <aside
      className="shrink-0 border-r border-[#2a3f5f] sticky top-0 h-screen overflow-y-auto z-30"
      style={{
        backgroundColor: "#0f1729",
        width,
        transition: hydrated ? "width 150ms ease" : undefined,
      }}
    >
      <div className="flex items-center justify-between px-3 py-3 border-b border-[#2a3f5f]/60">
        {!collapsed && (
          <Link href="/" className="text-sm font-semibold tracking-tight text-[#185FA5] truncate">
            KatzMelinger
          </Link>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="text-slate-400 hover:text-white text-lg leading-none px-1.5 py-0.5 rounded hover:bg-[#1a2540] ml-auto"
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="flex flex-col px-2 py-3 gap-2">
        {GROUPS.map((group) => {
          const open = collapsed || openGroups[group.label];
          return (
            <div key={group.label}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300"
                >
                  <span>{group.label}</span>
                  <span aria-hidden>{openGroups[group.label] ? "▾" : "▸"}</span>
                </button>
              )}
              {open && (
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={item.label}
                        className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                          active
                            ? "bg-[#1a2540] font-semibold text-white ring-1 ring-[#185FA5]/40"
                            : "text-slate-300 hover:bg-[#1a2540] hover:text-white"
                        } ${collapsed ? "justify-center" : ""}`}
                      >
                        <span aria-hidden className="text-base leading-none shrink-0">
                          {item.icon}
                        </span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
