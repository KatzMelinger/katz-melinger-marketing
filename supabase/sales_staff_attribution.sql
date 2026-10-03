-- =============================================================================
-- Sales Coach: who was on each call.
--
-- CallRail forwards to Vonage, so calls.agent_email is always empty and every
-- score landed under "Unassigned". This adds:
--   sales_staff            — the people who earn intake / sales credit, with the
--                            name variants transcripts use ("Andre" for Andres)
--   calls.staff_id         — who handled the call
--   calls.staff_source     — how we know: transcript | airtable | vonage | manual
--   call_scores.agent_name_detected — the name the scorer heard, kept even when
--                            it can't be resolved (e.g. "Gabriel" with two Gabriels)
--
-- Only people in sales_staff with credit_eligible = true are ever credited.
-- Re-runnable. Apply via Supabase SQL editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sales_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
    REFERENCES public.tenants (id),
  full_name text NOT NULL,
  first_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',     -- spellings transcripts produce
  email text,
  initials text,                            -- as used in Airtable follow-up notes
  roles text[] NOT NULL DEFAULT '{}'        -- intake | sales
    CHECK (roles <@ ARRAY['intake', 'sales']::text[]),
  credit_eligible boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, full_name)
);

CREATE INDEX IF NOT EXISTS sales_staff_tenant_idx ON public.sales_staff (tenant_id);

ALTER TABLE public.sales_staff ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales_staff'
                 AND policyname = 'Authenticated users have full access to sales_staff') THEN
    CREATE POLICY "Authenticated users have full access to sales_staff"
      ON public.sales_staff FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.sales_staff (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staff_source text
    CHECK (staff_source IN ('transcript', 'airtable', 'vonage', 'manual'));

CREATE INDEX IF NOT EXISTS calls_staff_idx ON public.calls (tenant_id, staff_id);

ALTER TABLE public.call_scores
  ADD COLUMN IF NOT EXISTS agent_name_detected text;

-- Katz Melinger roster (2026). Noella Chau and Agnes Lopez are deliberately
-- absent: they write follow-up notes but are not part of intake or sales.
INSERT INTO public.sales_staff (full_name, first_name, aliases, email, initials, roles)
VALUES
  ('Alicia Rosales',   'Alicia',   '{Alisha,Elicia,Alysia}',   NULL,                         'AR',  '{intake}'),
  ('Gabriel Olivares', 'Gabriel',  '{Gabe}',                   NULL,                         'GO',  '{intake}'),
  ('Andres Cabrales',  'Andres',   '{Andrés,Andre,Andrew}',    'acabrales@katzmelinger.com', 'AC',  '{intake,sales}'),
  ('Gabriel Moreno',   'Gabriel',  '{Gabe}',                   'gmoreno@katzmelinger.com',   'GM',  '{intake,sales}'),
  ('Jose Hernandez',   'Jose',     '{José,Joseph}',            NULL,                         'JH',  '{intake}'),
  ('Angelica Molina',  'Angelica', '{Angélica,Angie}',         'amolina@katzmelinger.com',   'AM',  '{sales}'),
  ('Kenneth Katz',     'Kenneth',  '{Ken,Kenny}',              'kjkatz@katzmelinger.com',    'KK',  '{sales}'),
  ('Nicole Grunfeld',  'Nicole',   '{}',                       'ndgrunfeld@katzmelinger.com','NG',  '{sales}'),
  ('Adam Sackowitz',   'Adam',     '{}',                       'ajsackowitz@katzmelinger.com','AJS','{sales}')
ON CONFLICT (tenant_id, full_name) DO NOTHING;
