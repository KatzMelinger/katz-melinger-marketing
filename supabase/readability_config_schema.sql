-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Editable readability config (master-spec Part 2, slice 5)
-- ============================================================================
-- The 15 KM readability rules, the plain-word dictionary and the legal-term
-- allowlist are code-seeded in lib/readability-rules.ts. These tables let the
-- firm adjust the parts that are editorial judgement rather than logic, without
-- a deploy:
--
--   readability_rule_settings — switch a rule off (rule TEXT itself is code)
--   plainword_dictionary      — complex word → plain replacement (Rule 15)
--   legal_allowlist           — terms of art Rule 15 must never simplify
--
-- All three are read by lib/readability-config-store.ts, which falls back to the
-- code-seeded values when a table is empty or unreachable. An empty table means
-- "use the defaults", NOT "no rules" — so running this migration alone changes
-- nothing about how content scores.
--
-- Rule LOGIC is deliberately not editable here. The regexes and thresholds live
-- in code where they can be tested; only which rules run and the word lists are
-- data.
--
-- Additive and idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Per-rule on/off. A row is only needed to DISABLE a rule; absent = enabled.
-- ----------------------------------------------------------------------------
create table if not exists public.readability_rule_settings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  -- Matches RuleId in lib/readability-rules.ts ('01'…'15').
  rule_id     text not null,
  enabled     boolean not null default true,
  -- Why the firm turned it off, for the next person who wonders.
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists readability_rule_settings_tenant_rule_idx
  on public.readability_rule_settings (tenant_id, rule_id);

-- ----------------------------------------------------------------------------
-- Plain-word dictionary (Rule 15). complex → plain.
-- ----------------------------------------------------------------------------
create table if not exists public.plainword_dictionary (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  complex     text not null,
  plain       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Case-insensitive: "Utilize" and "utilize" are the same entry.
create unique index if not exists plainword_dictionary_tenant_word_idx
  on public.plainword_dictionary (tenant_id, lower(complex));

-- ----------------------------------------------------------------------------
-- Legal terms of art Rule 15 must leave alone.
-- ----------------------------------------------------------------------------
create table if not exists public.legal_allowlist (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  term        text not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists legal_allowlist_tenant_term_idx
  on public.legal_allowlist (tenant_id, lower(term));

-- ============================================================================
-- RLS — mirrors current_facts: authenticated read, writes via service role.
-- ============================================================================

alter table public.readability_rule_settings enable row level security;
alter table public.plainword_dictionary      enable row level security;
alter table public.legal_allowlist           enable row level security;

drop policy if exists "auth read readability_rule_settings" on public.readability_rule_settings;
create policy "auth read readability_rule_settings"
  on public.readability_rule_settings for select to authenticated using (true);

drop policy if exists "auth read plainword_dictionary" on public.plainword_dictionary;
create policy "auth read plainword_dictionary"
  on public.plainword_dictionary for select to authenticated using (true);

drop policy if exists "auth read legal_allowlist" on public.legal_allowlist;
create policy "auth read legal_allowlist"
  on public.legal_allowlist for select to authenticated using (true);
