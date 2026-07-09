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
import { AlertStrip } from "@/components/alert-strip";
import { SystemStatusProvider } from "@/components/system-status";
import { TenantProvider } from "@/components/tenant-provider";

const NO_CHROME_PATHS = ["/login", "/signup", "/onboarding"];

function isChromeless(pathname: string | null): boolean {
  if (!pathname) return false;
  return NO_CHROME_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // TenantProvider wraps everything (one /api/auth/me fetch shared by the
  // sidebar and every tool page via useTenant). Chromeless pages still get it
  // so future onboarding screens can read tenant context too.
  if (isChromeless(pathname)) {
    return (
      <TenantProvider>{children}</TenantProvider>
    );
  }
  return (
    <TenantProvider>
      <SystemStatusProvider>
      <div className="flex min-h-screen">
        <MarketingSidebar />
        <div className="flex-1 min-w-0">
          {/* Alert strip (Huraqan §6) — real action items above all content;
              renders nothing when everything is healthy. */}
          <AlertStrip />
          {/* Renders the Ops Hub sub-nav strip on any hub page (returns null
              elsewhere). Mounted once here so every hub page gets it
              consistently — pages must NOT render HubSubNav themselves. */}
          <HubSubNav />
          {children}
        </div>
      </div>
      </SystemStatusProvider>
    </TenantProvider>
  );
}
