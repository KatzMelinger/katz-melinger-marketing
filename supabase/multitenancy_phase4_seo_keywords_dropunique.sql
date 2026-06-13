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
-- Multi-tenancy — Phase 4 module seo_keywords, Step B: drop legacy unique.
-- ============================================================================
-- Run ONLY after the tenant-aware code (onConflict / dedup on tenant_id+keyword)
-- is deployed. Lets two firms track the same keyword; (tenant_id, keyword) from
-- Step A keeps it unique within each firm. Idempotent.
-- ============================================================================

alter table public.seo_keywords
  drop constraint if exists seo_keywords_keyword_key;
