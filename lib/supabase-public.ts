import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Read-only Supabase client using the public anon key (for server components
 * that must follow NEXT_PUBLIC_* env vars, e.g. reviews).
 */
export function getSupabaseAnon(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key);
}
