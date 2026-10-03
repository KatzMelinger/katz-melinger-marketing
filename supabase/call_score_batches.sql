-- =============================================================================
-- Sales Coach: nightly scoring batches (Anthropic Message Batches API, 50% off).
--
-- One row per submitted batch. The nightly job skips calls that are already
-- in a 'submitted' batch; the hourly collector saves results and marks the
-- row 'collected'.
--
-- Re-runnable. Apply via Supabase SQL editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.call_score_batches (
  id text PRIMARY KEY,                      -- Anthropic message batch id
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
    REFERENCES public.tenants (id),
  call_ids text[] NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'collected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  collected_at timestamptz,
  scored int,
  failed int,
  -- Summed token usage of the batch's results, so the real nightly cost is
  -- visible: {input, cache_read, cache_write, output}. Batch prices are half
  -- the list price; cache hits inside a batch are best-effort.
  usage jsonb
);

CREATE INDEX IF NOT EXISTS call_score_batches_status_idx ON public.call_score_batches (tenant_id, status);

ALTER TABLE public.call_score_batches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'call_score_batches'
                 AND policyname = 'Authenticated users have full access to call_score_batches') THEN
    CREATE POLICY "Authenticated users have full access to call_score_batches"
      ON public.call_score_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
