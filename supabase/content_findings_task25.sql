-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Fewer, better flags — Diana's Oct 6 2026 spec, Task 25.
--
-- 1. content_findings_archive: closed findings older than 30 days move here
--    and are no longer loaded in History. Moved daily by
--    archive_closed_findings(), called from /api/findings/archive (cron).
--    Only findings closed as fixed move. Dismissed and "approved as is" stay:
--    they are standing decisions the next analysis must still see, or the
--    same question would be asked again. (History hides them after 30 days.)
--    The Changes made log lives in the draft's metadata and is not touched.
--
-- 2. One-time cleanup, so drafts nobody re-analyzes look right today:
--    open style findings (brand voice, readability, SEO except cannibalization,
--    AEO, CASH, linkability, structure) close: they are scores now, not review
--    items; and open findings in the retired negative_statement /
--    interpretation categories close: their sentences are re-checked as legal
--    claims on the next analysis. The code does the same on every analysis.
--
-- Idempotent.
-- ============================================================================

begin;

create table if not exists public.content_findings_archive
  (like public.content_findings including defaults);

alter table public.content_findings_archive
  add column if not exists archived_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'content_findings_archive_pkey'
  ) then
    alter table public.content_findings_archive add primary key (id);
  end if;
end $$;

create index if not exists content_findings_archive_draft_idx
  on public.content_findings_archive (draft_id, archived_at desc);

alter table public.content_findings_archive enable row level security;
drop policy if exists content_findings_archive_tenant on public.content_findings_archive;
create policy content_findings_archive_tenant on public.content_findings_archive
  for select using (tenant_id = public.current_tenant_id());

-- The archive is content_findings' columns plus archived_at, in that order.
-- A column added to content_findings later must be added here too.
create or replace function public.archive_closed_findings(p_days integer default 30)
returns integer
language plpgsql
as $$
declare
  moved integer;
begin
  with gone as (
    delete from public.content_findings f
     where f.status in ('resolved', 'resolved_by_edit')
       and coalesce(f.resolution, '') <> 'approved_as_is'
       and coalesce(f.resolved_at, f.updated_at) < now() - make_interval(days => p_days)
    returning f.*
  )
  insert into public.content_findings_archive
  select gone.*, now() from gone;
  get diagnostics moved = row_count;
  return moved;
end;
$$;

update public.content_findings
   set status = 'resolved',
       resolved_at = now(),
       resolution_note = 'Style suggestion: shown in the scores, no longer a review item.',
       updated_at = now()
 where status in ('open', 'in_progress')
   and source in ('readability', 'brand_voice', 'seo', 'aeo', 'cash', 'linkability', 'structure')
   and not (source = 'seo' and coalesce(rule_id, '') = 'cannibalization');

update public.content_findings
   set status = 'resolved',
       resolved_at = now(),
       resolution_note = 'Retired category: the sentence is re-checked as a legal claim.',
       updated_at = now()
 where status = 'open'          -- one already sent to an attorney stays with them
   and source = 'legal'
   and rule_id in ('negative_statement', 'interpretation');

commit;
