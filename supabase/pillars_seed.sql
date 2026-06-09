-- ============================================================================
-- Seed the default tenant's content pillars into tenant_settings.pillars.
-- ============================================================================
-- Makes the DB the live source of truth for pillars (editable via Brand Voice
-- → Content pillars) instead of the hard-coded constants. Each pillar carries
-- its grouper keyword hints so the keyword grouper can route to it.
--
-- Idempotent: only seeds when pillars is currently NULL, so re-running never
-- clobbers edits made in the UI. The app also works WITHOUT running this —
-- lib/pillars-store.getPillars() falls back to the code default when null — but
-- seeding gives the editor real rows immediately and lets the grouper read the
-- stored keyword hints.
--
-- Requires Phase 2 (tenant_settings table). Run in the Supabase SQL editor.
-- ============================================================================

update public.tenant_settings
set pillars = '[
  {"id":"wage-theft","label":"Wage Theft and Overtime","url":"/wage-theft-overtime/","practiceArea":"employment","keywords":["wage","overtime","unpaid","minimum wage","tip","off the clock","flsa","nyll"]},
  {"id":"wrongful-termination","label":"Wrongful Termination","url":"/wrongful-termination/","practiceArea":"employment","keywords":["wrongful termination","fired","fired without cause","retaliation firing"]},
  {"id":"discrimination","label":"Workplace Discrimination","url":"/workplace-discrimination/","practiceArea":"employment","keywords":["discrimination","discriminate","age discrimination","ageism","racial","gender discrimination","disability discrimination","title vii"]},
  {"id":"sexual-harassment","label":"Sexual Harassment","url":"/sexual-harassment/","practiceArea":"employment","keywords":["sexual harassment","sexual misconduct","quid pro quo","groping"]},
  {"id":"leave","label":"Leave and Accommodations","url":"/leave-accommodations/","practiceArea":"employment","keywords":["leave","fmla","ada accommodation","pregnancy leave","medical leave","family leave"]},
  {"id":"hostile","label":"Hostile Work Environment","url":"/hostile-work-environment/","practiceArea":"employment","keywords":["hostile work","hostile environment","workplace bullying"]},
  {"id":"severance","label":"Severance Agreements","url":"/severance/","practiceArea":"employment","keywords":["severance","non-compete","noncompete","non compete","employment agreement","employment contract","restrictive covenant","non-disclosure","non-solicit","nda"]},
  {"id":"retaliation","label":"Retaliation","url":"/retaliation/","practiceArea":"employment","keywords":["retaliation","retaliat","reprisal","retaliatory"]},
  {"id":"whistleblower","label":"Whistleblower Protection","url":"/whistleblower/","practiceArea":"employment","keywords":["whistleblower","whistle blow","whistleblowing","whistle-blower"]},
  {"id":"collections-hub","label":"Collections Hub","url":"/civil-litigation/collections-judgment-enforcement/","practiceArea":"collections","keywords":["collect","collections","creditor"]},
  {"id":"judgment-enforcement","label":"Judgment Enforcement","url":"/practice-areas/civil-litigation/judgment-collection/","practiceArea":"collections","keywords":["judgment","enforcement","restraining notice","levy","garnishment","turnover","cplr"]},
  {"id":"domestication","label":"Domestication of Judgments","url":"/practice-areas/civil-litigation/domesticating-judgments-in-ny-step-by-step-guide/","practiceArea":"collections","keywords":["domesticate","domestication","out-of-state judgment","sister state"]}
]'::jsonb
where tenant_id = '00000000-0000-0000-0000-000000000001'
  and pillars is null;
