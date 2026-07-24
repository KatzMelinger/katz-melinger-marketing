-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Freshness gate (Huracán master spec, Part 1 — feature flag: freshness_gate)
-- ----------------------------------------------------------------------------
-- Additive to the existing current_facts store (supabase/current_facts_schema.sql).
-- Per the ground rules: extend current_facts by migration — do NOT rename, drop,
-- or recreate it. Adds verification/durability metadata to each figure, and a new
-- content_freshness_flags table for per-figure resolution (Apply update / Mark
-- verified) consumed by the gate slice.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- 1) Extend current_facts with verification + durability metadata --------------
alter table public.current_facts add column if not exists unit         text not null default '';
alter table public.current_facts add column if not exists source_url   text not null default '';
alter table public.current_facts add column if not exists verified_by  text not null default '';
alter table public.current_facts add column if not exists verified_at  timestamptz;
alter table public.current_facts add column if not exists re_verify_by date;
alter table public.current_facts add column if not exists verify_only  boolean not null default false;

comment on column public.current_facts.unit is 'Value denominator: hour | week | year (or empty).';
comment on column public.current_facts.re_verify_by is 'Attorney must re-confirm by this date. Past it the value flips to needs-re-verification and is never shown as verified.';
comment on column public.current_facts.verify_only is 'true = litigated/uncertain (e.g. federal $684). Never auto-suggest or auto-write; always require a human Mark verified.';

-- 2) content_freshness_flags — one row per flagged figure per content item.
--    Tracks resolution state so a draft cannot be approved with an unresolved
--    outdated/verify figure. Written server-side (admin client); consumed by the
--    gate slice.
create table if not exists public.content_freshness_flags (
  id               uuid primary key default gen_random_uuid(),
  content_id       text not null,
  tenant_id        uuid,
  token            text not null,                      -- matched figure, e.g. "$15.00" or "2020"
  kind             text not null default '',           -- dollar_amount|year|currency_phrase|statutory_threshold
  location         text not null default '',           -- enclosing sentence (rendered text)
  status           text not null default 'outdated',   -- outdated|verify|current|resolved
  matched_fact_key text,                                -- current_facts.fact_key it maps to (nullable)
  suggested_value  text,                                -- current value to apply (nullable)
  resolved_by      text,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists content_freshness_flags_content_idx
  on public.content_freshness_flags (tenant_id, content_id);

do $$ begin
  alter table public.content_freshness_flags
    add constraint content_freshness_flags_status_chk
    check (status in ('outdated', 'verify', 'current', 'resolved'));
exception when duplicate_object then null; end $$;

-- ============================================================================
-- RLS — mirror current_facts (reads for authenticated; writes via service role)
-- ============================================================================
alter table public.content_freshness_flags enable row level security;

drop policy if exists "auth read content_freshness_flags" on public.content_freshness_flags;
create policy "auth read content_freshness_flags"
  on public.content_freshness_flags for select to authenticated using (true);
