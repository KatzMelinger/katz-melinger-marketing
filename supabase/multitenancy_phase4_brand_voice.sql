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
-- Multi-tenancy — Phase 4 module: tenant-scoped RLS for Brand Voice.
-- ============================================================================
-- Tables: brand_voice_settings (key/value), brand_voice_avatars, brand_voice_samples.
--
-- brand_voice_settings was keyed by `key` ALONE (PK), which prevented two firms
-- from having the same setting key. Repoint the primary key to (tenant_id, key)
-- so each firm has its own key namespace; the settings upsert uses
-- onConflict "tenant_id,key". Then flip RLS to tenant-scoped on all three tables.
--
-- NOTE: this drops the old (key) PK, so deploy the tenant-aware code
-- (onConflict "tenant_id,key") together with this. Idempotent.
-- ============================================================================

do $$ begin
  if not exists (
    select 1 from pg_constraint con join pg_class cl on cl.oid = con.conrelid
    where cl.relname = 'brand_voice_settings' and con.contype = 'p'
      and pg_get_constraintdef(con.oid) = 'PRIMARY KEY (tenant_id, key)'
  ) then
    alter table public.brand_voice_settings drop constraint if exists brand_voice_settings_tenant_key_key;
    alter table public.brand_voice_settings drop constraint if exists brand_voice_settings_pkey;
    alter table public.brand_voice_settings add primary key (tenant_id, key);
  end if;
end $$;

do $$
declare t text; p text;
begin
  foreach t in array array['brand_voice_settings','brand_voice_avatars','brand_voice_samples'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;
