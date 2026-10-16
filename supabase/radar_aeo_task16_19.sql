-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Diana's Oct 6 2026 spec, Tasks 16 and 19.
--
-- 1. Task 16: the Keyword Tracker gets a status, so terms the Radar's weekly
--    discovery adds show as "Emerging" (ranking measured from day one).
--    Existing keywords are "tracked". Until this runs, discovery writes the
--    status into the note instead.
--
-- 2. Task 19: the AEO prompt set grows from 11 to 45: employment by practice
--    area in New York and New Jersey, collections and judgment enforcement,
--    and 8 in Spanish. The weekly sweep (Mondays) runs them all. aeo_prompts
--    gains a language column.
--
-- Idempotent: a prompt already present (same text, any case) is not added again.
-- ============================================================================

begin;

alter table public.seo_keywords
  add column if not exists status text not null default 'tracked';

alter table public.aeo_prompts
  add column if not exists language text not null default 'en';

insert into public.aeo_prompts (tenant_id, prompt, category, intent, geography, language)
select '00000000-0000-0000-0000-000000000001', v.prompt, v.category, v.intent, v.geography, v.language
from (values
  -- Employment, New York
  ('Best lawyer for workplace retaliation claims in New York', 'retaliation', 'commercial', 'New York', 'en'),
  ('Best law firm for a New York State Human Rights Law discrimination claim', 'discrimination', 'commercial', 'New York', 'en'),
  ('Pregnancy discrimination lawyer in New York City', 'discrimination', 'commercial', 'New York City', 'en'),
  ('Lawyer for a New York Labor Law 740 whistleblower retaliation case', 'whistleblower', 'commercial', 'New York', 'en'),
  ('Lawyer to challenge a non-compete agreement in New York', 'non-compete', 'commercial', 'New York', 'en'),
  ('Best lawyer for unpaid tips or tip theft at a New York City restaurant', 'wage & hour', 'commercial', 'New York City', 'en'),
  ('Who can help if I was misclassified as an independent contractor in New York', 'wage & hour', 'transactional', 'New York', 'en'),
  ('Age discrimination lawyer in Manhattan', 'discrimination', 'commercial', 'Manhattan', 'en'),
  ('What should I do if I was fired for complaining about harassment in New York', 'retaliation', 'informational', 'New York', 'en'),
  ('Best lawyer for a hostile work environment claim in NYC', 'harassment', 'commercial', 'New York City', 'en'),
  -- Employment, New Jersey
  ('Best employment lawyer in New Jersey for wrongful termination', 'wrongful termination', 'commercial', 'New Jersey', 'en'),
  ('Top overtime lawyers in New Jersey', 'wage & hour', 'commercial', 'New Jersey', 'en'),
  ('Best New Jersey lawyer for a CEPA whistleblower claim', 'whistleblower', 'commercial', 'New Jersey', 'en'),
  ('Who can help me with an FMLA violation in New Jersey', 'fmla', 'transactional', 'New Jersey', 'en'),
  ('Employment lawyer to review my severance agreement in New Jersey', 'severance', 'commercial', 'New Jersey', 'en'),
  ('Non-compete lawyer in New Jersey', 'non-compete', 'commercial', 'New Jersey', 'en'),
  ('Disability discrimination and reasonable accommodation lawyer in New Jersey', 'discrimination', 'commercial', 'New Jersey', 'en'),
  ('Sexual harassment lawyer for employees in New Jersey', 'harassment', 'commercial', 'New Jersey', 'en'),
  -- Collections and judgment enforcement
  ('Best commercial collections law firm in New York for unpaid invoices', 'collections', 'commercial', 'New York', 'en'),
  ('Lawyer to collect a business debt in New Jersey', 'collections', 'commercial', 'New Jersey', 'en'),
  ('Who can enforce a money judgment in New York', 'judgment enforcement', 'transactional', 'New York', 'en'),
  ('Judgment enforcement attorney in New York City', 'judgment enforcement', 'commercial', 'New York City', 'en'),
  ('How do I serve an information subpoena in New York', 'judgment enforcement', 'informational', 'New York', 'en'),
  ('Lawyer to file a restraining notice on a debtor''s bank account in New York', 'judgment enforcement', 'commercial', 'New York', 'en'),
  ('Best law firm to collect on a New Jersey judgment', 'judgment enforcement', 'commercial', 'New Jersey', 'en'),
  ('How to enforce an out-of-state judgment in New York', 'judgment enforcement', 'informational', 'New York', 'en'),
  -- Spanish
  ('Mejor abogado laboral en Nueva York para salarios no pagados', 'wage & hour', 'commercial', 'New York', 'es'),
  ('Abogado de despido injustificado en Nueva York', 'wrongful termination', 'commercial', 'New York', 'es'),
  ('Abogado de horas extras en Nueva Jersey', 'wage & hour', 'commercial', 'New Jersey', 'es'),
  ('Abogado para acoso sexual en el trabajo en Nueva York', 'harassment', 'commercial', 'New York', 'es'),
  ('¿Qué hago si mi empleador no me paga las horas extras en Nueva York?', 'wage & hour', 'informational', 'New York', 'es'),
  ('Abogado de discriminación laboral en Nueva Jersey', 'discrimination', 'commercial', 'New Jersey', 'es'),
  ('Abogado para cobrar una deuda comercial en Nueva York', 'collections', 'commercial', 'New York', 'es'),
  ('¿Puedo demandar a mi empleador por represalias en Nueva York?', 'retaliation', 'informational', 'New York', 'es')
) as v(prompt, category, intent, geography, language)
where not exists (
  select 1 from public.aeo_prompts p
   where p.tenant_id = '00000000-0000-0000-0000-000000000001'
     and lower(p.prompt) = lower(v.prompt)
);

commit;
