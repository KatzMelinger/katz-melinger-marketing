# Autonomous Content Agent — Implementation Plan

**Goal:** An AI agent that runs on a schedule, generates content drafts on its own, and queues them for the firm to review and approve. Nothing publishes without a human clicking "approve."

**Status:** Planned (not started). Drafted 2026-06-13.

---

## 1. The idea in one sentence

A weekly (or daily) cron picks topics → writes briefs → generates drafts → saves them as `initial_review` → the firm sees "N drafts awaiting approval" and approves, edits, or rejects each one. This reuses the existing content-generation and approval pipeline; the new part is the **autonomous orchestration loop** and a **review surface**.

## 2. What already exists (reuse, don't rebuild)

| Piece | Where | Reuse for |
|---|---|---|
| Single-format generator | `app/api/content/draft/route.ts` | The actual draft writing (blog/social/email) + autosave + auto-analysis |
| Multi-format batch | `app/api/content/batches/route.ts` | If we want one topic → many formats |
| Topic / brief tools | `lib/agent-tools.ts` (`find_topic_ideas`, `find_trending_topics`, `generate_content_brief`, `generate_research_packet`) | The "what should we write about?" step |
| Approval pipeline | `content_drafts.status` (`initial_review → idea → brief → draft → review → published`), `supabase/content_drafts_status_pipeline.sql` | Drafts already land in `initial_review` — that IS the approval queue |
| Publishing QA gate | `app/content/publishing-qa/page.tsx` | Final pre-publish checklist |
| **Automation reference pattern** | `lib/aeo-runner.ts` + `app/api/aeo/runs/start/route.ts` + `vercel.json` | Copy this pattern exactly (see §3) |
| Cron auth | `isAuthorizedCron()` in `app/api/aeo/runs/start/route.ts` | `Authorization: Bearer ${CRON_SECRET}` |
| Multi-tenant fan-out | `listTenantIds()` + `resolveTenantId()` | Run per-firm in the cron |

**Key insight:** The content draft route already autosaves every generation as `initial_review` (the "not yet triaged by a human" state). So the approval queue is already a query: `content_drafts WHERE status = 'initial_review'`. We mostly need to (a) drive generation automatically and (b) build a nice review surface.

## 3. The automation pattern to copy

The AEO sweep is the blueprint. Mirror it one-to-one:

```
aeo_runs        →  content_runs        (run metadata: pending/running/done/failed, counts, triggered_by)
startRun()      →  startContentRun()   (insert run row, return id)
executeRun()    →  executeContentRun() (the actual work, fired via after())
GET cron route  →  GET cron route      (CRON_SECRET auth, loop tenants, after(executeContentRun(id)))
```

Why a `content_runs` table (not just firing generations): it gives an audit trail ("the agent created 6 drafts on Mon"), lets the UI show run status, and makes the job idempotent/safe to retry — exactly why AEO has `aeo_runs`.

## 4. Build steps

### Step 1 — Schema: `content_runs` + tagging generated drafts
- New table `content_runs`: `id, tenant_id, status (pending|running|done|failed), triggered_by (manual|cron), planned_count, created_count, failed_count, started_at, completed_at, error, created_at`.
- Tag agent-made drafts so we can filter them in the queue. Add to `content_drafts.metadata` a flag like `{ "source": "autonomous_agent", "run_id": "<uuid>" }` (no migration needed — `metadata` is jsonb). Optionally add a real `content_run_id` column + partial index if we want clean joins.
- Follow the DB-target header convention in `supabase/content_drafts_status_pipeline.sql` (live project `ijlesksgnfqqpxtaelqs`, trust `.env.local`).

### Step 2 — `lib/content-runner.ts` (the orchestrator)
Model on `lib/aeo-runner.ts`:
- `startContentRun(opts, tenantId)` — insert `content_runs` row in `pending`, return `id`.
- `executeContentRun(runId)`:
  1. Mark `running`.
  2. **Pick topics.** Call the existing topic logic (`find_topic_ideas` / `find_trending_topics` from `lib/agent-tools.ts`). Decide how many (e.g. 3–6 per run, configurable). De-dupe against recent drafts and run the existing **cannibalization check** (`generate_research_packet`) so we don't re-write something we already have.
  3. **For each topic:** optionally `generate_content_brief`, then generate the draft. Reuse the generation logic in `app/api/content/draft/route.ts` — ideally **extract its core into a shared `lib/content-generate.ts`** so both the HTTP route and the runner call the same function (avoids HTTP self-calls and duplicated prompt logic).
  4. Each draft autosaves as `initial_review` with `metadata.source = "autonomous_agent"` and `metadata.run_id`. The existing `scheduleDraftAnalysis()` then scores it automatically.
  5. Update `content_runs` counts → `done` (or `failed` with error, like AEO).
- Per-topic failures should be logged on the run, not abort the whole run (same resilience pattern AEO uses for providers).

