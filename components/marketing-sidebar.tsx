"use client";

/**
 * Collapsible sidebar that replaces the old horizontal MarketingNav.
 *
 * Items are organized into four buckets — Acquisition, Search & AI,
 * Reach & Reputation, Workspace — to keep the nav scannable as we keep
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

type Role = "user" | "admin";
type NavItem = { label: string; href: string; icon: string; adminOnly?: boolean };
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
      { label: "Integrations", href: "/integrations", icon: "🔌", adminOnly: true },
      { label: "Users", href: "/admin/users", icon: "👥", adminOnly: true },
      { label: "Settings", href: "/settings", icon: "⚙", adminOnly: true },
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

type Me = { id: string; email: string; role: Role };

export function MarketingSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.label, true])),
  );
  const [hydrated, setHydrated] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

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
    // Load the current user so we can hide admin links and show the user menu.
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d?.user ?? null))
      .catch(() => setMe(null));
  }, []);

  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/login";
  };

  const isAdmin = me?.role === "admin";

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
      className="shrink-0 border-r border-slate-200 sticky top-0 h-screen overflow-y-auto z-30 bg-slate-50 flex flex-col"
      style={{
        width,
        transition: hydrated ? "width 150ms ease" : undefined,
      }}
    >
      <div className="flex items-center justify-between px-3 py-3 border-b border-slate-200">
        {!collapsed && (
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-[#185FA5] truncate"
          >
            KatzMelinger
          </Link>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="text-slate-500 hover:text-slate-900 text-lg leading-none px-1.5 py-0.5 rounded hover:bg-slate-200 ml-auto"
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="flex flex-col px-2 py-3 gap-2 flex-1">
        {GROUPS.map((group) => {
          const open = collapsed || openGroups[group.label];
          const visibleItems = group.items.filter((it) => !it.adminOnly || isAdmin);
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-2 py-2 text-sm font-semibold tracking-tight text-slate-900 hover:text-[#185FA5]"
                >
                  <span>{group.label}</span>
                  <span aria-hidden className="text-xs text-slate-500">
                    {openGroups[group.label] ? "▾" : "▸"}
                  </span>
                </button>
              )}
              {open && (
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {visibleItems.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={item.label}
                        className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
                          active
                            ? "bg-[#185FA5]/10 font-semibold text-[#185FA5]"
                            : "text-slate-700 hover:bg-slate-200/70 hover:text-slate-900"
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

      {me && (
        <div className="border-t border-slate-200 px-2 py-3">
          {!collapsed ? (
            <div className="px-2 space-y-2">
              <div className="text-xs">
                <div className="font-medium text-slate-900 truncate">{me.email}</div>
                <div className="text-[11px] text-slate-500 capitalize">{me.role}</div>
              </div>
              <button
                onClick={signOut}
                className="w-full text-xs px-2 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:border-red-400 hover:text-red-700"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={signOut}
              className="w-full text-base text-slate-500 hover:text-red-700 flex items-center justify-center"
              title={`Sign out (${me.email})`}
            >
              ⏻
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
