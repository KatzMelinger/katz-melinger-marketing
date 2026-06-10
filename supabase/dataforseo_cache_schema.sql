-- ============================================================================
-- dataforseo_cache — Supabase-backed cache for DataForSEO API responses
-- ============================================================================
-- DataForSEO bills per request (Labs "live" calls ~$0.01-0.02 each), so the
-- same caching discipline we used for Semrush applies: cache raw JSON response
-- bodies keyed by a SHA-256 hash of the endpoint path + request payload.
--
-- TTL is set per endpoint by the application layer (lib/dataforseo-cache.ts):
--   * 12h for rank-sensitive endpoints (ranked_keywords, domain_rank_overview)
--   * 24h for backlinks + competitor endpoints (slower-moving)
--   * 7d  for keyword volume / difficulty (essentially stable)
--
-- Error responses (status_code != 20000) are NOT cached — they retry next call.
--
-- Mirrors supabase/semrush_cache_schema.sql. Idempotent. Run in the Supabase
-- SQL editor for the ijlesksgnfqqpxtaelqs project.
-- ============================================================================

create table if not exists public.dataforseo_cache (
  cache_key       text primary key,
  report_type     text not null,
  response_body   text not null,
  cached_at       timestamptz not null default now(),
  expires_at      timestamptz not null
);

create index if not exists dataforseo_cache_expires_at_idx
  on public.dataforseo_cache (expires_at);

create index if not exists dataforseo_cache_report_type_idx
  on public.dataforseo_cache (report_type);

alter table public.dataforseo_cache enable row level security;

-- Service role bypasses RLS; anything reaching this with the anon key is
-- read-only at most. This cache is platform-wide (vendor data, not tenant
-- data), so no tenant_id column is needed.
drop policy if exists "auth read dataforseo_cache" on public.dataforseo_cache;
create policy "auth read dataforseo_cache"
  on public.dataforseo_cache
  for select
  to authenticated
  using (true);