### Step 3 — Cron route: `app/api/content/agent/run/route.ts`
- `GET` — Vercel cron entry. Copy `isAuthorizedCron()`, loop `listTenantIds()`, `after(executeContentRun(runId))` per tenant.
- `POST` — manual "Generate drafts now" trigger from the UI; returns `{ runId }` for polling. Accept optional overrides (topic count, formats, specific topics).
- `export const maxDuration = 300;` like the AEO route.

### Step 4 — `vercel.json` cron entry
Add one entry. Suggested cadence: weekly, offset from the existing jobs (those run at 08–12:00; the AEO sweep is Mon 12:00). Example — Monday 13:00 so it runs after the AEO sweep:
```json
{ "path": "/api/content/agent/run", "schedule": "0 13 * * 1" }
```
(Daily is also fine: `0 13 * * *`. Decide based on how much review volume the firm wants.)

### Step 5 — Review / approval surface
- A queue view of `content_drafts WHERE status = 'initial_review'` (optionally filtered to `metadata.source = 'autonomous_agent'`), showing title, format, practice area, and the auto-analysis scores (readability, AEO, brand-voice match) already computed.
- Per-draft actions: **Approve** (→ promotes status, auto-creates the `content_pipeline` row as the drafts API already does on status change), **Edit** (open in Content Studio / drafts editor), **Reject** (→ `archived`).
- A "**N drafts awaiting your approval**" badge/notification. Reuse the Marketing Alerts surface the AEO sweep already writes to, or add a count badge on the Content nav item.
- The drafts library (`app/content/drafts/page.tsx`) already lists drafts with a status dropdown — the queue can be a filtered view of it rather than a whole new page.

### Step 6 — Guardrails (important for "auto-generated, human-approved")
- **Volume cap** per run and per week so the firm isn't flooded.
- **No auto-publish, ever** — the agent's terminal state is `initial_review`. Publishing stays behind the Publishing QA gate + human click.
- **Cost control** — short-form on Haiku, long-form on Sonnet (already how `lib/anthropic.ts` splits). Cap topics/run.
- **Cannibalization / dedupe** before generating (Step 2.2) so we don't pay to rewrite existing pages.

## 5. Suggested build order (smallest shippable first)

1. Extract shared `lib/content-generate.ts` from the draft route (no behavior change — refactor + verify existing UI still works).
2. `content_runs` schema + `lib/content-runner.ts` that generates N drafts for the current tenant on demand.
3. `POST` manual trigger + a basic "Generate drafts now" button → confirm drafts appear in `initial_review`.
4. Review queue UI + approve/reject actions.
5. `GET` cron route + `vercel.json` entry → turn on the schedule.
6. Notification badge + volume guardrails.

Steps 1–3 are a usable MVP (manual "generate a batch for review"); 4–6 make it autonomous.

## 5b. Choose your scope — how much to build

Pick the tier that matches how much you want to invest now. Each tier is a complete, shippable stopping point — you can do Tier 1, use it, and come back for Tier 2 later. Build steps refer to §4.

### Tier 1 — Manual batch generator (smallest)
**What you get:** A "Generate a batch of drafts" button. Click it → the agent picks a few topics and writes drafts → they land in the existing `initial_review` queue for you to approve. No schedule; you run it when you want.
- **Build steps:** 1 (extract `lib/content-generate.ts`), 2 (`content_runs` + runner), 3 (manual `POST` trigger + button).
- **Review surface:** none new — uses the existing drafts library filtered to `initial_review`.
- **Effort:** ~1–1.5 days. **Risk:** low (mostly reuse + a refactor).
- **Best if:** you want to test draft quality before committing to automation.

### Tier 2 — Reviewable autonomous agent (recommended)
**What you get:** Everything in Tier 1, **plus** it runs on a schedule on its own, **plus** a dedicated review queue with Approve / Edit / Reject and a "N drafts awaiting approval" badge.
- **Build steps:** all of Tier 1 + 4 (review queue UI), 5 (cron route + `vercel.json`), 6 (notification badge + volume caps).
- **Effort:** ~3–4 days. **Risk:** low–medium.
- **Best if:** you want the firm to get a steady stream of drafts to approve with minimal effort. **This is the target the rest of the plan describes.**

### Tier 3 — Smart autonomous agent (most)
**What you get:** Everything in Tier 2, **plus** intelligence about *what* to write:
- Topics seeded from the Strategy Engine, keyword opportunities, and the content-decisions queue (not just AI guesses).
- Cannibalization + dedupe scoring baked into topic selection so it prioritizes real gaps.
- Multi-format output (one topic → blog + social + email via the batch route).
- Email notification to the firm when drafts are waiting (not just an in-app badge).
- A small "agent runs" dashboard (history, counts, what it chose and why).
- **Build steps:** all of Tier 2 + Step 2.2 expanded (rich topic sourcing), batch generation, email notify, runs dashboard.
- **Effort:** ~1.5–2 weeks. **Risk:** medium (more moving parts, more external data wired in).
- **Best if:** you want this to be a genuine "set it and forget it" content engine — and it doubles as a sellable feature for the productization goal.

