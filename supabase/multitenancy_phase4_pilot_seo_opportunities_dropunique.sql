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
