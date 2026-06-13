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
-- AI bot crawl tracking
-- ============================================================================
-- GA4 strips bot traffic by default, so to know if GPTBot / ClaudeBot /
-- PerplexityBot / etc. are reaching katzmelinger.com we need a separate
-- ingest path. This table is the destination.
--
-- Populate via:
--   - WordPress: small mu-plugin / theme functions.php snippet that POSTs
--     to /api/ai-bots/ingest on every request matching a known AI bot UA
--   - Cloudflare Worker: detect AI bot UAs at the edge and POST in
--     fire-and-forget mode
--   - Server logs: nightly batch ingest from Cloudflare Logpush or NGINX
--     access log parsing
--
-- The bot column is normalized to a canonical name (gptbot, claudebot,
-- etc.) so dashboards can group across UA-string variations.
-- ============================================================================

create table if not exists public.ai_bot_hits (
  id          bigserial primary key,
  hit_at      timestamptz not null default now(),
  bot         text not null,
  user_agent  text,
  host        text,
  path        text,
  status      integer,
  ip_hash     text,
  meta        jsonb not null default '{}'::jsonb
);

create index if not exists idx_ai_bot_hits_hit_at
  on public.ai_bot_hits (hit_at desc);
create index if not exists idx_ai_bot_hits_bot
  on public.ai_bot_hits (bot);

alter table public.ai_bot_hits enable row level security;

drop policy if exists "auth read ai_bot_hits"
  on public.ai_bot_hits;
create policy "auth read ai_bot_hits"
  on public.ai_bot_hits
  for select
  to authenticated
  using (true);
