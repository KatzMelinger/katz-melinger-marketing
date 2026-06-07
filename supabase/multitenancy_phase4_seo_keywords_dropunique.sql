-- ============================================================================
-- Multi-tenancy — Phase 4 module seo_keywords, Step B: drop legacy unique.
-- ============================================================================
-- Run ONLY after the tenant-aware code (onConflict / dedup on tenant_id+keyword)
-- is deployed. Lets two firms track the same keyword; (tenant_id, keyword) from
-- Step A keeps it unique within each firm. Idempotent.
-- ============================================================================

alter table public.seo_keywords
  drop constraint if exists seo_keywords_keyword_key;
