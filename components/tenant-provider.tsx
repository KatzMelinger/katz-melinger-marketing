"use client";

/**
 * Client-side per-tenant context. Fetches /api/auth/me ONCE and exposes the
 * current user plus the tenant's white-label identity (firm name + primary
 * domain) to any client component via useTenant().
 *
 * This is the single source of truth on the client for "who is this firm?" —
 * the sidebar wordmark, tool-page URL prefills, and helper copy all read from
 * here instead of hardcoding a firm name or domain. The onboarding flow reuses
 * the same hook.
 *
 * Mounted once in components/layout-shell.tsx so it wraps every page.
 */

import { createContext, useContext, useEffect, useState } from "react";

export type TenantUser = { id: string; email: string; role: "user" | "admin" };

export type TenantInfo = {
  user: TenantUser | null;
  firmName: string | null;
  /** Bare host, e.g. "example.com" (from tenant_settings.seo_domain). */
  domain: string | null;
  /** Per-tenant brand color (hex), or null = use the default theme. */
  brandColor: string | null;
  /** Optional logo URL for the sidebar wordmark. */
  logoUrl: string | null;
  loading: boolean;
};

const TenantContext = createContext<TenantInfo>({
  user: null,
  firmName: null,
  domain: null,
  brandColor: null,
  logoUrl: null,
  loading: true,
});

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<TenantInfo>({
    user: null,
    firmName: null,
    domain: null,
    brandColor: null,
    logoUrl: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setInfo({
          user: d?.user ?? null,
          firmName: d?.firmName ?? null,
          domain: d?.domain ?? null,
          brandColor: d?.brandColor ?? null,
          logoUrl: d?.logoUrl ?? null,
          loading: false,
        });
        // Apply the per-tenant brand color to the whole app (white-label theme).
        if (d?.brandColor && typeof document !== "undefined") {
          document.documentElement.style.setProperty("--brand", d.brandColor);
        }
      })
      .catch(() => {
        if (!cancelled)
          setInfo({
            user: null,
            firmName: null,
            domain: null,
            brandColor: null,
            logoUrl: null,
            loading: false,
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <TenantContext.Provider value={info}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantInfo {
  return useContext(TenantContext);
}

/**
 * Convenience: the tenant's primary site as a full https URL (no trailing
 * slash), or "" while unknown. Handy for prefilling URL inputs on tool pages.
 */
export function useTenantSiteUrl(): string {
  const { domain } = useTenant();
  if (!domain) return "";
  return /^https?:\/\//.test(domain) ? domain.replace(/\/$/, "") : `https://${domain}`;
}
