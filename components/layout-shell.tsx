"use client";

/**
 * Conditionally renders the dashboard sidebar around the page content.
 *
 * Pages that should display without the sidebar (login, future onboarding
 * flows) are listed in NO_CHROME_PATHS. Everything else gets the standard
 * sidebar + main column layout.
 */

import { usePathname } from "next/navigation";
import { MarketingSidebar } from "@/components/marketing-sidebar";
import { HubSubNav } from "@/components/hub-subnav";

const NO_CHROME_PATHS = ["/login", "/signup"];

function isChromeless(pathname: string | null): boolean {
  if (!pathname) return false;
  return NO_CHROME_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isChromeless(pathname)) return <>{children}</>;
  return (
    <div className="flex min-h-screen">
      <MarketingSidebar />
      <div className="flex-1 min-w-0">
        {/* Renders the Ops Hub sub-nav strip on any hub page (returns null
            elsewhere). Mounted once here so every hub page gets it
            consistently — pages must NOT render HubSubNav themselves. */}
        <HubSubNav />
        {children}
      </div>
    </div>
  );
}
