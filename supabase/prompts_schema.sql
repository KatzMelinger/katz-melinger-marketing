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
-- Prompts + Projects workspace
-- ============================================================================
-- A library of saved prompt templates the team can reuse across features.
-- Each prompt has a body with {{variable}} placeholders, an optional system
-- prompt, default model + max_tokens, and tags. Projects group related
-- prompts (e.g., "Q1 Severance Campaign"). Every execution writes a row to
-- ai_prompt_runs with the rendered prompt, output, and a rough cost estimate.
--
-- Run in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn project.
-- Idempotent.
-- ============================================================================

-- 1) Projects ---------------------------------------------------------------
create table if not exists public.ai_projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists ai_projects_created_at_idx on public.ai_projects (created_at desc);

-- 2) Prompts ----------------------------------------------------------------
create table if not exists public.ai_prompts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.ai_projects (id) on delete set null,
  title           text not null,
  description     text,
  -- Variable substitution uses {{var_name}} syntax. The variables array is
  -- normally derived from the body but stored explicitly so we can render
  -- the run form without re-parsing every time.
  variables       text[] not null default '{}',
  system_prompt   text,
  user_prompt     text not null,
  model           text not null default 'claude-sonnet-4-5-20250929',
  max_tokens      integer not null default 4096,
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ai_prompts_project_idx on public.ai_prompts (project_id);
create index if not exists ai_prompts_created_at_idx on public.ai_prompts (created_at desc);

-- 3) Run history ------------------------------------------------------------
create table if not exists public.ai_prompt_runs (
  id              uuid primary key default gen_random_uuid(),
  prompt_id       uuid references public.ai_prompts (id) on delete cascade,
  variables       jsonb not null default '{}'::jsonb,
  rendered_user   text not null,
  rendered_system text,
  model           text not null,
  output          text,
  input_tokens    integer,
  output_tokens   integer,
  cost_estimate   numeric,
  latency_ms      integer,
  status          text not null default 'success' check (status in ('success', 'failed')),
  error           text,
  ran_by          uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists ai_prompt_runs_prompt_idx on public.ai_prompt_runs (prompt_id, created_at desc);

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.ai_projects enable row level security;
alter table public.ai_prompts enable row level security;
alter table public.ai_prompt_runs enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array['ai_projects','ai_prompts','ai_prompt_runs'])
  loop
    execute format('drop policy if exists "auth read %I" on public.%I;', t, t);
    execute format(
      'create policy "auth read %I" on public.%I for select to authenticated using (true);',
      t, t
    );
  end loop;
end$$;

-- ============================================================================
-- Updated-at touch trigger (reuses public.tg_touch_updated_at if it exists,
-- creates it otherwise).
-- ============================================================================

create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_ai_prompts_updated on public.ai_prompts;
create trigger touch_ai_prompts_updated
  before update on public.ai_prompts
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists touch_ai_projects_updated on public.ai_projects;
create trigger touch_ai_projects_updated
  before update on public.ai_projects
  for each row execute function public.tg_touch_updated_at();
