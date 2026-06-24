import { cookies, headers } from "next/headers";

export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  return fromEnv ?? "http://localhost:3000";
}

/**
 * Server-side fetch to an INTERNAL API route that forwards the caller's session
 * cookie. Server Components do server-to-server fetches that don't automatically
 * carry the browser's auth cookie; without it the proxy's API auth gate 401s and
 * resolveTenantId() can't see the logged-in user. Always use this (not bare
 * fetch) for internal `/api/*` calls from server components.
 *
 * Accepts either a path ("/api/foo") or an absolute same-origin URL. Defaults to
 * `cache: "no-store"`. Outside a request scope (cron/build) there's no cookie to
 * forward, so it falls back to an unauthenticated fetch.
 */
export async function serverFetch(
  pathOrUrl: string,
  init?: RequestInit,
): Promise<Response> {
  const url = /^https?:\/\//.test(pathOrUrl)
    ? pathOrUrl
    : `${await getRequestOrigin()}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  const mergedHeaders = new Headers(init?.headers);
  if (!mergedHeaders.has("cookie")) {
    try {
      const store = await cookies();
      const cookieHeader = store
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      if (cookieHeader) mergedHeaders.set("cookie", cookieHeader);
    } catch {
      // No request scope (cron/background/build) — nothing to forward.
    }
  }
  return fetch(url, { cache: "no-store", ...init, headers: mergedHeaders });
}

