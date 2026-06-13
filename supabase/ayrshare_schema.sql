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
-- Ayrshare social publishing
-- ----------------------------------------------------------------------------
-- The account-level API key lives in env (AYRSHARE_API_KEY). This migration
-- adds the optional per-tenant Profile-Key (Ayrshare Business multi-account)
-- and extends social_posts so a published/scheduled post can be reconciled
-- back to Ayrshare (its post id + permalink + status + schedule time).
--
-- Both blocks are additive and idempotent — safe to re-run. Existing rows are
-- unaffected (new columns are nullable).
-- ============================================================================

-- Per-tenant Ayrshare profile key. Null → post with the account key alone.
alter table public.tenant_settings
  add column if not exists ayrshare_profile_key text;

-- social_posts: post-tracking columns for the publish path.
alter table public.social_posts
  add column if not exists ayrshare_id text;       -- Ayrshare's post id (groups platforms)
alter table public.social_posts
  add column if not exists post_url text;           -- permalink to the live post
alter table public.social_posts
  add column if not exists status text not null default 'published'; -- published | scheduled | failed
alter table public.social_posts
  add column if not exists scheduled_at timestamptz; -- when status = scheduled
alter table public.social_posts
  add column if not exists published_at timestamptz; -- when status = published
alter table public.social_posts
  add column if not exists source_draft_id uuid;     -- content_drafts.id this came from, if any

create index if not exists social_posts_status_idx
  on public.social_posts (tenant_id, status);
create index if not exists social_posts_ayrshare_id_idx
  on public.social_posts (ayrshare_id);
