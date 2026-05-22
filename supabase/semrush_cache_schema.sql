-- ============================================================================
-- semrush_cache — Supabase-backed cache for Semrush API responses
-- ============================================================================
-- Every Semrush call previously hit the API live (`cache: "no-store"`), so a
-- dashboard reload burned the same 20 units it had ten minutes ago. With a
-- 2,000,000 unit/month plan, heavy dashboard use during a workday drained the
-- entire monthly allocation in ~24 hours.
--
-- This table caches raw response bodies keyed by a SHA-256 hash of the
-- request URL (minus the API key, so key rotation doesn't invalidate
-- everything). TTL is set per report type by the application layer:
--   * 12h for rank-sensitive reports (domain_organic, domain_ranks)
--   * 24h for backlink reports (slower-moving on Semrush's side)
--   * 7d  for keyword volume / difficulty (essentially stable)
--
-- ERROR responses from Semrush (e.g. "API UNITS BALANCE IS ZERO") are NOT
-- cached — those should retry on the next call.
--
-- Idempotent. Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn
-- project.
-- ============================================================================

create table if not exists public.semrush_cache (
  cache_key       text primary key,
  report_type     text not null,
  response_body   text not null,
  cached_at       timestamptz not null default now(),
  expires_at      timestamptz not null
);

create index if not exists semrush_cache_expires_at_idx
  on public.semrush_cache (expires_at);

create index if not exists semrush_cache_report_type_idx
  on public.semrush_cache (report_type);

alter table public.semrush_cache enable row level security;

-- Service role bypasses RLS, but if anything ever reaches this table with
-- the anon key we want it to be read-only at most.
drop policy if exists "auth read semrush_cache" on public.semrush_cache;
create policy "auth read semrush_cache"
  on public.semrush_cache
  for select
  to authenticated
  using (true);
