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
--   2. When in doubt, .env.local wins, not any comment.
-- ============================================================================

-- ============================================================================
-- Brand Voice avatars — content-strategy columns
-- ----------------------------------------------------------------------------
-- Extends the avatar (persona) record beyond audience-understanding fields so
-- each profile carries enough to drive content generation directly:
--
--   snapshot        — one-line persona summary. Human-scannable and cheap to
--                     inject; lets firm-context lead with a compact line
--                     instead of the full detail block on every AI call.
--   legal_triggers  — the legal claims / matter types this persona maps to
--                     (e.g. age discrimination, WARN Act, retaliation, release
--                     review). The bridge from persona → practice area.
--   content_angles  — AI-suggested SEED angles to write about. Editorial hints,
--                     NOT the source of truth — the opportunity engine still
--                     surfaces fresh angles dynamically. Regenerate on demand.
--   keyword_themes  — AI-suggested SEED keyword themes, same seed-not-truth
--                     contract as content_angles.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

alter table public.brand_voice_avatars
  add column if not exists snapshot       text,
  add column if not exists legal_triggers text,
  add column if not exists content_angles text,
  add column if not exists keyword_themes text;
