-- ============================================================================
-- !! DB TARGET CHECK — read before running
-- ----------------------------------------------------------------------------
-- Run this against the LIVE marketing-SaaS Supabase project — the one your
-- active .env.local points at via NEXT_PUBLIC_SUPABASE_URL. Confirm the project
-- ref matches .env.local before you click Run. .env.local wins over any comment.
-- ============================================================================

-- ============================================================================
-- Seed the compliance disclaimers (Diana's Sept 28 spec, 11.4).
--
-- /api/compliance/disclaimers returned an empty list, so the compliance model
-- had no disclaimer text to require. These four are the firm's locked elements
-- for blogs and web pages. The closing disclaimer is Kenneth's wording as
-- counsel (2026-09-29), verbatim; the offer phrase is his (2026-09-29).
--
-- The phone number in the CTA row is the document/web number from the
-- operating brief (brand_voice_settings.documentPhone, code default
-- 646-849-3352). If that setting changes after Diana confirms the CallRail
-- swap target, update this row too.
--
-- Deliberately NOT run: POST /api/compliance/state-rules/seed. It inserts
-- AI-drafted rules for 50 states + DC, and the compliance prompt reads them
-- without filtering on review_status — unverified text would reach the model.
--
-- Idempotent: deletes and re-inserts only the four labels below.
-- ============================================================================

delete from public.compliance_disclaimers
 where tenant_id = '00000000-0000-0000-0000-000000000001'
   and label in ('Attorney Advertising label', 'Closing disclaimer', 'Prior results', 'Closing CTA');

insert into public.compliance_disclaimers
  (tenant_id, label, text, jurisdiction, trigger, practice_area, enabled, review_status)
values
  ('00000000-0000-0000-0000-000000000001', 'Attorney Advertising label',
   'Attorney Advertising',
   'general', 'At the top of every blog and web page.', null, true, 'verified'),

  ('00000000-0000-0000-0000-000000000001', 'Closing disclaimer',
   'This article is for general informational purposes only, is not legal advice and does not create an attorney client relationship. For more information see our full Disclaimer.',
   'general', 'At the end of every blog and web page, with "Disclaimer" linked to https://katzmelinger.com/disclaimer/.', null, true, 'verified'),

  ('00000000-0000-0000-0000-000000000001', 'Prior results',
   'Prior results do not guarantee a similar outcome.',
   'general', 'Wherever case results or outcomes are mentioned.', null, true, 'verified'),

  ('00000000-0000-0000-0000-000000000001', 'Closing CTA',
   'Call today at 646-849-3352 for a Free Confidential Case Evaluation.',
   'general', 'Blogs and web pages, above the closing disclaimer. Social uses 646-466-6267.', null, true, 'verified');
