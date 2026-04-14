"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const MARKETING_NAV = [
  { label: "Dashboard", href: "/", icon: "⌂" },
  { label: "Calls", href: "/calls", icon: "☎" },
  { label: "Forms", href: "/forms", icon: "▤" },
  { label: "Analytics", href: "/analytics", icon: "▣" },
  { label: "Search Console", href: "/search-console", icon: "🔍" },
  { label: "SEO", href: "/seo", icon: "◎" },
  { label: "Content", href: "/content", icon: "✎" },
  { label: "Reviews", href: "/reviews", icon: "★" },
  { label: "Attribution", href: "/attribution", icon: "⎔" },
  { label: "Pipeline", href: "/pipeline", icon: "▥" },
  { label: "Settings", href: "/settings", icon: "⚙" },
] as const;

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MarketingNav() {
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-20 border-b border-[#2a3f5f]"
      style={{ backgroundColor: "#0f1729" }}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <Link
          href="/"
          className="shrink-0 text-lg font-semibold tracking-tight text-[#185FA5]"
        >
          KatzMelinger Marketing
        </Link>
        <nav className="flex flex-1 flex-wrap items-center justify-end gap-1 sm:gap-0.5 md:gap-1">
          {MARKETING_NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex items-center gap-1.5 rounded-md px-2 py-2 text-sm transition-colors md:px-3 ${
                  active
                    ? "bg-[#1a2540] font-semibold text-white ring-1 ring-[#185FA5]/40"
                    : "text-slate-300 hover:bg-[#1a2540] hover:text-white"
                }`}
              >
                <span className="text-base leading-none" aria-hidden>
                  {item.icon}
                </span>
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
