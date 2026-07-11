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
--   2. When in doubt, .env.local wins, not any comment.
-- ============================================================================

-- ============================================================================
-- Social module Phase 0: "one Post, many Variations" — MIGRATE, don't recreate.
-- ----------------------------------------------------------------------------
-- Guardrails honored (per the confirmed spec):
--   * social_posts is KEPT. Not renamed, not dropped, not recreated. We only
--     ADD nullable parent-level columns to it.
--   * social_variations + social_assets are NEW children with matching tenant_id
--     + RLS. Nothing here weakens existing row-level security.
--   * Backfill only — every existing social_posts row is mirrored into one
--     social_variations row. Existing rows are never overwritten or deleted.
--   * Fully additive + idempotent. Safe to re-run.
--
-- Model after this migration:
--   social_posts       = the Post (parent). Legacy per-platform columns stay on
--                        it, untouched, so the current calendar + Ayrshare paths
--                        keep working unchanged until Phase 1/2 move them to read
--                        variations.
--   social_variations  = one row per platform under a Post (copy, hashtags,
--                        schedule, Ayrshare id, publish status, error).
--   social_assets      = slides / scripts / images attached to a Post.
--
-- The child FK type (post_id) is detected from social_posts.id at run time, so
-- this is correct whether that PK is uuid or bigint. No guessing.
-- ============================================================================

-- Katz Melinger tenant — same default the Phase 4 backfill used, so tenant-
-- unaware writes still land in the right tenant and existing rows backfill.
-- (00000000-0000-0000-0000-000000000001)

-- ----------------------------------------------------------------------------
-- 1. Parent-level columns on the KEPT social_posts table (additive, nullable).
-- ----------------------------------------------------------------------------
alter table public.social_posts
  add column if not exists core_message text;      -- the Post's shared message
alter table public.social_posts
  add column if not exists created_by   text;      -- who composed it
alter table public.social_posts
  add column if not exists approved_at  timestamptz; -- set when the Post is Approved (Phase 2 gate)

-- ----------------------------------------------------------------------------
-- 2. Create the child tables with a post_id FK typed to match social_posts.id.
-- ----------------------------------------------------------------------------
do $$
declare
  id_type text;
begin
  if to_regclass('public.social_posts') is null then
    raise exception 'social_posts does not exist in this database — wrong DB target?';
  end if;

  -- Detect the PK type so the FK matches (uuid | bigint | integer | text...).
  select data_type into id_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'social_posts' and column_name = 'id';

  if id_type is null then
    raise exception 'Could not find social_posts.id column type.';
  end if;

  -- social_variations: one row per platform under a Post.
  execute format($ddl$
    create table if not exists public.social_variations (
      id             uuid primary key default gen_random_uuid(),
      post_id        %s not null references public.social_posts(id) on delete cascade,
      tenant_id      uuid not null default '00000000-0000-0000-0000-000000000001'
                       references public.tenants(id),
      platform       text,                    -- facebook|linkedin|instagram|tiktok|gmb
      post_type      text default 'post',     -- post|carousel|reel
      copy           text,
      hashtags       text[] default '{}',
      media_refs     jsonb default '[]',
      char_count     int,
      scheduled_at   timestamptz,
      ayrshare_id    text,
      post_url       text,
      publish_status text default 'draft',    -- draft|scheduled|published|failed
      error_message  text,
      created_at     timestamptz default now()
    )
  $ddl$, id_type);

  -- social_assets: slides / scripts / images attached to a Post.
  execute format($ddl$
    create table if not exists public.social_assets (
      id         uuid primary key default gen_random_uuid(),
      post_id    %s not null references public.social_posts(id) on delete cascade,
      tenant_id  uuid not null default '00000000-0000-0000-0000-000000000001'
                   references public.tenants(id),
      type       text,                        -- slide|script|image
      payload    jsonb,
      created_at timestamptz default now()
    )
  $ddl$, id_type);
end $$;

-- ----------------------------------------------------------------------------
-- 3. Indexes.
-- ----------------------------------------------------------------------------
create index if not exists social_variations_post_idx      on public.social_variations (post_id);
create index if not exists social_variations_tenant_idx    on public.social_variations (tenant_id);
create index if not exists social_variations_scheduled_idx on public.social_variations (tenant_id, scheduled_at);
create index if not exists social_variations_status_idx    on public.social_variations (tenant_id, publish_status);
create index if not exists social_variations_ayrshare_idx  on public.social_variations (ayrshare_id);
create index if not exists social_assets_post_idx          on public.social_assets (post_id);
create index if not exists social_assets_tenant_idx        on public.social_assets (tenant_id);

-- ----------------------------------------------------------------------------
-- 4. RLS — same tenant-isolation pattern the rest of the app uses. Reads/writes
--    currently flow through the SERVICE-ROLE client (which bypasses RLS), so
--    this is non-breaking today and becomes real enforcement when these routes
--    move to the authenticated client (in lockstep, Phase 1/2). current_tenant_id()
--    is defined in multitenancy_phase4_rls.sql.
-- ----------------------------------------------------------------------------
alter table public.social_variations enable row level security;
alter table public.social_assets     enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='social_variations'
                   and policyname='social_variations_tenant_isolation') then
    create policy social_variations_tenant_isolation on public.social_variations
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='social_assets'
                   and policyname='social_assets_tenant_isolation') then
    create policy social_assets_tenant_isolation on public.social_assets
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id());
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Backfill — mirror every existing social_posts row into one variation, so
--    historical data is already in the new shape the moment the calendar +
--    publish routes switch to reading variations (Phase 1/2). Backfill only:
--    we skip any post that already has variations, so re-running never dupes and
--    never overwrites. Legacy columns on social_posts are left as-is.
-- ----------------------------------------------------------------------------
insert into public.social_variations
  (post_id, tenant_id, platform, post_type, copy, hashtags, media_refs,
   char_count, scheduled_at, ayrshare_id, post_url, publish_status, error_message, created_at)
select
  p.id,
  p.tenant_id,
  p.platform,
  'post',
  p.content,
  '{}',
  coalesce(p.media_urls, '[]'::jsonb),
  char_length(coalesce(p.content, '')),
  p.scheduled_at,
  p.ayrshare_id,
  p.post_url,
  coalesce(p.status, 'published'),
  p.last_error,
  coalesce(p.created_at, now())
from public.social_posts p
where not exists (
  select 1 from public.social_variations v where v.post_id = p.id
);

-- ============================================================================
-- Post-run sanity checks (optional — run manually, read-only):
--   select count(*) from public.social_posts;
--   select count(*) from public.social_variations;   -- should match after backfill
--   select data_type from information_schema.columns
--     where table_name='social_variations' and column_name='post_id';
-- ============================================================================
