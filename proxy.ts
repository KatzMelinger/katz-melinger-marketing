/**
 * Auth proxy (formerly middleware).
 *
 * Runs on every request (pages AND /api/*). Refreshes the Supabase session
 * cookie if needed, then enforces authentication:
 *   - Pages: unauthenticated users are redirected to /login.
 *   - API routes: unauthenticated callers get a 401 JSON response (DEFAULT-DENY)
 *     unless the path is on the public API allowlist or the request carries a
 *     valid CRON_SECRET bearer token. This closes the gap where ~150 /api routes
 *     individually forgot to call guardUser(): the proxy is now the gate, and
 *     each route's own guard (where present) is defense-in-depth.
 *
 * Because the proxy now gates /api, Server Components must forward the user's
 * session cookie on internal /api fetches — use serverFetch() from
 * lib/request-origin.ts (and lib/dashboard-snapshots.ts already does).
 *
 * Admin-only routes are still guarded server-side at the page/route level so we
 * can return a proper "Forbidden" rather than a redirect.
 *
 * Skipped (public) paths:
 *   - Pages: /login, /signup, /reset-password, /auth/confirm, /r/*
 *   - API: /api/auth (signin/signout), /api/signup (self-serve firm signup),
 *     the per-provider OAuth prefixes (third-party redirects return
 *     unauthenticated; callbacks restrict themselves via state cookies / origin
 *     checks), /api/integrations/status (presence flags only), /api/ai-bots/ingest
 *     (UA/HMAC-checked beacon), and /api/wp (WP plugin authenticates via its own
 *     hashed X-KM-AutoPilot-Token).
 *   - Static assets (handled by the matcher below)
 */
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

// Page routes reachable without a session.
const PUBLIC_PAGE_PATHS = [
  "/login",
  "/signup", // self-serve firm signup — must be reachable without a session
  "/reset-password", // set-password form; gated on a session client-side
  "/auth/confirm", // recovery-link handler; visitor has no session yet
  "/r", // tracked review-request short links — recipients have no session
];

// API routes reachable without a user session — each self-authenticates by
// another mechanism (OAuth state, hashed plugin token, HMAC/UA beacon) or is
// presence-only. Everything else under /api requires a logged-in session.
const PUBLIC_API_PATHS = [
  "/api/auth", // signin / signout
  "/api/signup", // self-serve firm signup
  "/api/google/oauth", // third-party OAuth redirect/callback
  "/api/constant-contact/oauth",
  "/api/canva/oauth",
  "/api/integrations/status", // never exposes secret values, just presence flags
  "/api/ai-bots/ingest", // crawler beacon (UA/HMAC checked in-route)
  "/api/wp", // WP AutoPilot plugin — X-KM-AutoPilot-Token authenticated
];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** True when an Authorization: Bearer <CRON_SECRET> header is present and valid.
 *  Lets Vercel cron and other background callers (no session cookie) through;
 *  the target route re-verifies the secret itself. Fails closed if unset. */
function hasValidCronBearer(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Is this a deployed environment rather than someone's laptop?
 *
 * VERCEL is set in every Vercel environment — production, preview and their
 * local `vercel dev` — so a preview deploy with a broken env is treated as
 * seriously as production. NODE_ENV covers a production build hosted elsewhere.
 */
function isDeployed(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

export async function proxy(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    // FAIL CLOSED WHEN DEPLOYED.
    //
    // This branch used to return NextResponse.next() unconditionally, which
    // meant one missing environment variable turned the default-deny gate above
    // into an open door for ~150 API routes — silently. The app booted, pages
    // rendered, nothing errored, and every route was public. A typo in a Vercel
    // env var was the whole security model.
    //
    // An auth proxy that cannot reach its auth provider cannot tell a user from
    // a stranger. The only honest answer is to serve nothing and say why, which
    // is loud enough that somebody fixes the env instead of never noticing.
    //
    // Local development without Supabase configured still passes through, so
    // the app boots on a fresh clone.
    if (!isDeployed()) return NextResponse.next();

    const { pathname } = req.nextUrl;
    const detail =
      "Authentication is not configured: NEXT_PUBLIC_SUPABASE_URL or " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing from this deployment.";
    console.error(`[proxy] refusing all traffic — ${detail}`);

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Service unavailable", detail },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return new NextResponse(
      "Service unavailable.\n\n" + detail + "\n",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } },
    );
  }

  const res = NextResponse.next();

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value, options } of toSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });

  const { pathname } = req.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");

  // API allowlist + cron bearer bypass — checked BEFORE the session lookup so
  // background callers (no cookie) and OAuth callbacks aren't rejected.
  if (isApi) {
    if (matchesPrefix(pathname, PUBLIC_API_PATHS) || hasValidCronBearer(req)) {
      return res;
    }
  }

  // Refresh the session if there's one to refresh — silently writes the new
  // cookie via setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isApi) {
    // DEFAULT-DENY: any non-public /api route requires a logged-in session.
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return res;
  }

  if (matchesPrefix(pathname, PUBLIC_PAGE_PATHS)) {
    // If they're already logged in and visiting /login, bounce them home.
    if (user && pathname === "/login") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return res;
  }

  if (!user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Match every route (INCLUDING /api/*, which the proxy now gates with
     * default-deny) except static assets:
     * - _next/static, _next/image, favicon, images
     * Server Components must forward the session cookie on internal /api calls
     * (use serverFetch from lib/request-origin.ts) so their fetches aren't 401'd.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};