-- ============================================================================
-- tenant_settings.email_provider — per-tenant email-distribution provider (B1).
-- ============================================================================
-- Picks which EmailProvider (constant-contact | mailchimp | sendgrid | …) a firm
-- uses. NULL → the registry's default (first available; Constant Contact today).
-- Idempotent; safe to re-run.
-- ============================================================================

alter table public.tenant_settings
  add column if not exists email_provider text;
