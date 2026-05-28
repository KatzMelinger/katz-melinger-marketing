-- ============================================================================
-- Research Layer — Legal Authority Library, People Ask & Trends Library,
-- and generated Research Packets.
-- ============================================================================
-- Sits BEFORE the KM Brief Generator in the content flow:
--   Source Material → Run Research Layer → (Legal Authority + People Ask
--   libraries) → Research Packet → KM Brief auto-fill → Diana review → draft.
--
-- The two *_sources tables are human-curated libraries (CRUD on /content/
-- research). research_packets are generated artifacts that snapshot the
-- relevant library entries + live-source pulls for one topic.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Legal Authority Library — trusted, attorney-vetted legal sources.
-- ---------------------------------------------------------------------------
create table if not exists public.legal_authority_sources (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,                       -- "EEOC — Filing a Charge"
  url            text not null,
  source_type    text not null default 'agency' check (source_type in (
    'statute',
    'regulation',
    'agency',
    'case_law',
    'internal_page',     -- existing Katz Melinger page
    'other'
  )),
  practice_area  text,                                -- maps to KM practice areas
  jurisdiction   text,                                -- 'federal','NY','NYC','NJ', etc.
  authority_level text not null default 'primary' check (authority_level in (
    'primary',           -- statute, regulation, binding case law
    'secondary',         -- agency guidance, official explainers
    'tertiary'           -- commentary, internal pages
  )),
  topics         text[] not null default '{}',        -- free tags for matching
  notes          text,
  review_status  text not null default 'unverified' check (review_status in (
    'unverified',
    'verified',
    'needs_review',
    'archived'
  )),
  last_verified_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists legal_authority_practice_idx
  on public.legal_authority_sources (practice_area);
create index if not exists legal_authority_topics_idx
  on public.legal_authority_sources using gin (topics);

-- ---------------------------------------------------------------------------
-- People Ask & Trends Library — real questions + trend signals. Some rows
-- are curated by hand; others are auto-captured from live sources (Semrush,
-- Search Console, Autocomplete, Reddit, YouTube) via the research layer.
-- ---------------------------------------------------------------------------
create table if not exists public.people_ask_sources (
  id             uuid primary key default gen_random_uuid(),
  content        text not null,                        -- the question / topic / phrase
  source_type    text not null default 'manual' check (source_type in (
    'paa',               -- Google People Also Ask
    'autocomplete',      -- Google Autocomplete
    'semrush',
    'search_console',
    'reddit',
    'youtube',
    'avvo',
    'justia',
    'quora',
    'competitor',
    'manual'
  )),
  practice_area  text,
  topic_tags     text[] not null default '{}',
  jurisdiction   text,
  use_case       text,                                 -- 'faq','blog','social','newsletter','aeo'
  trend_signal   text,                                 -- 'rising','steady','seasonal','spike', etc.
  source_url     text,
  metric         jsonb not null default '{}'::jsonb,   -- volume, position, score, etc.
  review_status  text not null default 'unverified' check (review_status in (
    'unverified',
    'verified',
    'needs_review',
    'archived'
  )),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists people_ask_practice_idx
  on public.people_ask_sources (practice_area);
create index if not exists people_ask_tags_idx
  on public.people_ask_sources using gin (topic_tags);
create index if not exists people_ask_source_type_idx
  on public.people_ask_sources (source_type);

-- ---------------------------------------------------------------------------
-- Research Packets — generated snapshot feeding the KM Brief Generator.
-- ---------------------------------------------------------------------------
create table if not exists public.research_packets (
  id                       uuid primary key default gen_random_uuid(),
  topic                    text not null,
  practice_area            text,
  primary_keyword          text,
  legal_sources_found      jsonb not null default '[]'::jsonb,
  people_ask_sources_found jsonb not null default '[]'::jsonb,
  suggested_faqs           jsonb not null default '[]'::jsonb,
  suggested_statutes       jsonb not null default '[]'::jsonb,
  suggested_angles         jsonb not null default '[]'::jsonb,
  source_confidence        text not null default 'low' check (source_confidence in (
    'low','medium','high'
  )),
  legal_review_required    boolean not null default true,
  status                   text not null default 'draft' check (status in (
    'draft','ready','used','archived'
  )),
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists research_packets_created_idx
  on public.research_packets (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS — authenticated read/write. API routes use the service role.
-- ---------------------------------------------------------------------------
alter table public.legal_authority_sources enable row level security;
alter table public.people_ask_sources enable row level security;
alter table public.research_packets enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'legal_authority_sources',
    'people_ask_sources',
    'research_packets'
  ] loop
    execute format('drop policy if exists "auth read %1$s" on public.%1$s', t);
    execute format(
      'create policy "auth read %1$s" on public.%1$s for select to authenticated using (true)', t);
    execute format('drop policy if exists "auth write %1$s" on public.%1$s', t);
    execute format(
      'create policy "auth write %1$s" on public.%1$s for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- updated_at touch trigger (shared function).
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'legal_authority_sources',
    'people_ask_sources',
    'research_packets'
  ] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format(
      'create trigger %1$s_touch before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
