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
-- site_pages — automated cluster map / site inventory.
-- ============================================================================
-- A living map of every page on katzmelinger.com, crawled from the sitemap.
-- Powers the cannibalization / "link don't redefine" checks: before writing a
-- service page, the system knows quid-pro-quo already has a blog post, etc.
--
-- Re-crawled on a daily cron; classifications (pillar, page_type) can be
-- corrected by hand and survive re-crawls (we only overwrite title/h1 on
-- re-crawl, not human-set pillar overrides — see lib/site-inventory.ts).
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.site_pages (
  id              uuid primary key default gen_random_uuid(),
  url             text not null unique,
  title           text,
  h1              text,
  page_type       text not null default 'other' check (page_type in (
    'blog_post',
    'service_page',
    'pillar',
    'cluster',
    'case_result',
    'practice_area',
    'other'
  )),
  pillar          text,                       -- KM pillar id (e.g. 'sexual-harassment')
  practice_area   text,                       -- 'employment' | 'collections'
  topics          text[] not null default '{}',
  summary         text,
  pillar_locked   boolean not null default false,  -- true = human override; crawl won't change pillar
  last_crawled_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists site_pages_pillar_idx on public.site_pages (pillar);
create index if not exists site_pages_type_idx on public.site_pages (page_type);
create index if not exists site_pages_topics_idx on public.site_pages using gin (topics);
-- Trigram index would be ideal for ILIKE term search; fall back to a plain
-- index on lowered title for simple prefix/word matching without the extension.
create index if not exists site_pages_title_idx on public.site_pages (lower(title));

alter table public.site_pages enable row level security;

drop policy if exists "auth read site_pages" on public.site_pages;
create policy "auth read site_pages"
  on public.site_pages for select to authenticated using (true);

drop policy if exists "auth write site_pages" on public.site_pages;
create policy "auth write site_pages"
  on public.site_pages for all to authenticated using (true) with check (true);

-- Reuse the shared touch_updated_at() trigger function if present, else create.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_pages_touch on public.site_pages;
create trigger site_pages_touch
  before update on public.site_pages
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- research_packets gains an existing_coverage column so the content-overlap
-- findings (link-don't-redefine) ride along with the packet.
-- ----------------------------------------------------------------------------
alter table public.research_packets
  add column if not exists existing_coverage jsonb not null default '[]'::jsonb;
