-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- content_source_contradictions — spec 6.14's source-consistency check
-- ----------------------------------------------------------------------------
-- "Flag when a claim carried into the post is one another live KM page
-- contradicts, naming both URLs; seed known contradictions as traps."
--
-- Same shape and reasoning as content_known_traps (a pattern is a SUSPICION,
-- not a verdict — this is a reviewer's worklist, not an auto-verdict), but a
-- distinct table rather than a new match_type on that one: a trap there is
-- "this shape of text has been wrong before" with no reference to any other
-- page; a row here is specifically "this shape of text conflicts with a
-- NAMED live URL", which needs its own contradicting_url/contradicting_summary
-- columns content_known_traps has no use for.
--
-- Seeded EMPTY on purpose. Unlike legal_knowledge_base's threshold rows
-- (seeded from figures Diana's spec already confirmed), no specific
-- contradiction has been confirmed yet — inventing one here would be a worse
-- start than shipping the mechanism with nothing in it. The maintenance loop
-- is the same one content_known_traps already uses: every time a repurposed
-- post is caught contradicting a live page, that pair becomes a row here.
--
-- Idempotent. Safe to re-run; seeded rows (none yet) are matched on
-- (tenant_id, lower(label)).
-- ============================================================================

create table if not exists public.content_source_contradictions (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null default '00000000-0000-0000-0000-000000000001'
                            references public.tenants(id),
  label                   text not null,
  match_type              text not null default 'phrase' check (match_type in ('phrase', 'regex')),
  -- Substring (phrase) or regex source, tested against the social post body —
  -- the CLAIM being carried into the post that conflicts with the other page.
  pattern                 text not null,
  -- The other live KM page this pattern conflicts with, and what IT actually
  -- says — both shown to the reviewer so they don't have to go find it.
  contradicting_url       text not null,
  contradicting_summary   text not null,
  severity                text not null default 'important' check (severity in ('critical', 'important')),
  enabled                 boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists content_source_contradictions_tenant_label_idx
  on public.content_source_contradictions (tenant_id, lower(label));

alter table public.content_source_contradictions enable row level security;
drop policy if exists content_source_contradictions_tenant on public.content_source_contradictions;
create policy content_source_contradictions_tenant on public.content_source_contradictions
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ============================================================================
-- Post-run sanity check (optional, read-only):
--   select count(*) from public.content_source_contradictions;
-- ============================================================================
