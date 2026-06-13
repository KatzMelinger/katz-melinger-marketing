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
-- Multi-tenancy — Phase 4 module: tenant-scoped RLS for the Images feature.
-- ============================================================================
-- Tables: generated_images (id PK), image_style_assets (id PK),
-- image_style_settings (was PK `key`), image_style_channels (was PK `channel`).
-- Repoint the two single-column PKs to include tenant_id, then flip RLS on all
-- four. (Image bytes live in the `generated-images` storage bucket and stay on
-- the service-role client; only the table rows are tenant-scoped.) Idempotent.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_constraint con join pg_class cl on cl.oid=con.conrelid
    where cl.relname='image_style_settings' and con.contype='p'
      and pg_get_constraintdef(con.oid)='PRIMARY KEY (tenant_id, key)') then
    alter table public.image_style_settings drop constraint if exists image_style_settings_pkey;
    alter table public.image_style_settings add primary key (tenant_id, key);
  end if;
  if not exists (select 1 from pg_constraint con join pg_class cl on cl.oid=con.conrelid
    where cl.relname='image_style_channels' and con.contype='p'
      and pg_get_constraintdef(con.oid)='PRIMARY KEY (tenant_id, channel)') then
    alter table public.image_style_channels drop constraint if exists image_style_channels_pkey;
    alter table public.image_style_channels add primary key (tenant_id, channel);
  end if;
end $$;

do $$
declare t text; p text;
begin
  foreach t in array array['generated_images','image_style_assets','image_style_settings','image_style_channels'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;
