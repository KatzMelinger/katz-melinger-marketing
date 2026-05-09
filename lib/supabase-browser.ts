"use client";

/**
 * Browser-side Supabase client with cookie-based auth.
 *
 * Used by client components that need to call Supabase as the logged-in user
 * (e.g., reading the current session for the user menu). Tokens are stored
 * in cookies that the middleware reads on each request.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase browser client missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  cached = createBrowserClient(url, anon);
  return cached;
}
