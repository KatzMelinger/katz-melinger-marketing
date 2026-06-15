-- ============================================================================
-- tenant_settings.firm_spokesperson — per-tenant PR spokesperson / attorney.
-- ============================================================================
-- Attribution-ready name + title used when drafting PR pitches and quotes,
-- e.g. "Jane Doe, Partner at Doe Law LLP". Replaces the hardcoded "Kenneth Katz"
-- in the PR-pitch routes so other firms get their own attribution.
-- Idempotent; safe to re-run.
-- ============================================================================

alter table public.tenant_settings
  add column if not exists firm_spokesperson text;

-- Seed the default Katz Melinger tenant so its PR pitches are unchanged.
update public.tenant_settings
  set firm_spokesperson = 'Kenneth Katz, Partner at Katz Melinger PLLC'
  where tenant_id = '00000000-0000-0000-0000-000000000001'
    and (firm_spokesperson is null or firm_spokesperson = '');
