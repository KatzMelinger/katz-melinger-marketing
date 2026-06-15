-- ============================================================================
-- Review-generation workflow — outbound review requests + their funnel.
-- ============================================================================
-- Powers the "Request Reviews" tab on /reviews. This is the WRITE loop that
-- complements the existing read loop (GBP sync → reviews table → AI replies):
--
--   pick recipient → AI-personalize the ask → send (email/SMS) → they click →
--   land on the public Google review form → track outcome → optional follow-up.
--
--   review_requests — one row per ask. `token` backs the tracked redirect
--                     (/r/[token]) that stamps clicked_at and 302s the
--                     recipient to the firm's public "write a review" link.
--
-- Tenant-scoped (Phase 4 multi-tenancy). Recipients are added by staff (manual
-- or CSV import) — a human decides who is appropriate to ask. NO sentiment
-- gating: everyone is sent straight to the public review form, per Google's
-- review policy and the FTC's 2024 Rule on reviews (16 CFR 465).
--
-- Idempotent. Run in the Supabase SQL editor (after the multitenancy phases,
-- which create public.tenants + public.current_tenant_id() + touch_updated_at).
-- ============================================================================

create table if not exists public.review_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default '00000000-0000-0000-0000-000000000001'
                      references public.tenants(id),
  recipient_name    text,
  recipient_contact text not null,                         -- email address or phone (E.164)
  channel           text not null check (channel in ('email','sms')),
  practice_area     text,                                  -- drives the right disclaimer
  status            text not null default 'queued' check (status in (
    'queued',                                              -- created, not yet sent
    'sent',                                                -- handed to email/SMS provider
    'clicked',                                             -- recipient followed the tracked link
    'posted',                                              -- review confirmed posted (manual/sync)
    'failed'                                               -- provider rejected the send
  )),
  token             text not null,                         -- secret in the /r/<token> redirect URL
  subject           text,                                  -- email subject (null for SMS)
  message           text,                                  -- the AI-generated body that was sent
  source            text not null default 'manual' check (source in ('manual','csv')),
  provider          text,                                  -- 'resend' | 'twilio' | 'stub'
  provider_id       text,                                  -- message id returned by the provider
  error             text,                                  -- provider error when status='failed'
  sent_at           timestamptz,
  clicked_at        timestamptz,
  posted_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The token is looked up at click time with NO tenant context (public URL,
-- service-role client), so it must be globally unique, not per-tenant.
create unique index if not exists review_requests_token_idx
  on public.review_requests (token);
create index if not exists review_requests_tenant_idx
  on public.review_requests (tenant_id);
create index if not exists review_requests_tenant_status_idx
  on public.review_requests (tenant_id, status);

-- ---------------------------------------------------------------------------
-- RLS — tenant-scoped (same shape as compliance_rules_schema).
-- ---------------------------------------------------------------------------
do $$
declare t text; p text;
begin
  foreach t in array array['review_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy "tenant rw %1$s" on public.%1$I for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- updated_at touch trigger (shared function, defined by earlier schemas).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['review_requests'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format(
      'create trigger %1$s_touch before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
