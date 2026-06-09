/**
 * Auth proxy (formerly middleware).
 *
 * Runs on every dashboard request. Refreshes the Supabase session cookie if
 * needed, and redirects unauthenticated users to /login. Admin-only routes
 * are guarded server-side at the page level (not here) so we can show a
 * proper "Forbidden" page rather than a redirect.
 *
 * Skipped paths:
 *   - /login (the login page itself)
 *   - /signup (self-serve firm signup — reachable without a session)
 *   - /api/auth/* (signin/signout routes)
 *   - /api/google/oauth/* and /api/constant-contact/oauth/* (third-party
 *     redirects come back unauthenticated; the OAuth callbacks restrict
 *     themselves via state cookies / origin checks)
 *   - Static assets (handled by the matcher below)
 */
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/signup", // self-serve firm signup — must be reachable without a session
  "/api/auth",
  "/api/google/oauth",
  "/api/constant-contact/oauth",
  "/api/integrations/status", // safe: never exposes secret values, just presence flags
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    // Auth not configured — let everything through so the app still boots.
    // The /integrations page will flag the missing env vars.
    return NextResponse.next();
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

  // Refresh the session if there's one to refresh — silently writes the new
  // cookie via setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isPublic(req.nextUrl.pathname)) {
    // If they're already logged in and visiting /login, bounce them home.
    if (user && req.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return res;
  }

  if (!user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Match every route except:
     * - api/* — pages do server-side internal fetches to /api routes that
     *   don't carry the user's session cookie; routing them through this
     *   middleware would 302 to /login, the page would parse HTML as JSON,
     *   and renders would silently fail. API routes handle their own
     *   access (service-role for data; admin routes call requireAdmin).
     * - _next/static, _next/image, favicon, images
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};