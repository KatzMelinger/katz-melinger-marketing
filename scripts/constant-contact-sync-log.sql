-- Sync activity log for Constant Contact (MarketOS). Run in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.constant_contact_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id text,
  synced_count integer NOT NULL DEFAULT 0,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_constant_contact_sync_log_created_at
  ON public.constant_contact_sync_log (created_at DESC);

ALTER TABLE public.constant_contact_sync_log ENABLE ROW LEVEL SECURITY;
