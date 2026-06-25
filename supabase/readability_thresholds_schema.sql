-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. This is NOT the
-- CMS project, and NOT the pre-migration project.
--
-- Before you click Run:
--   1. Open the Supabase dashboard and confirm the project ref in the URL
--      matches the ref in .env.local's NEXT_PUBLIC_SUPABASE_URL.
--   2. Any project ref written elsewhere in this file may predate the
--      multitenancy migration (yijrpbdctzrgfpwdezqn -> ijlesksgnfqqpxtaelqs).
--      When in doubt, .env.local wins, not the comment.
-- ============================================================================

-- ============================================================================
-- readability_thresholds — tenant-editable green/amber/red cutoffs
-- ============================================================================
-- Lets Diana/Kenneth tune the readability bands (long-sentence/paragraph word
-- cutoffs, passive %, transition %, etc.) from the Content Standards UI without
-- a code change. The analysis engine reads this row and deep-merges it over the
-- code defaults in lib/readability/config.ts, so an empty/partial config still
-- yields a full set and any newly-added metric inherits its default.
--
-- One row per tenant. A single jsonb `config` blob (rather than one column per
-- cutoff) keeps the schema stable as metrics are added — same choice
-- compliance_rules_schema.sql makes with key_rules jsonb.
--
-- Depends on earlier multitenancy phases: public.tenants,
-- public.current_tenant_id(), public.touch_updated_at().
--
-- Idempotent. Run in the Supabase SQL editor for the LIVE marketing-SaaS project.
-- ============================================================================

create table if not exists public.readability_thresholds (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default '00000000-0000-0000-0000-000000000001'
                references public.tenants(id),
  config      jsonb not null default '{}'::jsonb,   -- per-metric { green, amber } cutoffs
  updated_at  timestamptz not null default now()
);

-- One thresholds row per tenant (upsert target).
create unique index if not exists readability_thresholds_tenant_idx
  on public.readability_thresholds (tenant_id);

-- ---------------------------------------------------------------------------
-- RLS — tenant-scoped (same shape as compliance_rules_schema).
-- ---------------------------------------------------------------------------
do $$
declare p text;
begin
  execute 'alter table public.readability_thresholds enable row level security';
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'readability_thresholds'
  loop
    execute format('drop policy if exists %I on public.readability_thresholds', p);
  end loop;
  execute $f$create policy "tenant rw readability_thresholds"
    on public.readability_thresholds for all to authenticated
    using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id())$f$;
end $$;

-- ---------------------------------------------------------------------------
-- updated_at touch trigger (shared function, defined by earlier schemas).
-- ---------------------------------------------------------------------------
drop trigger if exists readability_thresholds_touch on public.readability_thresholds;
create trigger readability_thresholds_touch
  before update on public.readability_thresholds
  for each row execute function public.touch_updated_at();
