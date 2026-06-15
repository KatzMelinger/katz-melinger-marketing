# Content Production Reorg — Review & Strategy

**Date:** 2026-06-13
**Author:** Ken + Claude (review session)
**Source spec:** `KM_Kenneth_ContentProduction_Final_June13_2026.docx` (Diana) + 3 mockups (Content Production board, Repurpose tab, Social scheduler)
**Status:** Analysis only — no code changed. Resume work tomorrow.

This document consolidates the full review of Diana's Content Production reorg spec against the
actual codebase, the data-model decision (A/B/C), the marketing-priority reordering, and the
SaaS-product angle. It is meant to be the single pickup point for tomorrow.

---

## 0. TL;DR

- Diana's plan is a **reorg, not a rebuild** — almost everything she needs already exists. Good instinct.
- The doc has **4 factual errors** about the current system and **1 architectural assumption that isn't true** (`content_items` doesn't exist).
- Data model: recommend **Option C (spine + satellites)** — cheapest path that satisfies all constraints. NOT Option A (full rebuild) pre-revenue.
- Marketing lens: the real bottleneck is **publishing + refresh**, not the board. Reorder accordingly.
- SaaS lens: Diana's doc is the *internal-tool* roadmap. The *product* roadmap is **onboarding → per-tenant credentials → usage metering → demo-able rank-and-publish loop**, sold on legal-vertical depth + compliance.

---

## 1. Current state vs. what the spec assumes

All 10 "existing features" Diana lists are real and live:

| Feature | Lives at |
|---|---|
| Content Decisions | `app/content/decisions/page.tsx` |
| Briefs + 5-step wizard | `app/content/briefs/page.tsx` + `components/km-brief-wizard.tsx` |
| Production Board (kanban) | `app/content/pipeline/page.tsx` |
| Publishing QA | `app/content/publishing-qa/page.tsx` |
| Drafts (artifact store) | `app/content/drafts/page.tsx` |
| Opportunities radar | `app/seo/opportunities/page.tsx` |
| KM Generator | `app/content/km/page.tsx` + `km-brief-wizard.tsx` |
| Cluster Map | `app/content/site-map/page.tsx` |
| Cannibalization / Internal links | `app/seo/cannibalization/page.tsx`, `app/seo/internal-links/page.tsx` |

Left nav is centralized in `lib/departments.ts`, rendered by `components/marketing-sidebar.tsx`.

### The assumption that isn't true: `content_items`

Diana's mental model = "one record per keyword in `content_items` with a status field."
**That table does not exist.** Content lives across four tables, each owning a stage:

| Stage | Actual table | Identity / dedup |
|---|---|---|
| Opportunity | `seo_opportunities` | `keyword` — **DB UNIQUE** ✅; also has `brief_id`, `draft_id` FKs |
| Brief | `brief_suggestions` | `primary_keyword` (indexed); app-level pre-insert dedup; `approved_draft_id` |
| Draft | `content_drafts` | **no keyword uniqueness**; shared store (`format`: blog/linkedin/twitter/facebook/instagram/email/podcast) |
| Pipeline status | `content_pipeline` | free-text `keywords`; `draft_id` FK; has `bucket` (Money Page/BOFU/MOFU/Local) |

> **Consequence:** Diana's Part 9 dedup SQL (`DELETE FROM content_items …`, `ALTER TABLE content_items ADD CONSTRAINT unique_keyword`) **will error** — the table isn't there.

---

## 2. Four factual corrections to Diana's doc

1. **The social scheduler is already built.** `lib/ayrshare.ts` + `app/api/social/ayrshare/publish/route.ts` already publish to Facebook/Instagram/LinkedIn/GMB with scheduling + media + a `social_posts` tracking table. Part 7's "confirm which tool, give me the API key" is largely moot. Step 8 = wire the *Generate 3 posts* button to the existing Ayrshare path + Mon/Wed/Fri scheduling. (Matches the approved Metricool→Ayrshare vendor migration.)

2. **WordPress credentials premise is wrong.** `lib/wordpress.ts` reads the **public, unauthenticated** `/wp-json/wp/v2/pages`. Publishing (`POST /wp/v2/posts`) **requires auth** (Application Password / OAuth). "Use the same credentials from the sitemap check" — there are none. **Prerequisite: create a WordPress Application Password.** Part 5 is genuinely missing AND blocked until that exists.

