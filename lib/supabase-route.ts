/**
 * Route-handler / server-component Supabase client.
 *
 * Wraps @supabase/ssr's createServerClient so we can read the auth cookie on
 * each request and (when needed) write a refreshed session cookie back. Used
 * by middleware, server components, and API routes that need to know who the
 * caller is.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getSupabaseRouteClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase route client missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll fails inside server components — middleware handles refresh.
        }
      },
    },
  });
}

export type AppRole = "user" | "admin";

export type SessionUser = {
  id: string;
  email: string;
  role: AppRole;
};

/**
 * Returns the current logged-in user with their app role, or null if no
 * session. Combines the Supabase Auth session with the app_users row.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const supabase = await getSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Read the role from app_users; bootstrap admin via env if no row exists yet.
  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  let role: AppRole = (appUser?.role as AppRole) ?? "user";

  // ADMIN_EMAILS env var lets us bootstrap the first admin without DB access.
  // Format: comma-separated list of emails.
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (user.email && adminEmails.includes(user.email.toLowerCase())) {
    role = "admin";
  }

  return {
    id: user.id,
    email: user.email ?? "",
    role,
  };
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (user.role !== "admin") throw new Error("Forbidden: admin only");
  return user;
}
