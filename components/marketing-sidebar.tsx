"use client";

/**
 * Collapsible sidebar that mirrors the department structure defined in
 * `lib/departments.ts` (the same source of truth that drives the executive
 * board on the home page).
 *
 * Huraqan design system §5: a dark-navy (#0D1F3C) command-center rail, 200px
 * fixed, with a brand logo mark + org name at the top, colored section pills
 * grouping the nav, a brand-accented active state, and the signed-in user
 * pinned to the bottom.
 *
 * The whole-sidebar collapse (« / ») and the per-department expand/collapse are
 * kept (the design doc drops collapse, but we keep it as a deliberate,
 * approved deviation — it defaults open, so the command-center view is what
 * everyone sees unless they choose otherwise). Both preferences persist in
 * localStorage.
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
import { useSystemStatus, type IntegrationStatus } from "@/components/system-status";

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

/** Two-letter initials from an email local-part, for the user avatar. */
function initials(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0];
  return (local.slice(0, 2) || "?").toUpperCase();
}

// Curated core integrations shown as live status dots in the brand block. We
// only surface these (not every integration) and hide never-configured ones so
// the dots read as real, relevant signal rather than a setup checklist.
const CORE_STATUS_INTEGRATIONS: { id: string; short: string }[] = [
  { id: "wordpress", short: "WordPress" },
  { id: "semrush", short: "Semrush" },
  { id: "ayrshare", short: "Social" },
];

type StatusDot = { color: string; text: string };

