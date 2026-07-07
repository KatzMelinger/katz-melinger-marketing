# Diana review (2026-06-22) — implementation plan

_Status: **plan only — no code written.** Produced after a full read-only audit of the
codebase. Sequencing/approvals still open (see §0)._

This covers everything in Diana's 2026-06-22 review:
1. Content Production draft flow (metadata-aware copy, auto attorney-advertising compliance,
   Next button, Approve → WordPress publish)
2. "Put Opportunities back in the Overview main tab" — **blocked on clarification**
3. Canonical Content Registry (duplicate-prevention intelligence layer, 5 tasks)
4. Social bugs: routing fix + composer/calendar (the Metricool replacement)

---

## 0. Decisions still open

- **Opportunities placement (#2).** Three candidate "Overview" surfaces; Diana to confirm what
  "as before" means. Options: (a) full interactive Opportunities list embedded on the home
  dashboard (today it's only a 5-row "Top Content Opportunities" summary at `app/page.tsx:132`),
  (b) the new Social Ops Hub "Overview" tab from her mockup, (c) restore on the production board.
  **Kenneth is checking with Diana.** Plan placeholder in §2.
- **WordPress target (#1).** Recommended: standard `/wp-json/wp/v2` + application password.
  Needs from site owner: site URL, an application password, and permission to add a small
  `mu-plugin`/`register_post_meta` snippet so Yoast/RankMath meta title+description are
  REST-writable. Until confirmed, the publish path is design-only.
- **Sequencing.** Kenneth chose "plan everything, build nothing yet." Recommended build order
  once approved: Quick wins → WordPress publish → Registry → Social composer/calendar.

---

## 1. Content Production: draft → metadata → compliance → Next → Approve → WordPress

### Current state (verified)
- **Copy button** (`components/draft-drawer.tsx:383`) copies only `draft.body` (raw markdown).
  No metadata, no disclaimer. This is the gap Diana hit.
- **Metadata already exists** per draft (`content_drafts.metadata.km_brief` + `seo_brief`,
  read at `draft-drawer.tsx:101`): primaryKeyword, secondaryKeywords[], metaTitle,
  metaDescription, urlSlug, pillarId, searchIntent, internalPillarLink, internalLinks[],
  cannibalizationConfirmed, contentType. Rendered in the drawer's SEO bar but never copied/exported.
- **Stage bar already exists**: Opportunity → Brief → Draft review → Approve → Publish to WordPress.
- **Attorney-advertising compliance already exists** (`lib/content-compliance.ts`,
  `checkContentCompliance()`; Peggy uses a hard `runComplianceGate`). In the manual flow it's
  **advisory only** — computed in analysis, not auto-applied or gated.
- **"Approve → Publish to WordPress"** (`draft-drawer.tsx:606`) is a **stub** — only flips
  `content_pipeline.status` to `published`. `lib/wordpress.ts` is read-only (no auth, GET only).

### What Diana wants
Copy that carries the metadata + auto-applied attorney-advertising compliance → a **Next** button
(bottom-right) that opens the full draft "with all things included" → **Approve** → a real
**WordPress publish**.

### Plan
1. **Metadata-aware copy / "Copy Word-ready".** New serializer that emits body + a metadata block
   (meta title, description, slug, primary/secondary keywords) + the required attorney-advertising
   disclaimer. Add alongside the existing Copy button in the drawer toolbar (`draft-drawer.tsx:454`).
   Reuse `lib/content-export-docx.ts` for the Word-ready variant.
2. **Auto attorney-advertising compliance.** Wire `checkContentCompliance()` to run automatically
   when a draft is opened/saved; auto-insert required disclaimers into the copy/export output and
   show status inline. Gate is decided in step 4.
3. **"Next" button (bottom-right of draft).** Carries body + metadata + applied compliance into the
   full Approve view. Mostly a labeled transition over the existing stage flow (`brief`/`draft` →
   `review`).
4. **"Approve" → connects to publish.** Keep the existing manual gate (legal review + proofread),
   add a hard block if `compliance_status === "non_compliant"`. On approve, status → ready-to-publish.
5. **WordPress publish (new).** New authenticated write client (`lib/wp-publish.ts`) + endpoint
   `POST /api/wp/publish`. Maps title→title, markdown body→HTML content, urlSlug→slug, status→
   publish/draft, metaTitle/metaDescription→Yoast/RankMath (via the registered meta keys). On
   success, write the live URL back to `content_pipeline.url` and flip status to `published`.

### Effort
Steps 1–4 small (assembly of existing pieces). Step 5 is the only genuinely new build
(auth + write client + meta mapping + error handling). **Blocked on WP creds/permission (§0).**

---

## 2. Opportunities back in the Overview — BLOCKED

Pending Diana's clarification (§0). Building blocks identified:
- Full Opportunities feature: `app/seo/opportunities/page.tsx` (rows at :332, status badges at :728).
- Home summary today: `app/page.tsx:132` "Top Content Opportunities" (5 rows → links to
  `/seo/opportunities`).
- Status-badge component already supports new/brief/in_production/published/dismissed.

Once Diana confirms, this is a small embed/move — no new data layer needed.

---

## 3. Canonical Content Registry (5 tasks)

~70% of building blocks already exist. The registry is a layer over `content_pipeline`.

### Existing reusable pieces
- **`content_pipeline`** (`supabase/content_pipeline_schema.sql`) — single source of truth:
  id, title, keywords, location, status(idea/brief/draft/review/published), bucket, url,
  draft_id, timestamps. Tenant-scoped via RLS.
- **Semantic matching, already half-built:**
  - `filterTitlesByCannibalization()` — Jaccard similarity ≥0.7 (`lib/title-cannibalization.ts`).
  - `detectContentOverlap()` — normalized term→page matching (`lib/content-overlap.ts`).
  - `classifyKeywordCluster()` — 13 KM practice clusters, rule-based (`lib/keyword-cluster.ts`).
  - AI clustering available via the brief wizard's Sonnet calls if we want fuzzier matching.
- **Three entry points identified:**
  - Create Brief → `km-brief-wizard.tsx` → `POST /api/content/km-draft`.
  - Content Studio Generate → `POST /api/content/draft`.
  - Peggy → `lib/agent/content-agent.ts` (calls km-draft internally).
- **Overview "Issues to fix"** (`lib/dashboard-snapshots.ts:175`) is hardcoded placeholders —
  ready to receive a real "N duplicate drafts detected" alert.
- **Opportunity refresh** lives in `lib/opportunity-pipeline.ts` (`runOpportunityPipeline`);
  `existing_url` already routes covered keywords to Optimize/Repurpose — suppression hooks here.

### Plan (Diana's 5 tasks)
1. **`content_registry` table** (`supabase/content_registry_schema.sql`, follow existing
   idempotent + RLS convention): primary_keyword, secondary_keywords[], cluster_key, status,
   source(Opportunities/Content Studio/Peggy), url, pipeline_card_id, created/updated. Kept in
   sync by a trigger/sync fn reading `content_pipeline` (no separate data store).
2. **Semantic match function** (`lib/content-registry.ts`) — wrap existing Jaccard + cluster
   classifier; configurable threshold; optional AI-assisted tiebreak via the brief-wizard model.
3. **Pre-creation duplicate check** — single `checkRegistryConflict(keywords)` called by all three
   entry points before they create. On match → block + return conflict (what/status/link).
4. **Auto Opportunity suppression** — on each Opportunities refresh, match each keyword against the
   registry; any match at Draft/Approve/Published → move to "Already Covered", drop from Actionable.
5. **Frontend (3 small bits):** duplicate warning modal ("View existing" / "Create anyway" with
   cannibalization note); status badge ("Draft exists" blue / "Published" green) on Opportunity rows
   (`app/seo/opportunities/page.tsx:397`); Overview "Issues to fix" alert → filtered Production Board.

### Effort
Medium. Matching + suppression reuse existing code; new table + the unified check wired into 3
endpoints + 3 UI additions are the real work.

---

## 4. Social: routing bug + composer/calendar (Metricool replacement)

### Issue 1 — routing (CONFIRMED, 1-line fix)
`app/social/page.tsx:197` links to `/content` with no `?type=` → defaults to the **Website** tab
(`lib/content-types.ts:16`). Fix: `/content?type=social`.

### Issue 2 — Generate dead-end + missing composer/calendar (LARGE)
Preview pane (`app/content/page.tsx:641`) offers only "Copy Word-ready" / "Copy markdown" — no edit,
no platform preview, no schedule. The composer-with-live-preview, platform selectors, Schedule→
Calendar, and the weekly Content Calendar **do not exist yet**. This is **Phase 1–2 of the existing
`docs/social-hub-plan.md`** (Calendar + Composer). Backend to hang it on already exists:
`lib/ayrshare.ts` (publish), `social_posts` table, `/api/social/ayrshare/publish`.

### Plan (aligns with social-hub-plan phases)
- **Now (quick win):** fix Issue 1 routing.
- **Phase 1 — Content Calendar:** weekly time-slot grid reading `social_posts` across channels;
  click a slot to create/edit. Finish Ayrshare client gaps (history/status) for status sync.
- **Phase 2 — Composer modal:** generated copy preloaded + editable, live per-platform preview
  (Instagram/LinkedIn/TikTok), platform selectors, date/time, Schedule → writes `social_posts` and
  schedules via Ayrshare. Replace the Content Studio Preview dead-end with "Open in composer".
- Later: best-time intelligence + KPI dashboard repoint (Phases 3–4 of social-hub-plan).

### Effort
Issue 1 trivial. Composer + calendar are multi-day (the bulk of the social-hub-plan build).

---

## Recommended build order (once approved)
1. **Quick wins:** Issue 1 routing fix + metadata-aware copy + auto-compliance on drafts.
2. **WordPress publish** (after creds/permission confirmed).
3. **Canonical Content Registry** (touches the most entry points; prevents wasted drafts).
4. **Social composer + calendar** (largest; the Metricool replacement).
5. **Opportunities placement** — slot in as soon as Diana clarifies (small).
