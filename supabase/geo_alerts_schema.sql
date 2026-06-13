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
-- Katz Melinger MarketOS — GEO/AEO + Alerts schema
-- ============================================================================
-- Adds tables for:
--   * Generative-engine optimization (AEO): prompts, brand mentions in AI
--     answers, source attribution, share of voice, sentiment.
--   * Marketing alerts framework: rule-driven alerts surfaced in the UI when
--     SEO ranks drop, AI share of voice shifts, new citations appear, etc.
--   * Cannibalization snapshots and internal-link audits (cached crawl results
--     so the dashboard renders instantly between scans).
--
-- Run this in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn project.
-- Idempotent; safe to re-run.
-- ============================================================================

-- 1) AEO prompts -------------------------------------------------------------
-- The buyer-intent prompts we want to test against AI engines. Each prompt is
-- run periodically and we record where (if anywhere) the firm gets cited and
-- what the AI says about it.
create table if not exists public.aeo_prompts (
  id            uuid primary key default gen_random_uuid(),
  prompt        text not null,
  category      text,                       -- e.g. "wage theft", "discrimination"
  intent        text,                       -- informational | commercial | transactional | navigational
  geography     text,                       -- e.g. "New York City"
  enabled       boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists aeo_prompts_enabled_idx
  on public.aeo_prompts (enabled);

-- 2) AEO targets (self + competitors) ---------------------------------------
-- Brands/domains we track inside AI answers. type='self' is our firm; the rest
-- are competitor firms. aliases is a JSON array of string variations the LLM
-- might use ("Katz Melinger", "Katz Melinger PLLC", "katzmelinger.com", etc).
create table if not exists public.aeo_targets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null check (type in ('self', 'competitor')),
  domain      text,
  aliases     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  unique (type, domain)
);

-- 3) AEO runs ----------------------------------------------------------------
-- One row per batch (one full sweep over all enabled prompts × all enabled
-- providers). Lets us slice metrics by run for trend lines.
create table if not exists public.aeo_runs (
  id              uuid primary key default gen_random_uuid(),
  status          text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  providers       jsonb not null default '[]'::jsonb,   -- ["claude", "openai", "perplexity", "gemini"]
  prompt_count    integer not null default 0,
  response_count  integer not null default 0,
  failure_count   integer not null default 0,
  started_at      timestamptz,
  completed_at    timestamptz,
  triggered_by    text,                                  -- "manual" | "cron"
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists aeo_runs_created_at_idx
  on public.aeo_runs (created_at desc);

-- 4) AEO responses -----------------------------------------------------------
-- One row per (run, prompt, provider). Stores the raw response and parsed
-- structures: which targets were mentioned, which sources were cited, what
-- sentiment Claude judged the description to be.
create table if not exists public.aeo_responses (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid references public.aeo_runs (id) on delete cascade,
  prompt_id         uuid references public.aeo_prompts (id) on delete cascade,
  provider          text not null,                       -- claude | openai | perplexity | gemini
  model             text,                                 -- the actual model snapshot used
  response_text     text,
  citations         jsonb not null default '[]'::jsonb,  -- [{ url, title?, domain }]
  brand_mentions    jsonb not null default '[]'::jsonb,  -- [{ target_id, name, type, position, sentiment }]
  self_mentioned    boolean not null default false,      -- denormalized: did our firm appear?
  self_position     integer,                              -- 1-based ordinal in the response (1 = first brand mentioned)
  self_sentiment    text,                                 -- positive | neutral | negative | mixed
  authority_sources jsonb not null default '[]'::jsonb,  -- ["wikipedia.org", "reddit.com", "youtube.com"]
  latency_ms        integer,
  error             text,
  created_at        timestamptz not null default now()
);

create index if not exists aeo_responses_run_idx on public.aeo_responses (run_id);
create index if not exists aeo_responses_prompt_idx on public.aeo_responses (prompt_id);
create index if not exists aeo_responses_provider_idx on public.aeo_responses (provider);
create index if not exists aeo_responses_self_mentioned_idx on public.aeo_responses (self_mentioned);

-- 5) Marketing alerts --------------------------------------------------------
-- The unified alert log. Anything worth flagging — a tracked keyword's rank
-- dropped > N positions, a competitor started getting AI citations on a prompt
-- we don't appear in, sentiment turned negative, etc — lands here.
create table if not exists public.marketing_alerts (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,                              -- rank_drop | aeo_loss | aeo_gain | sentiment_shift | new_citation | cannibalization
  severity    text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  source      text,                                       -- seo | aeo | social | local | content
  title       text not null,
  body        text,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'new' check (status in ('new', 'read', 'dismissed')),
  detected_at timestamptz not null default now(),
  read_at     timestamptz,
  dismissed_at timestamptz
);

create index if not exists marketing_alerts_status_idx on public.marketing_alerts (status, detected_at desc);
create index if not exists marketing_alerts_type_idx on public.marketing_alerts (type, detected_at desc);

-- 6) Alert rules -------------------------------------------------------------
-- Configurable rule set; each evaluator reads the rules and writes alerts.
create table if not exists public.marketing_alert_rules (
  id                 uuid primary key default gen_random_uuid(),
  type               text not null,                       -- matches alerts.type
  enabled            boolean not null default true,
  threshold          jsonb not null default '{}'::jsonb,  -- e.g. { "min_rank_drop": 5, "min_volume": 50 }
  last_evaluated_at  timestamptz,
  notes              text,
  created_at         timestamptz not null default now()
);