> **Note on guardrails:** the "never auto-publish" rule and per-run volume caps (§6 guardrails) apply to **all three tiers** — the agent's terminal state is always `initial_review`, regardless of scope.

## 5c. Quality, safety & intelligence

Beyond generating and queuing drafts, an autonomous agent for a **law firm** needs the features below. Two of them (#1, #2) are **not optional** — they are Tier-1 requirements before the agent runs autonomously at all. The rest make it a strategist rather than a content firehose.

### Must-have — legal safety (REQUIRED in Tier 1, before any autonomous run)

1. **Attorney-advertising compliance gate.** Every draft passes an automated compliance check *before* it reaches a human, against lawyer-marketing rules (NY Rules of Professional Conduct / ABA Model Rules): no outcome guarantees, no "specialist/expert" claims, no misleading comparisons, testimonial/endorsement rules, and the **"Attorney Advertising"** label where required. Build on the existing `ANTI_AI_VOICE_RULES` and the disclaimer language already in the brand-voice profile; a failing draft is held/regenerated, never queued. *Rationale: autonomous generation without this is a liability.*

2. **Fact & citation verification.** Legal content cites statutes, **statutes of limitations / filing deadlines**, and case results — exactly what LLMs hallucinate. The agent must (a) never fabricate case results or guarantees, and (b) flag every cited statute/deadline/authority for human verification. Ground claims via the existing `generate_research_packet` (legal authority + cannibalization check) rather than free generation. *Rationale: a wrong deadline in published legal content is a real-world harm.*

### High-leverage — makes it smart, not just busy

3. **Performance feedback loop.** Feed results of *past* content back into topic selection using data already integrated — GA4 (traffic), Semrush (rankings), CallRail (calls/conversions). The agent doubles down on what actually drives results instead of guessing. *This is what makes the agent worth building.*

4. **Refresh existing content, not just net-new.** Detect decaying pages (rankings slipping, stale `last_modified` — already read via `lib/wordpress.ts` / site inventory) and propose *updates*. Refreshing a ranking page often beats a new one and costs less. The runner picks a mix of "new" and "refresh" work each run.

5. **Approval-feedback learning.** Capture human edits and rejection reasons; use approved drafts as few-shot examples and steer away from patterns that got rejected. The agent improves over time instead of repeating misses. (Stored on the draft/run rows; fed into the generation prompt.)

### Quality & control

6. **Quality auto-gate.** Use the auto-analysis scores already computed (readability, AEO score, brand-voice match via `lib/content-analysis.ts`) to auto-hold or regenerate weak drafts *before* a human sees them, so the review queue holds only strong candidates and doesn't waste the firm's time.

7. **Editorial balance.** Spread topics across practice areas and the existing pipeline buckets (money_page / bofu_education / mofu_trust / local_authority) instead of clustering, and weave in timely hooks (e.g. new NY employment laws taking effect).

8. **Autonomy levels + explainability.** Let the firm dial aggressiveness — *suggest-only → draft → draft + schedule* — and show the agent's reasoning for each topic pick (surfaced on the runs dashboard) so the firm trusts and can tune it.

### Worth including

9. **Bilingual output.** Reuse the existing Spanish/`languageDirective` support to produce EN/ES pairs — high-value for NYC employment clients.

10. **Auto hero image.** Image generation already exists and the analyzer already suggests images — attach a suggested hero image per draft.

**Where these land by tier:**
- **Tier 1:** #1 + #2 (legal safety) are mandatory; #6 (quality auto-gate) recommended so the first batches look good.
- **Tier 2:** #7 (editorial balance), #8 (autonomy levels + explainability).
- **Tier 3:** #3 (performance loop), #4 (content refresh), #5 (approval-feedback learning), #9 (bilingual), #10 (auto image).

## 6. Open questions for Kenneth

- **Cadence & volume:** how many drafts per run, how often? (e.g. 4 blogs/week, or a mix of formats?)
- **Topic source:** purely AI-suggested topics, or seeded from the Strategy Engine / keyword opportunities / content decisions queue?
- **Formats:** blogs only to start, or the multi-format batch (social + email too)?
- **Notification:** in-app badge enough, or also email the firm when new drafts are waiting?
- **Compliance scope (§5c #1):** which jurisdiction's advertising rules apply (NY only, or per-client state once productized)? Should compliance failures auto-regenerate or just flag for the reviewer?
- **Approval routing (§5c #1–2):** does anything legal-sensitive need an *attorney* reviewer distinct from a marketing reviewer, or is one approval queue enough?

---

*Reference patterns: `lib/aeo-runner.ts`, `app/api/aeo/runs/start/route.ts`, `app/api/content/draft/route.ts`, `vercel.json`, `supabase/content_drafts_status_pipeline.sql`.*