function computeStatusDots(integrations: IntegrationStatus[]): StatusDot[] {
  const byId = new Map(integrations.map((i) => [i.id, i.status]));
  const dots: StatusDot[] = [];
  for (const core of CORE_STATUS_INTEGRATIONS) {
    const status = byId.get(core.id);
    if (!status || status === "missing_env") continue; // never configured → not a signal
    if (status === "connected") dots.push({ color: "#10B981", text: `${core.short} connected` });
    else if (status === "error") dots.push({ color: "#EF4444", text: `${core.short} error` });
    else dots.push({ color: "#F59E0B", text: `${core.short} needs setup` }); // needs_oauth / needs_setup
  }
  return dots;
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
  // Live system status (shared with the alert strip — fetched once in
  // LayoutShell). Drives the brand-block status dots + Production Board badge.
  const { integrations, reviewCount, loaded } = useSystemStatus();
  const statusDots = loaded ? computeStatusDots(integrations) : [];

  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/login";
  };

  const isAdmin = me?.role === "admin";

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const width = collapsed ? "60px" : "200px";

  const homeActive = isActive(pathname, HOME_NAV_ITEM.href);

  return (
    <aside
      className="shrink-0 sticky top-0 z-30 flex h-screen flex-col overflow-y-auto bg-[#0D1F3C] text-slate-200"
      style={{
        width,
        transition: hydrated ? "width 150ms ease" : undefined,
      }}
    >
      {/* Brand block — logo mark, product + org name, and the collapse toggle. */}
      <div className="border-b border-white/[0.07] px-3 py-3">
        <div className={collapsed ? "flex flex-col items-center gap-2" : "flex items-center gap-2"}>
          <Link href="/" title={firmName ?? APP_NAME} className="flex min-w-0 items-center gap-2">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={firmName ?? APP_NAME}
                className="h-[30px] w-[30px] shrink-0 rounded-[7px] object-contain"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] bg-brand text-[15px] font-extrabold text-white"
              >
                {APP_NAME.charAt(0)}
              </span>
            )}
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold text-white">{APP_NAME}</span>
                {firmName && (
                  <span className="block truncate text-[10px] text-[#60A5FA]">{firmName}</span>
                )}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`rounded px-1.5 py-0.5 text-lg leading-none text-white/50 hover:bg-white/10 hover:text-white ${
              collapsed ? "" : "ml-auto"
            }`}
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        {/* Live connection status for core integrations (real data). */}
        {!collapsed && statusDots.length > 0 && (
          <div className="mt-2.5 space-y-1">
            {statusDots.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: d.color }}
                />
                {d.text}
              </div>
            ))}
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-0 py-3">
        {/* Home dashboard — always visible above the department groups. */}
        <SidebarLink
          href={HOME_NAV_ITEM.href}
          label={HOME_NAV_ITEM.label}
          icon={HOME_NAV_ITEM.icon}
          collapsed={collapsed}
          active={homeActive}
        />

        {SIDEBAR_SECTIONS.map((dept) => {
          const open = collapsed || openGroups[dept.key];
          const visibleItems = dept.items.filter((it) => !it.adminOnly || isAdmin);
          if (visibleItems.length === 0) return null;
          return (
            <div key={dept.key} className="mt-1">
              {!collapsed ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(dept.key)}
                  className="mt-1 flex w-full items-center justify-between gap-2 px-3 py-1.5"
                >
                  {/* Section pill — colored grouping label (Huraqan §5). */}
                  <span
                    className="inline-flex min-w-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                    style={{ backgroundColor: dept.accent }}
                  >
                    <span className="truncate">{dept.label}</span>
                  </span>
                  <span aria-hidden className="shrink-0 text-[10px] text-white/40">
                    {openGroups[dept.key] ? "▾" : "▸"}
                  </span>
                </button>
              ) : (
                <div
                  aria-hidden
                  className="mx-auto my-1.5 h-1 w-1 rounded-full"
                  style={{ backgroundColor: dept.accent }}
                />
              )}
              {open && (
                <div className="flex flex-col gap-0.5">
                  {visibleItems.map((item) => (
                    <SidebarLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      collapsed={collapsed}
                      active={isActive(pathname, item.href)}
                      badge={item.href === "/content-production" ? reviewCount : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {me && (
        <div className="border-t border-white/[0.07] px-3 py-3">
          {!collapsed ? (
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#1B3A6B] text-[10px] font-bold text-[#60A5FA]"
              >
                {initials(me.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] font-semibold text-[#CBD5E1]">{me.email}</div>
                <div className="text-[10px] capitalize text-[#4B6A99]">{me.role}</div>
              </div>
              <button
                onClick={signOut}
                title={`Sign out (${me.email})`}
                aria-label="Sign out"
                className="shrink-0 rounded px-1.5 py-1 text-base text-white/40 hover:bg-white/10 hover:text-red-400"
              >
                ⏻
              </button>
            </div>
          ) : (
            <button
              onClick={signOut}
              className="flex w-full items-center justify-center text-base text-white/40 hover:text-red-400"
              title={`Sign out (${me.email})`}
              aria-label="Sign out"
            >
              ⏻
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

function SidebarLink({
  href,
  label,
  icon,
  collapsed,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon?: DeptItem["icon"];
  collapsed: boolean;
  active: boolean;
  /** Red count badge (e.g. items awaiting approval); hidden when 0/undefined. */
  badge?: number;
}) {
  const showBadge = typeof badge === "number" && badge > 0;
  return (
    <Link
      href={href}
      title={label}
      className={`relative mx-2 flex items-center gap-2 rounded-md py-1.5 text-[12px] transition-colors ${
        active
          ? "border-l-[3px] border-brand bg-[#1B3A6B] pl-[9px] pr-3 font-semibold text-white"
          : "px-3 text-[#94A3B8] hover:bg-[#112240] hover:text-[#CBD5E1]"
      } ${collapsed ? "justify-center" : ""}`}
    >
      {icon && (
        <span aria-hidden className="shrink-0 text-base leading-none">
          {icon}
        </span>
      )}
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && showBadge && (
        <span className="ml-auto shrink-0 rounded-full bg-[#EF4444] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
          {badge}
        </span>
      )}
      {collapsed && showBadge && (
        <span
          aria-hidden
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#EF4444]"
        />
      )}
    </Link>
  );
}
