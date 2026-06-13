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
-- Google OAuth user tokens — for Google Business Profile + future Google APIs
-- ============================================================================
-- Service accounts can't auto-accept Business Profile invitations (the email-
-- click handshake doesn't work for non-human accounts), so for GBP we have to
-- use the OAuth user-consent flow instead. This table stores the refresh
-- token + the latest access token so the dashboard can reuse them across
-- requests and auto-refresh when the access token expires.
--
-- Idempotent. Run in the Supabase SQL editor for the
-- yijrpbdctzrgfpwdezqn project.
-- ============================================================================

create table if not exists public.google_oauth_tokens (
  id              uuid primary key default gen_random_uuid(),
  -- A short tag for which integration this token is for. We currently use
  -- 'gbp' (Google Business Profile); future integrations (Sheets, Calendar,
  -- Drive) would each get their own row.
  purpose         text not null unique,
  -- Comma-separated list of OAuth scopes granted (for display/debug).
  scopes          text not null,
  access_token    text not null,
  refresh_token   text not null,
  expires_at      timestamptz not null,
  -- Email of the Google user who clicked through the consent screen.
  granted_email   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists google_oauth_tokens_purpose_idx
  on public.google_oauth_tokens (purpose);

alter table public.google_oauth_tokens enable row level security;

drop policy if exists "auth read google_oauth_tokens" on public.google_oauth_tokens;
create policy "auth read google_oauth_tokens"
  on public.google_oauth_tokens
  for select
  to authenticated
  using (true);
