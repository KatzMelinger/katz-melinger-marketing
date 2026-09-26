-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Aggregate the visibility trend in SQL instead of shipping every row.
-- ============================================================================
-- Diana's September report: "The Huraqan keyword tracker is still broken... it's
-- still stuck on June 13, and it now shows 0 tracked keywords where August
-- showed 194."
--
-- The tracker was never broken. seo_keywords holds all 194 rows and the daily
-- refresh has written 194 own-domain snapshots every day without a gap —
-- verified 2026-09-25: 1,164 rows a day including competitors, 96,832 in total.
--
-- The bug was in the READ. /api/seo/rank-history asked for 180 days of raw rows
-- ordered captured_on ASCENDING with no pagination, and PostgREST caps a
-- response at 1,000 rows. At 1,164 rows a day the entire payload was consumed
-- by the OLDEST day in the window — 2026-06-13, the first snapshot ever taken.
-- Hence "stuck on June 13": that was the only date in the response, so it was
-- the only option in the From and To selectors. And of those 1,164 daily rows
-- only 194 are the firm's own domain, the rest competitors, so after filtering
-- to katzmelinger.com the list came out at or near zero. It got worse as
-- history grew, which is exactly the month-over-month degradation she saw.
--
-- This function does the visibility aggregation where the data is, so the trend
-- line costs one row per domain per day (about 1,080 for a 180-day window)
-- instead of ~210,000.
--
-- The CASE replicates ctrForRank in lib/rank-history.ts exactly. The two must
-- agree — if the curve changes there, change it here in the same commit, or the
-- chart and any client-side calculation will disagree.
--
-- security invoker (the default, stated for the avoidance of doubt) so the
-- caller's RLS applies: the existing seo_rank_snapshots tenant policy scopes
-- the rows, and this function grants no extra reach.
-- ============================================================================

create or replace function public.seo_rank_visibility(p_since date)
returns table (domain text, captured_on date, visibility numeric, sampled integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.domain,
    s.captured_on,
    -- Mean CTR across the domain's tracked keywords that day, as a percentage
    -- with one decimal — the same rounding the TypeScript did.
    round(
      avg(
        case
          when s.rank is null or s.rank < 1 or s.rank > 100 then 0
          when s.rank = 1  then 0.317
          when s.rank = 2  then 0.247
          when s.rank = 3  then 0.187
          when s.rank = 4  then 0.130
          when s.rank = 5  then 0.095
          when s.rank = 6  then 0.068
          when s.rank = 7  then 0.050
          when s.rank = 8  then 0.040
          when s.rank = 9  then 0.034
          when s.rank = 10 then 0.030
          when s.rank <= 20 then 0.015
          when s.rank <= 50 then 0.008
          else 0.003
        end
      ) * 100,
      1
    )::numeric as visibility,
    count(*)::integer as sampled
  from public.seo_rank_snapshots s
  where s.captured_on >= p_since
  group by s.domain, s.captured_on
$$;

comment on function public.seo_rank_visibility(date) is
  'Visibility trend per domain per capture date (mean CTR across tracked keywords, percent). Aggregates in SQL so /api/seo/rank-history does not have to read ~210k raw rows and get truncated at PostgREST''s 1000-row cap. The CTR CASE mirrors ctrForRank in lib/rank-history.ts — keep them in step.';

-- The trend query scans by date; the comparison table scans by date + domain.
create index if not exists seo_rank_snapshots_date_domain_idx
  on public.seo_rank_snapshots (captured_on, domain);

-- Check: one row per domain per day, and the row count that backs each point.
--   select * from public.seo_rank_visibility((current_date - 7)::date)
--    order by captured_on desc, domain;
