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
-- Brief Suggestions schema
-- ----------------------------------------------------------------------------
-- Holds one row per AI-generated content suggestion. The Strategy Engine
-- writes here; Diana / Kenneth approve / reject / hold from /seo/suggestions.
-- An approved row becomes the pre-filled brief on /seo/generator.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

create table if not exists public.brief_suggestions (
  id                  uuid primary key default gen_random_uuid(),

  -- What the cluster is about
  cluster_name        text not null,
  primary_keyword     text not null,
  secondary_keywords  jsonb not null default '[]'::jsonb,

  -- Engine decision
  content_type        text not null,          -- "practice_page" | "blog_post" | "case_result"
  practice_area       text not null,          -- "employment" | "collections"
  pillar_id           text,
  search_intent       text,                   -- "informational" | "commercial" | "proof"
  recommended_action  text not null,          -- "new_page" | "support_blog" | "page_refresh" | "faq" | "internal_link" | "hold" | "remove"
  priority            text not null default 'medium',  -- "high" | "medium" | "low"
  reasoning           text,                   -- why the engine recommended this
  decision_source     text not null default 'rules',   -- "rules" | "claude" | "hybrid"

  -- Full auto-filled Per-Page Brief (matches KMPerPageBrief shape)
  suggested_brief     jsonb not null default '{}'::jsonb,

  -- Metrics that justified the decision
  metrics             jsonb not null default '{}'::jsonb,  -- { volume, kd, currentRank, cpc, … }

  -- Cannibalization context
  cannibalization_risk  text default 'unknown',           -- "none" | "low" | "medium" | "high" | "unknown"
  cannibalization_notes text,
  existing_url          text,                              -- the page already ranking, if any

  -- Workflow
  status              text not null default 'pending',     -- "pending" | "approved" | "rejected" | "held"
  decision_notes      text,
  decided_at          timestamptz,
  decided_by          text,
  approved_draft_id   uuid,                                -- content_drafts.id once generated

  -- Provenance
  source              text default 'manual',                -- "manual" | "semrush_sync" | "import" | "auto"
  source_ref          text,                                 -- e.g. seo_keywords.id or an import name

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.brief_suggestions enable row level security;

drop policy if exists "auth read brief_suggestions"
  on public.brief_suggestions;
create policy "auth read brief_suggestions"
  on public.brief_suggestions
  for select
  to authenticated
  using (true);

-- Indexes for the queue UI
create index if not exists brief_suggestions_status_idx
  on public.brief_suggestions (status);
create index if not exists brief_suggestions_priority_idx
  on public.brief_suggestions (priority);
create index if not exists brief_suggestions_practice_area_idx
  on public.brief_suggestions (practice_area);
create index if not exists brief_suggestions_created_idx
  on public.brief_suggestions (created_at desc);
create index if not exists brief_suggestions_primary_keyword_idx
  on public.brief_suggestions (primary_keyword);
