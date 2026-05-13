-- ============================================================================
-- Tracked SEO target keywords — persistent storage
-- ============================================================================
-- Replaces the hardcoded DEFAULT_TARGET_KEYWORDS list in lib/seo-intelligence.ts
-- so marketing can add/remove tracked phrases from the UI without a code
-- deploy. Mirrors the seo_tracked_competitors pattern (seed marker row to
-- distinguish "never seeded" from "user removed everything").
--
-- Idempotent. Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn
-- project.
-- ============================================================================

create table if not exists public.seo_target_keywords (
  keyword     text primary key,
  source      text not null default 'manual'
                check (source in ('manual', 'env_seed', 'suggested', 'system')),
  added_at    timestamptz not null default now()
);

alter table public.seo_target_keywords enable row level security;

drop policy if exists "auth read seo_target_keywords"
  on public.seo_target_keywords;
create policy "auth read seo_target_keywords"
  on public.seo_target_keywords
  for select
  to authenticated
  using (true);

-- Seed the table with the legacy default set so existing functionality
-- continues to work on first deploy. Idempotent via on conflict.
insert into public.seo_target_keywords (keyword, source) values
  ('new york employment lawyer', 'env_seed'),
  ('wage theft attorney nyc', 'env_seed'),
  ('wrongful termination lawyer ny', 'env_seed'),
  ('workplace discrimination attorney', 'env_seed'),
  ('sexual harassment lawyer nyc', 'env_seed'),
  ('overtime pay lawyer new york', 'env_seed'),
  ('fmla retaliation attorney', 'env_seed'),
  ('whistleblower lawyer new york', 'env_seed')
on conflict (keyword) do nothing;
