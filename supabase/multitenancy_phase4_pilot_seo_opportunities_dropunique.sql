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
-- Multi-tenancy — Phase 4 PILOT, Step B: drop the legacy single-column unique.
-- ============================================================================
-- Run ONLY after the tenant-aware code (onConflict "tenant_id,keyword") is
-- deployed. Dropping (keyword)-only uniqueness is what finally lets two firms
-- track the same keyword; the (tenant_id, keyword) constraint from Step A keeps
-- it unique within each firm. Idempotent.
-- ============================================================================

alter table public.seo_opportunities
  drop constraint if exists seo_opportunities_keyword_key;
