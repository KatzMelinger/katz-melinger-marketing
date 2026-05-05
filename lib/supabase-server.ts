import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** Service-role client; null when URL/key are missing (e.g. CI build). */
export function getSupabaseServer(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  if (!cached) {
    cached = createClient(url, key);
  }
  return cached;
}
/**
 * Same as getSupabaseServer, but throws instead of returning null when env
 * vars are missing. Use this in API routes where you'd just have to throw
 * anyway. Used by the keyword research and brand voice routes.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const client = getSupabaseServer();
  if (!client) {
    throw new Error(
      "Supabase server client unavailable. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.",
    );
  }
  return client;
}