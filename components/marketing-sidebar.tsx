"use client";

/**
 * Collapsible sidebar that mirrors the department structure defined in
 * `lib/departments.ts` (the same source of truth that drives the executive
 * board on the home page).
 *
 * The three daily-driver departments (SEO Content, On-Page SEO, Off-Page SEO)
 * are expanded by default; the rest start collapsed. Each group carries the
 * department's accent color.
 *
 * State (sidebar collapsed + per-department open) is persisted in localStorage
 * so the user's preference survives navigation and reload. On first load the
 * per-department default comes from `department.defaultOpen`.
 *
 * Rendered once globally from app/layout.tsx — pages should not import or
 * render this directly.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SIDEBAR_SECTIONS, HOME_NAV_ITEM, type DeptItem } from "@/lib/departments";
import { usePersistentState, useHydrated } from "@/lib/use-persistent-state";
import { APP_NAME } from "@/lib/app-config";
import { useTenant } from "@/components/tenant-provider";

const STORAGE_COLLAPSED = "km_sidebar_collapsed";
const STORAGE_GROUPS = "km_sidebar_groups";

// Stable reference (computed once) so it can serve as the persistent-state
// fallback without re-triggering snapshots on every render.
const DEFAULT_GROUPS: Record<string, boolean> = Object.fromEntries(
  SIDEBAR_SECTIONS.map((d) => [d.key, d.defaultOpen]),
);

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MarketingSidebar() {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const [collapsed, setCollapsed] = usePersistentState<boolean>(
    STORAGE_COLLAPSED,
    false,
    (raw) => raw === "1",
    (value) => (value ? "1" : "0"),
  );
  const [openGroups, setOpenGroups] = usePersistentState<Record<string, boolean>>(
    STORAGE_GROUPS,
    DEFAULT_GROUPS,
    (raw) => ({ ...DEFAULT_GROUPS, ...(JSON.parse(raw) as Record<string, boolean>) }),
    (value) => JSON.stringify(value),
  );
  // User + firm name come from the shared tenant context (one fetch for the
  // whole app), not a sidebar-local fetch.
  const { user: me, firmName, logoUrl } = useTenant();

  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/login";
  };

  const isAdmin = me?.role === "admin";

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const width = collapsed ? "60px" : "232px";

  const homeActive = isActive(pathname, HOME_NAV_ITEM.href);

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
            title={firmName ?? APP_NAME}
            className="text-sm font-semibold tracking-tight text-brand truncate"
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={firmName ?? APP_NAME}
                className="h-6 max-w-[150px] object-contain"
              />
            ) : (
              (firmName ?? APP_NAME)
            )}
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
        {/* Home dashboard — always visible above the department groups. */}
        <Link
          href={HOME_NAV_ITEM.href}
          title={HOME_NAV_ITEM.label}
          className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
            homeActive
              ? "bg-brand/10 font-semibold text-brand"
              : "text-slate-700 hover:bg-slate-200/70 hover:text-slate-900"
          } ${collapsed ? "justify-center" : ""}`}
        >
          <span aria-hidden className="text-base leading-none shrink-0">
            {HOME_NAV_ITEM.icon}
          </span>
          {!collapsed && <span className="truncate">{HOME_NAV_ITEM.label}</span>}
        </Link>

        {SIDEBAR_SECTIONS.map((dept) => {
          const open = collapsed || openGroups[dept.key];
          const visibleItems = dept.items.filter((it) => !it.adminOnly || isAdmin);
          if (visibleItems.length === 0) return null;
          return (
            <div key={dept.key}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(dept.key)}
                  className="w-full flex items-center justify-between gap-2 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 hover:text-slate-900"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      aria-hidden
                      className="h-3 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: dept.accent }}
                    />
                    <span className="truncate">{dept.label}</span>
                  </span>
                  <span aria-hidden className="text-xs text-slate-400">
                    {openGroups[dept.key] ? "▾" : "▸"}
                  </span>
                </button>
              )}
              {collapsed && (
                <div
                  aria-hidden
                  className="mx-auto my-1 h-0.5 w-5 rounded-full"
                  style={{ backgroundColor: dept.accent }}
                />
              )}
              {open && (
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {visibleItems.map((item) => (
                    <SidebarItem
                      key={item.href}
                      item={item}
                      accent={dept.accent}
                      collapsed={collapsed}
                      active={isActive(pathname, item.href)}
                    />
                  ))}
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

function SidebarItem({
  item,
  accent,
  collapsed,
  active,
}: {
  item: DeptItem;
  accent: string;
  collapsed: boolean;
  active: boolean;
}) {
  return (
    <Link
      href={item.href}
      title={item.label}
      className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
        active
          ? "font-semibold text-slate-900"
          : "text-slate-700 hover:bg-slate-200/70 hover:text-slate-900"
      } ${collapsed ? "justify-center" : ""}`}
      style={active ? { backgroundColor: `${accent}1a` } : undefined}
    >
      <span aria-hidden className="text-base leading-none shrink-0">
        {item.icon}
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}
