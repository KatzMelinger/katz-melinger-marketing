-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Attorney fee recovery is a remedy, not fee language (Kenneth, 2026-09-29).
--
-- content_known_traps_sept28.sql was run before this decision, so the live
-- trap "Fee shifting or free / low-cost language" still blocks "attorneys'
-- fees and costs are recoverable", "the employer may have to pay your legal
-- fees" and "fee-shifting". Re-running that file cannot fix it (it inserts
-- with on conflict do nothing, and the new row has a different label), so
-- this rewrites the live row in place. Safe to run more than once.
-- ============================================================================

update public.content_known_traps
   set label   = 'Cost of representation or free / low-cost language',
       pattern = '\bwithout\s+(?:having\s+to\s+)?pay(?:ing)?\s+(?:any\s+)?(?:legal|attorney(?:[\x27’]s|s[\x27’]?)?)\s+fees\b|\bpay(?:ing)?\s+(?:legal|attorney(?:[\x27’]s|s[\x27’]?)?)\s+fees\s+out\s+of\s+pocket\b|\bfree\s+or\s+low[\s-]+cost\b|\bat\s+no\s+cost\b',
       note    = 'Content must not say what the reader will or will not pay for representation: no "without paying legal fees out of pocket", "free or low cost" or "at no cost". Attorney fee recovery as a statutory remedy is allowed, and so is "free consultation" (Kenneth, 2026-09-29).'
 where label = 'Fee shifting or free / low-cost language';

-- Should return one row, with the new label.
select label, enabled, severity from public.content_known_traps
 where label in ('Fee shifting or free / low-cost language', 'Cost of representation or free / low-cost language');
