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
-- Multi-tenancy — Phase 1: foundation (SAFE, non-breaking).
-- ============================================================================
-- Adds a tenants table + a default "Katz Melinger" tenant, then adds a
-- tenant_id column to every data table, backfilled to that default tenant.
--
-- IMPORTANT — what this does NOT do (on purpose):
--   * Does NOT change RLS. Policies stay permissive ("any authenticated user
--     can read/write"), so the existing app keeps working unchanged.
--   * Does NOT require app code changes yet. tenant_id has a DEFAULT of the
--     Katz Melinger tenant, so rows written by the current (tenant-unaware)
--     code still land in the right tenant.
--
-- Enforcement (RLS scoped by tenant, per-request tenant resolution) comes in
-- Phase 4 — only after the app reads/writes tenant_id everywhere. Flipping it
-- now would lock the live app out of its own data.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- Fixed UUID for the default tenant so we can use it as a column DEFAULT.
-- (00000000-0000-0000-0000-000000000001 = Katz Melinger PLLC)

create table if not exists public.tenants (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  primary_domain text,
  status         text not null default 'active' check (status in (
    'active','suspended','archived'
  )),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

insert into public.tenants (id, slug, name, primary_domain)
values (
  '00000000-0000-0000-0000-000000000001',
  'katz-melinger',
  'Katz Melinger PLLC',
  'katzmelinger.com'
)
on conflict (id) do nothing;

alter table public.tenants enable row level security;
drop policy if exists "auth read tenants" on public.tenants;
create policy "auth read tenants"
  on public.tenants for select to authenticated using (true);
drop policy if exists "auth write tenants" on public.tenants;
create policy "auth write tenants"
  on public.tenants for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Add tenant_id to every data table that exists. Guarded so tables that
-- haven't been created on this instance are skipped. NOT NULL DEFAULT means
-- existing rows are backfilled to the default tenant automatically.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tbls text[] := array[
    'ad_compliance_checks','ad_creatives','ad_platform_accounts',
    'aeo_prompts','aeo_responses','aeo_runs','aeo_targets',
    'ai_bot_hits','ai_projects','ai_prompt_runs','ai_prompts','ai_search_scans',
    'app_users','brand_voice_avatars','brand_voice_samples','brand_voice_settings',
    'brief_suggestions','cannibalization_snapshots','community_post_status',
    'content_analyses','content_batches','content_drafts','content_pipeline',
    'content_skills','content_sources','generated_images','google_oauth_tokens',
    'image_style_settings','internal_link_audits','legal_authority_sources',
    'llms_txt_versions','marketing_alert_rules','marketing_alerts',
    'negative_keywords','people_ask_sources','recommendation_items',
    'recommendations_history','research_packets','semrush_cache',
    'seo_disavow_actions','seo_keywords','seo_target_keywords',
    'seo_tracked_competitors','site_pages','technical_seo_runs',
    'wp_autopilot_recommendations','wp_autopilot_tokens'
  ];
begin
  foreach t in array tbls loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'alter table public.%I add column if not exists tenant_id uuid not null default ''00000000-0000-0000-0000-000000000001'' references public.tenants(id)',
        t
      );
      execute format(
        'create index if not exists %I on public.%I (tenant_id)',
        t || '_tenant_idx', t
      );
    end if;
  end loop;
end $$;

-- touch trigger for tenants
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists tenants_touch on public.tenants;
create trigger tenants_touch
  before update on public.tenants
  for each row execute function public.touch_updated_at();
