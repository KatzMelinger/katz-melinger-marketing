-- Constant Contact automation rules (MarketOS). Run in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.constant_contact_automation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  trigger_type text NOT NULL,
  email_sequence text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_constant_contact_automation_trigger
  ON public.constant_contact_automation (trigger_type);

CREATE INDEX IF NOT EXISTS idx_constant_contact_automation_created_at
  ON public.constant_contact_automation (created_at DESC);

ALTER TABLE public.constant_contact_automation ENABLE ROW LEVEL SECURITY;