3. **Unemployment filter already exists but is too narrow.** `lib/keyword-filter.ts` has `unemployment.*\b(login|portal|claim|benefits?|weekly)`. "1099 Nys Unemployment" has no trailing qualifier → **slips through** (that's why it reached Draft). Fix = *broaden* the existing pattern (bare `nys unemployment`, `unemployment benefits`), not add a new one. Dedup infra Diana asks for in Part 9 mostly exists already (`seo_opportunities.keyword` UNIQUE; app-level guard in `app/api/seo/suggestions/route.ts`; `scripts/dedupe-content.ts`).

4. **"All harassment → Hostile Work Environment" will mis-route.** Taxonomy has a **separate Sexual Harassment pillar** (`lib/strategy-engine.ts:120`), where `sexual harassment` / `quid pro quo` are *correctly* mapped. A blanket rule would yank those into the wrong pillar. Correct fix: route `job harassment` / `workplace harassment` / generic `harassment` / `bullying` → Hostile; **leave** `sexual harassment` / `quid pro quo` on Sexual Harassment. Confirm nuance with Diana.

### Data-source reality checks

- **"DataForSEO Rank Tracker, daily"** — no product by that name; capability exists via DataForSEO Labs `ranked_keywords` (daily 11am cron) + `previous_rank` column. "Dropped >5 positions" works as a **two-snapshot delta**, NOT a multi-day trend line.
- **"Competitor moving above us"** (Optimize) — partially covered by cannibalization snapshots + Semrush gaps; not first-class yet. New work.
- **"Not updated in 6+ months"** (Repurpose) — already computable; WP reader pulls last-modified dates today.
- **Production Board == `/content/pipeline`** — Diana lists "remove Production Board" AND "remove Pipeline tab"; same screen. Don't double-count.
- **"Drafts" is the artifact store**, not just a screen — batch/social/email write to `content_drafts`. Keep the store even if you remove the view, or you orphan non-SEO output.

---

## 3. The data-model decision: A vs B vs C

### What we're really deciding
Where the **canonical identity + status** of a content item lives as it moves opportunity → brief → draft → approve → published. Today that's spread across 4 tables with **4 different status vocabularies**.

### Three constraints that decide it
1. **No language dimension exists.** Diana wants Spanish pages. Literal `UNIQUE(primary_keyword)` would **block EN+ES**. Real key = `UNIQUE(keyword, language)`.
2. **`content_drafts` is a shared general store** (social/email/batch). Anything that folds it into a keyword-unique table **orphans non-SEO artifacts**. It must survive as-is.
3. **Two parallel status machines, no single source of truth** (`content_pipeline.status` vs `seo_opportunities.status` vs `content_drafts.status` vs `brief_suggestions.status`). Unification's real job is collapsing these into one.

### Options

**A — Full unify (one wide `content_items`).** Matches Diana literally. But it's the real *rebuild* hidden in a "no rebuild" doc; constraint 2 means it doesn't even fully unify (two draft stores remain). Highest blast radius. ❌ pre-revenue.

**B — Pure adapter (keep 4 tables, board = read-only view).** Zero migration. But items with no opportunity row are **invisible**; status is faked at read time from disagreeing columns; DB-level dedup not truly satisfied. Cheapest, but fragile + incomplete.

**C — Spine + satellites (RECOMMENDED).** Thin `content_items` spine owns identity + status + FKs; existing tables stay as satellites holding heavy/shared data. Essentially **formalizes what `seo_opportunities` already half-does** (it already has `brief_id`, `draft_id`, status, UNIQUE keyword).

### Decision matrix

| | A — Full unify | B — Pure adapter | **C — Spine + satellites** |
|---|---|---|---|
| Matches "one record, one status" | ✅ literal | ⚠️ faked | ✅ real |
| DB keyword uniqueness | ✅ (wrong: EN/ES collision) | ❌ per-table | ✅ `UNIQUE(keyword, language)` |
| Non-SEO drafts keep working | ⚠️ two stores | ✅ | ✅ |
| Single source of truth for status | ✅ | ❌ ambiguous | ✅ |
| Items with no opportunity row | ✅ | ❌ invisible | ✅ |
| Migration risk | 🔴 high | 🟢 none | 🟡 moderate |
| Net new code | rewrite all | view + 2nd path | spine + 1 upsert per writer |

**Recommendation: C.** Only option satisfying all 3 constraints; far cheaper than A because `seo_opportunities` is already a proto-spine.

---

## 4. Open decision — unit of work (BLOCKS C)

**Is one row a keyword or a page?**

- **Keyword-as-unit** (what `seo_opportunities` + Diana's SQL assume): Spanish version becomes an unrelated row or *collides*; "update & expand" collides with the original; case-result loses provenance.
- **Page-as-unit (RECOMMENDED):** one row per page (existing or planned), surrogate `id` identity. Keyword + URL are *contextual anchors*:
  - Planned (New Content): anchored by `keyword` + `language`; `url` null until published.
  - Existing (Optimize/Repurpose): anchored by `url`; keyword optional.
  - Uniqueness enforced contextually: `UNIQUE(keyword, language)` among planned, `UNIQUE(url)` among published.

Why page wins: **2 of 3 tabs are page-centric** (Optimize + Repurpose start from a WordPress URL that may have no opportunity row). Page-as-unit also makes Spanish/refresh/case-result natural via `translation_of` / `derived_from` self-links. It's the *correct* version of Diana's dedup intent — stops duplicate pages on a URL (which her `UNIQUE(primary_keyword)` does NOT) without blocking Spanish.

**→ Need Diana's answer: page (recommended) vs keyword.**

---

## 5. Option C — deep dive

### Spine table (sketch)

```sql
content_items (
  id              uuid PK,              -- surrogate identity (the "unit")
  tenant_id       uuid,                 -- RLS

  -- identity / anchors
  asset_type      text,                 -- practice_page | blog | case_result
  keyword         text,                 -- anchor for planned items (nullable)
  language        text default 'en',    -- 'en' | 'es'   ← the missing dimension
  url             text,                 -- anchor for existing items; live URL once published

  -- the ONE status machine
  status          text,                 -- opportunity | brief | draft | approve | published
  bucket          text,                 -- Money Page | BOFU | MOFU | Local (from pipeline)

  -- cheap facets
  pillar_id       text,
  practice_area   text,

  -- relationships (self-referential)
  translation_of  uuid → content_items, -- ES variant → EN source
  derived_from    uuid → content_items, -- case-result → source blog

  -- satellite FKs (data stays in satellites)
  opportunity_id  uuid → seo_opportunities,
  brief_id        uuid → brief_suggestions,
  draft_id        uuid → content_drafts,

  -- publish leg (new)
  wp_post_id      bigint,
  published_at    timestamptz,

  created_at, updated_at
)
-- UNIQUE(keyword, language) WHERE url IS NULL
-- UNIQUE(url)               WHERE url IS NOT NULL
```

Principle: **spine holds identity, status, pointers — nothing heavy.** Brief JSON stays in `brief_suggestions`; body text stays in `content_drafts` (social/email/batch untouched); scoring stays in `seo_opportunities`.

### Field → source mapping

| Spine column | Source today |
|---|---|
| `keyword` | `seo_opportunities.keyword` / `brief_suggestions.primary_keyword` |
| `language` | **new** — default `'en'`; `'es'` on Create-Spanish-version |
| `url` | `seo_opportunities.existing_url`; later the WP live URL |
| `asset_type` | `brief_suggestions.content_type` / opportunity classification |
| `status` | **derived** (table below) |
| `bucket` | `content_pipeline.bucket` |
| `pillar_id`, `practice_area` | `seo_opportunities` / `brief_suggestions` (already populated) |
| `opportunity_id` | `seo_opportunities.id` |
| `brief_id` | `seo_opportunities.brief_id` (already linked) / `brief_suggestions.id` |
| `draft_id` | `seo_opportunities.draft_id` / `brief_suggestions.approved_draft_id` / `content_pipeline.draft_id` |
| `wp_post_id`, `published_at` | **new** — written by Publish-to-WordPress button |
| `translation_of`, `derived_from` | **new** — set by Repurpose actions |

> Key point: **most pointers already exist.** Migration is mostly *reading links already there*, not reconstructing them.

### Status collapse (4 vocabularies → 1)

| Spine `status` | Condition |
|---|---|
| `opportunity` | has `opportunity_id`, `brief_id` null |
| `brief` | `brief_id` set, `draft_id` null (regardless of brief_suggestions.status) |
| `draft` | `draft_id` set AND `content_drafts.status='draft'` AND not pipeline `review` |
| `approve` | `content_pipeline.status='review'` OR `content_drafts.status='approved'` |
| `published` | `wp_post_id` set OR `content_drafts.status='published'` OR `content_pipeline.status='published'` |

After migration the spine `status` is the single source of truth; `content_pipeline.status` retires or becomes a read-only mirror.

### Migration steps
1. Create `content_items` + the two partial unique indexes.
2. Seed one spine row per `seo_opportunities` row (copy keyword, existing_url→url, pillar/practice_area, existing `brief_id`/`draft_id`).
3. Backfill orphans: spine rows for briefs/drafts with no opportunity (manual briefs, batch SEO drafts).
4. Pull `bucket` from `content_pipeline` via `draft_id`.
5. Derive `status` once.
6. `wp_post_id`/`published_at` = null (publish leg is new).
7. **Leave all 4 satellites in place.** Nothing dropped day one.

### How tabs read the spine
- **New content:** all statuses WHERE `url IS NULL`. Columns = `GROUP BY status`.
- **Optimize:** `url IS NOT NULL` + position delta (current vs `previous_rank`) where drop > 5.
- **Repurpose:** `url IS NOT NULL` + (stale > 6mo) OR (Spanish gap: an `es` keyword with no `language='es'` row linked here).
- Repurpose actions = spine writes: *Update* → status back to `brief`; *Spanish* → new `language='es'` row + `translation_of`; *Case result* → new row + `derived_from`, `asset_type='case_result'`.

### Cost of C
- 1 new table + 2 partial unique indexes.
- 1 upsert line added to ~4 writers (sync cron, brief wizard, draft generator, publish button).
- Readers migrate lazily; board reads spine immediately; legacy screens read satellites until retired.
- **No body text moves; no non-SEO draft touched.**

### Second open question
**Does `content_pipeline` retire or stay?** It's the only table with bucket/content-mix balancing. Recommend **keep as a satellite** — content-mix discipline is a marketing control surface (see §6).

---

## 6. Marketing-lens reprioritization

**Core point:** A/B/C is internal efficiency. The firm's growth constraint is that **finished content can't publish** and **decaying pages go unwatched** — not how content is stored.

Three realities:
1. **Bottleneck is shipping, not producing.** 290 opportunities + drafts library + NO publish button = inventory on a loading dock. Publish-to-WordPress is the highest-leverage item in the doc. Pull it forward.
2. **Refresh beats net-new on an authoritative domain.** The mockup's harassment page dropped #4→#9 (page-two cliff). Recovering it beats launching from zero. Optimize + Repurpose-update should rank *above* building the perfect board.
3. **Relevance + compliance protect the asset.** "1099 unemployment" and pillar mis-mapping are brand/authority/compliance risks (attorney advertising). Fixing filters first protects the machine's output. (Firm-wide compliance gate already built.)

### Recommended priority (vs Diana's logical order)
| Priority | Why (marketing) |
|---|---|
| 1. Fix relevance + pillar bugs | Protects topical authority & compliance. Cheap. |
| 2. Ship Publish-to-WordPress | Unblocks the entire funnel. Highest ROI. |
| 3. Optimize + Repurpose-update | Recover decaying high-value pages — fastest traffic wins. |
| 4. Board reorg (cheapest model) | Efficiency for Diana, not growth. Don't gold-plate. |
| 5. Social automation (GMB first) | Already built. GMB = local intent (real lead value); FB/IG/LI = awareness. |

Keep `content_pipeline` bucketing: with 290 opportunities, the real risk is spray-and-pray. "Ship 3 money pages + 2 trust pieces" discipline produces leads; "cleared 40 cards" doesn't.

---

## 7. SaaS-product lens

Diana's doc is the **internal-tool** roadmap. The **product** roadmap is different. You're already building multi-tenant (RLS done; usage meter built; compliance gate; autonomous agent) — so the question is what gates the *first external sale*.

### Real blockers (none in Diana's 9 steps)
1. **Tenant onboarding flow** (Phase 4 todo, unfinished) — the literal gate on selling. Can't put firm #2 on without repeatable provisioning.
2. **Per-tenant credentials & API keys** — WP/DataForSEO/Semrush/Ayrshare all assume KM's keys. Need a per-tenant credential vault. Bigger than Diana scoped; it's the tool→product line.
3. **Metering on every paid API = COGS control** — DataForSEO/Semrush/Claude are per-call cost. Without per-tenant metering, one heavy customer kills margin. Extend the existing competitor-intel meter to ALL paid calls **before** selling. Most important pre-revenue eng item; not in the doc.
4. **Billing** — plans/quotas/overage; maps to metering.

### Moat = vertical depth, not the board
Lean into the legal-specific opinionation no horizontal tool copies easily:
- employment-law pillar taxonomy + practice-area classification
- **attorney-advertising compliance gate** (sell on *risk reduction* — partner-level, budget-unlocking)
- per-firm brand voice
- autonomous research→draft→compliance→approve agent

**Do NOT build generic SEO features** that fight Semrush head-on. Pillars are already DB-driven + `tenant_settings` exists — keep generalizing away from KM hardcoding.

### Architecture for SaaS
Still **C**, with more discipline. Classic vertical-SaaS mistake = building Option A before customer #2 pays. One validated user (KM design partner). Don't over-fit Diana's exact 5-stage flow — make stages + buckets configurable per tenant.

### Build-first for SaaS
1. Tenant onboarding + per-tenant credential vault.
2. Metering on all paid APIs.
3. End-to-end "it ranks" loop for one tenant: opportunity → brief → draft → **publish** → tracked → leads (demo-able outcome).
4. Compliance gate front-and-center in the pitch.
Then sell to one more firm before Optimize/Repurpose/social (upsell tiers).

### Packaging (quick take)
- **Core:** board + publish + compliance gate.
- **Growth:** Optimize/Repurpose + social (GMB-led).
- **Premium:** autonomous agent.
- **Pricing:** seat + metered usage. BYO-API-key as cheaper tier (lowers COGS + raises switching cost).

### Per-tenant workflow + bucket configurability (don't hardcode KM's process)

Diana's "delete these 5 screens, this exact 5-stage flow" is *KM's* process. If the board hardcodes it,
customer #2 (who works differently) won't fit. Design for configurability — but scoped, not a no-code builder.

**Principle: configurable *labels/order*, fixed *capability vocabulary*.** Stages can't be free-form text
because each stage triggers behavior (Opportunity→brief wizard; Brief→KM Generator; Draft→review page;
Approve→Publish button; Published→tracking). So:

> Each stage = tenant-chosen `label` + `order` + a `kind` from a **fixed enum of capabilities**.
> Tenants rename/reorder/add/drop stages; the engine keys off `kind`.

E.g. firm #2 can run *"Intake → Outline → Write → Partner Review → Live"* and the system still knows
"Partner Review" is `kind: approve` and draws the publish button there. Flexible presentation, unambiguous logic.

**Buckets are easier — fully free-form.** Content-mix buckets (Money Page/BOFU/MOFU/Local) carry no
behavior (pure classification/reporting), so they're just a per-tenant list of names + optional target %.
Nothing branches on them.

**Where it lives** — follow the existing pillars pattern (`tenant_settings` jsonb, per `pillars_seed.sql`):
```
tenant_settings.workflow_stages  jsonb   -- [{id, label, kind, order}]
tenant_settings.content_buckets  jsonb   -- [{id, label, target_pct?}]
```
Not a new mechanism — two more keys on the config object that already drives pillars.

**Impact on the Option C spine** (the one place this touches §5):
- `status` (hardcoded enum) → split into **`stage_kind`** (fixed capability, what code branches on) +
  **`stage_id`** (FK to the tenant's stage list, for display/order).
- `bucket` (free text) → references the tenant's `content_buckets`.
- The §5 status-collapse migration is unchanged — map legacy statuses to `stage_kind`, attach `stage_id` on top.
  Logic uses `stage_kind`; the board renders `stage_id`'s label/order.

**Trap to avoid (1–2 customer SaaS):** do NOT build a no-code workflow builder yet. Right scope:
1. Ship **KM's 5-stage flow + buckets as the default template**, seeded into every new tenant → works out of the box, zero config.
2. Make it **data, not code** (the jsonb above) so it's overridable when a real customer needs it.
3. A tiny settings editor (rename/reorder/toggle a stage) comes later, only when customer #2 actually needs a different flow.

Goal: by the time customer #2 says "we don't do a Brief stage," it's a config row, not a code change.

---

## 8. Open questions / decisions needed (for tomorrow)

1. **Goal:** internal tool for KM, or SaaS product? (Changes everything below.)
2. **Unit of work:** page (recommended) vs keyword? — *blocks Option C schema.*
3. **`content_pipeline`:** retire vs keep as satellite? (Recommend keep for buckets.)
4. **WordPress:** who creates the Application Password? (blocks publish button)
5. **Harassment pillar rule:** confirm narrow version (spare Sexual Harassment pillar).
6. **If SaaS:** prioritize onboarding + credential vault + metering ahead of Diana's steps?

## 9. Suggested next steps

- [ ] Get Diana's answer on unit-of-work + `content_pipeline` fate.
- [ ] Decide internal-tool vs SaaS (sets the whole priority order).
- [ ] Quick wins regardless of path: broaden unemployment filter; narrow harassment→Hostile rule; delete "1099 Nys Unemployment"; run `scripts/dedupe-content.ts`.
- [ ] Create WordPress Application Password (unblocks publish).
- [ ] If internal: build order = bugs → publish → optimize/repurpose → board (C-lite) → social.
- [ ] If SaaS: build order = onboarding → credential vault → metering → rank-and-publish loop → board (C).
- [ ] Spin out separate SaaS product doc if going that route (onboarding/credential/metering architecture + pricing).