-- 7) Cannibalization snapshots ----------------------------------------------
-- Cached output of the cannibalization detector. We re-detect on demand, but
-- store the latest snapshot so the dashboard renders without waiting on
-- Semrush.
create table if not exists public.cannibalization_snapshots (
  id          uuid primary key default gen_random_uuid(),
  domain      text not null,
  issues      jsonb not null,                              -- [{ keyword, urls: [...], severity }]
  total_issues integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists cannibalization_snapshots_created_at_idx
  on public.cannibalization_snapshots (created_at desc);

-- 8) Internal-link audit snapshots -------------------------------------------
create table if not exists public.internal_link_audits (
  id          uuid primary key default gen_random_uuid(),
  domain      text not null,
  pages       integer not null default 0,
  total_internal_links integer not null default 0,
  total_external_links integer not null default 0,
  orphan_pages jsonb not null default '[]'::jsonb,         -- pages crawled but not linked from any other crawled page
  thin_pages   jsonb not null default '[]'::jsonb,         -- pages with < 3 outbound internal links
  hub_pages    jsonb not null default '[]'::jsonb,         -- top pages by inbound internal links
  page_graph   jsonb not null default '[]'::jsonb,         -- [{ url, inbound, outbound }]
  created_at   timestamptz not null default now()
);

create index if not exists internal_link_audits_created_at_idx
  on public.internal_link_audits (created_at desc);

-- 9) llms.txt versions -------------------------------------------------------
-- We generate llms.txt content from the firm's own pages and brand context.
-- This table just records what we generated and when; the served file is
-- whatever the user pasted into their site root.
create table if not exists public.llms_txt_versions (
  id          uuid primary key default gen_random_uuid(),
  domain      text not null,
  content     text not null,
  source_pages jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- RLS — service role bypasses; authenticated users get read-only by default
-- ============================================================================

alter table public.aeo_prompts enable row level security;
alter table public.aeo_targets enable row level security;
alter table public.aeo_runs enable row level security;
alter table public.aeo_responses enable row level security;
alter table public.marketing_alerts enable row level security;
alter table public.marketing_alert_rules enable row level security;
alter table public.cannibalization_snapshots enable row level security;
alter table public.internal_link_audits enable row level security;
alter table public.llms_txt_versions enable row level security;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'aeo_prompts','aeo_targets','aeo_runs','aeo_responses',
      'marketing_alerts','marketing_alert_rules',
      'cannibalization_snapshots','internal_link_audits','llms_txt_versions'
    ])
  loop
    execute format('drop policy if exists "auth read %I" on public.%I;', t, t);
    execute format(
      'create policy "auth read %I" on public.%I for select to authenticated using (true);',
      t, t
    );
  end loop;
end$$;

-- ============================================================================
-- Seed data
-- ============================================================================

-- Self target — the firm itself, with common alias variations.
insert into public.aeo_targets (name, type, domain, aliases)
values (
  'Katz Melinger PLLC', 'self', 'katzmelinger.com',
  '["Katz Melinger", "Katz Melinger PLLC", "katzmelinger.com", "Katz & Melinger"]'::jsonb
)
on conflict (type, domain) do nothing;

-- A starter set of buyer prompts. Edit/extend from /aeo in the UI.
insert into public.aeo_prompts (prompt, category, intent, geography)
values
  ('Best employment lawyer in New York City for unpaid overtime', 'wage & hour', 'commercial', 'New York City'),
  ('Who should I hire to sue my employer for wrongful termination in NYC', 'wrongful termination', 'transactional', 'New York City'),
  ('Top employment discrimination law firms in Manhattan', 'discrimination', 'commercial', 'Manhattan'),
  ('Plaintiff side employment lawyer for sexual harassment New York', 'harassment', 'commercial', 'New York'),
  ('Severance negotiation attorney Manhattan recommendations', 'severance', 'commercial', 'Manhattan'),
  ('How do I prove an FMLA retaliation claim in New York', 'fmla', 'informational', 'New York'),
  ('Can I sue for unpaid wages in New Jersey small business', 'wage & hour', 'informational', 'New Jersey'),
  ('Best NYC law firm for collecting on a commercial judgment', 'collections', 'commercial', 'New York City'),
  ('What is the statute of limitations for a wage claim in New York', 'wage & hour', 'informational', 'New York'),
  ('How much does an employment lawyer cost in NYC', 'general', 'informational', 'New York City')
on conflict do nothing;

-- Default alert rules. Tweakable from /alerts.
insert into public.marketing_alert_rules (type, threshold, notes)
values
  ('rank_drop', '{"min_drop": 5, "min_volume": 30}', 'Tracked keyword fell N+ positions vs previous check'),
  ('aeo_loss', '{}', 'Brand stopped appearing for a prompt it previously appeared in'),
  ('aeo_gain', '{}', 'Brand started appearing for a prompt it previously did not'),
  ('sentiment_shift', '{}', 'AI sentiment about the firm flipped negative on any prompt'),
  ('new_citation', '{}', 'A new domain started citing the firm in an AI answer'),
  ('cannibalization', '{"min_pages": 2}', 'Two or more URLs ranking for the same keyword')
on conflict do nothing;
