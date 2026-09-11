-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Item 7: stop repurpose producing the same batch twice
-- ============================================================================
-- Repurpose produced two identical five-format batches eleven minutes apart.
-- The route had no guard of any kind: it read the source and called
-- generateSocialPosts, so two submissions made two batches.
--
-- WHY A DATABASE CONSTRAINT AND NOT A LOOKUP
--
-- The obvious fix — "check whether a recent batch exists, then generate" — does
-- not hold. A double-click fires two requests milliseconds apart; both read an
-- empty result before either writes, and both proceed. That is the exact shape
-- of the failure being fixed, so a check that loses the race is no fix at all.
--
-- The unique index makes the SECOND insert fail no matter how close together
-- they arrive. The route still does the friendly pre-check (so the common case
-- gets a useful message and the expensive model call is skipped entirely), but
-- correctness rests here, not there.
--
-- THE KEY INCLUDES THE DAY
--
-- key = 'repurpose:<source>:<YYYY-MM-DD>'
--
-- One repurpose batch per source per day. A double-submit collides; repurposing
-- the same blog next quarter, which is a legitimate thing to want, does not.
-- An explicit re-run appends a nonce to bypass it — Diana's "unless explicitly
-- requested". Rows written before this migration have NULL and are unaffected,
-- which is why the index is partial.
-- ============================================================================

alter table public.content_batches
  add column if not exists idempotency_key text;

create unique index if not exists content_batches_idempotency_idx
  on public.content_batches (tenant_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.content_batches.idempotency_key is
  'Collision key for generation that must not run twice. Repurpose uses repurpose:<source>:<YYYY-MM-DD>; an explicit re-run appends a nonce. NULL on batches from paths that do not dedupe.';
