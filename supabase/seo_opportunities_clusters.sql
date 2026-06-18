-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref in the dashboard URL matches .env.local before clicking Run.
-- ============================================================================

-- ============================================================================
-- Keyword clustering for the SEO Opportunity Radar.
-- ----------------------------------------------------------------------------
-- Adds semantic-cluster columns to seo_opportunities so related keywords
-- ("workplace discrimination lawyer", "discrimination lawyer NYC", …) are
-- grouped into ONE actionable cluster instead of appearing as separate rows
-- that tempt the user into building three competing pages (cannibalization).
--
-- Populated by the clustering pass (lib/keyword-clustering →
-- /api/seo/opportunities/cluster). One keyword per cluster is the primary; the
-- rest are members. A cluster is flagged PILLAR (build a supporting content
-- cluster) or STANDALONE (one page covers it).
--
--   cluster_id              groups rows that belong together (null = unclustered)
--   cluster_role            'primary' | 'member'
--   cluster_type            'pillar'  | 'standalone'
--   cluster_primary_keyword denormalized primary keyword text (for display + sort)
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

alter table public.seo_opportunities
  add column if not exists cluster_id              text,
  add column if not exists cluster_role            text,   -- 'primary' | 'member'
  add column if not exists cluster_type            text,   -- 'pillar' | 'standalone'
  add column if not exists cluster_primary_keyword text,
  add column if not exists clustered_at            timestamptz;

create index if not exists seo_opportunities_cluster_idx
  on public.seo_opportunities (tenant_id, cluster_id);
