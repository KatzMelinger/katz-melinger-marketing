-- Sonnet 4.5 retirement (2026-11-30): move saved prompts to Sonnet 5.5.
--
-- The app already runs a saved Sonnet 4.5 prompt on Sonnet 5.5 at request time
-- (currentModel in lib/anthropic.ts), so this is cleanup, not a blocker: it
-- makes the Prompts page show the model that actually runs, and changes the
-- column default for new rows. Safe to re-run.

update public.ai_prompts
   set model = 'claude-sonnet-5-5'
 where model in ('claude-sonnet-4-5-20250929', 'claude-sonnet-4-5');

alter table public.ai_prompts
  alter column model set default 'claude-sonnet-5-5';
