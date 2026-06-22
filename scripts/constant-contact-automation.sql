-- Constant Contact automation rules (MarketOS). Run in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.constant_contact_automation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Multi-tenancy: defaults to the Katz Melinger tenant so existing rows and
  -- tenant-unaware writes land in the right tenant. multitenancy_phase4_tenant_id_backfill.sql
  -- adds this to already-created tables; included here for fresh installs.
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  name text NOT NULL,
  trigger_type text NOT NULL,
  email_sequence text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_constant_contact_automation_trigger
  ON public.constant_contact_automation (trigger_type);

CREATE INDEX IF NOT EXISTS constant_contact_automation_tenant_idx
  ON public.constant_contact_automation (tenant_id);

CREATE INDEX IF NOT EXISTS idx_constant_contact_automation_created_at
  ON public.constant_contact_automation (created_at DESC);

ALTER TABLE public.constant_contact_automation ENABLE ROW LEVEL SECURITY;
