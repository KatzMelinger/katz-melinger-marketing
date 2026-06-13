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
-- SEO keyword exclusions schema
-- ----------------------------------------------------------------------------
-- Diana-managed blocklist of keyword terms. A keyword whose text contains any
-- term here is excluded from the SEO Opportunity Radar (set excluded = true on
-- seo_opportunities). This is the user-editable layer ON TOP of the built-in,
-- code-defined filters (branded / navigational / off-domain in
-- lib/keyword-filter.ts) — those stay in code; this table lets the SEO
-- strategist curate firm-specific exclusions without a deploy.
--
-- `term` is stored normalized (trimmed + lower-cased) and matched as a
-- case-insensitive substring of the keyword.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

create table if not exists public.seo_keyword_exclusions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  term        text not null,                       -- normalized: trimmed + lower-cased
  reason      text,                                -- optional note shown in the manage panel
  source      text not null default 'manual',      -- "manual" | "seed"
  added_at    timestamptz not null default now(),
  unique (tenant_id, term)
);

alter table public.seo_keyword_exclusions enable row level security;

drop policy if exists "auth read seo_keyword_exclusions"
  on public.seo_keyword_exclusions;
create policy "auth read seo_keyword_exclusions"
  on public.seo_keyword_exclusions
  for select
  to authenticated
  using (true);

create index if not exists seo_keyword_exclusions_tenant_idx
  on public.seo_keyword_exclusions (tenant_id);
