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
-- Authentication & user roles
-- ============================================================================
-- Adds an app_users table that mirrors Supabase Auth's auth.users with our
-- own role column. Two roles supported: 'user' (read + use the dashboard)
-- and 'admin' (everything users can do + manage settings, invite users,
-- change other users' roles).
--
-- A trigger auto-creates an app_users row whenever a new user signs up via
-- Supabase Auth, defaulting to role='user'. The role can then be promoted
-- to 'admin' by an existing admin via the /admin/users page (or, for the
-- very first admin, via the ADMIN_EMAILS env var bootstrap on first login).
--
-- Run this in the Supabase SQL editor for the yijrpbdctzrgfpwdezqn project.
-- Idempotent.
-- ============================================================================

create table if not exists public.app_users (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null default 'user' check (role in ('user', 'admin')),
  status      text not null default 'active' check (status in ('active', 'disabled')),
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists app_users_email_idx on public.app_users (email);
create index if not exists app_users_role_idx on public.app_users (role);

alter table public.app_users enable row level security;

-- Authenticated users can read every row (so the admin UI can list them and
-- the sidebar can resolve the current user's role). Writes happen via the
-- service-role key from API routes only.
drop policy if exists "auth read app_users" on public.app_users;
create policy "auth read app_users"
  on public.app_users
  for select
  to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- Auto-create app_users row on Supabase Auth signup
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (user_id, email, role)
  values (new.id, new.email, 'user')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
