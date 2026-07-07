# 1.5 — Six-stage Redraft flow (scope)

## The spec (v2, lives inside Optimize)
Clicking **Redraft** on an existing page should run six stages:
1. **Content Type Detection** — detect the page's structure/type automatically.
2. **Gap Audit** — find what's missing vs best practice, add it *without rewriting what works*.
3. **Draft Generation** — produce the improved draft + fill SEO metadata.
4. **Draft Review** — land on a preview/review step.
5. **WordPress Push** — approve straight to a WordPress update at the **same URL**.
6. **Google Doc Copy** — copy the result for Google Docs.

## What exists today (grounded in code)
- **Redraft button** — `app/content-production/page.tsx` `redraft()` → POST
  `/api/content-production/update-draft`.
- **update-draft route** — fetch live page (`fetchPageText`) → AI **full rewrite** in brand voice,
  works in missing keywords + approved internal links → save `content_drafts` → `content_pipeline`
  row at "draft" → opens the review drawer. Covers a *simplified* stages 3–4.
- **Draft Review (stage 4)** — `components/draft-drawer.tsx`: QA checklist hard gate, Approve,
  Publish, and a **Copy** action (stage 6) already exist.
- **WordPress publish** — `lib/wp-content-publish.ts` + `public/wp-plugin/km-autopilot.php`: queues
  `approved` drafts (`metadata.wp_publish.queued`), plugin **creates a NEW post** (`wp_insert_post`).
  There is **no update-existing-post-by-URL** path — that's stage 5's gap.

## Gaps vs the spec
| Stage | Status | Work |
|---|---|---|
| 1 Content Type Detection | ❌ missing | detect blog_post / practice_page / case_result / faq from the live page |
| 2 Gap Audit | ❌ missing (today = blind full rewrite) | identify missing sections/entities/keywords; additive not rewrite |
| 3 Draft Generation + metadata | ⚠️ partial | generates body; does NOT fill meta title/desc/slug → **reuse `autoSeoMetadata`** |
| 4 Draft Review | ✅ exists | review drawer + QA gate |
| 5 WordPress Push (same URL) | ❌ missing | plugin can only create; needs update-existing-by-URL (**touches live site**) |
| 6 Google Doc Copy | ✅ exists | Copy action in the drawer |

## Plan (phased; each phase shippable)
**Phase 1 — Detect → Audit → Generate (no live-site risk).**
- NEW `lib/redraft-analyze.ts`:
  - `detectContentType(pageText, url)` — deterministic first (heading patterns, FAQ presence,
    "case"/result cues, length), Claude fallback for ambiguous. Returns a `KMContentType`.
  - `auditGaps(pageText, contentType, keywords)` — returns a structured gap list (missing sections
    for that type, missing target keywords/entities, no-FAQ, thin sections). Deterministic checklist
    per content type + the keyword gaps already passed in.
- REWORK `update-draft/route.ts` generation prompt: from "rewrite everything" to **additive** —
  "preserve accurate on-topic content; ADD the audited gaps; only lightly touch voice." Feed it the
  detected type + gap list. Fill metadata via `autoSeoMetadata` and persist to `seo_brief`
  (meta title/desc/slug/pillar) so stage 5 and the drawer have them.
- Surface the detection + gap list in the review drawer (so Diana sees *what* it changed and why).

**Phase 2 — Same-URL WordPress update (touches live site + plugin).**
- Plugin: add an "update existing post" mode — resolve the source URL/slug → WP post ID, then
  `wp_update_post` instead of `wp_insert_post`. Carry `target_url` / `wp_post_id` through the queue
  (`wp-content-publish.ts` `WpContentItem`).
- App: mark a redraft as an *update-in-place* (its `metadata.wp_publish.update_url = <source url>`),
  so approve → the plugin updates that post at the same URL. **Default to WP draft status first**
  (per prior decision) so nothing goes live unreviewed.
- Requires a plugin rebuild + reinstall on katzmelinger.com (fresh-named zip; see
  `scripts/build-wp-plugin-zip.ps1`).

**Phase 3 — polish.** Wire the stages as a visible progression in the drawer (Detect ✓ · Gaps ✓ ·
Generated ✓ · Review · Push · Copy), and confirm the Google Doc Copy carries the final body + metadata.

## Open decisions (need Kenneth)
1. **Gap Audit basis** — (a) content-type template checklist + keyword/entity gaps (deterministic,
   no extra API — recommended) · (b) also fetch live competitor/SERP pages to compare (heavier,
   later) · (c) let Claude free-form "what's missing".
2. **Redraft behavior** — additive/surgical (preserve what works, add gaps — matches spec) vs keep
   today's clean full-rewrite. Confirm we want the behavior change.
3. **WordPress same-URL update** — (a) do it now in Phase 2 (plugin change + live-site redeploy;
   default to WP draft status) · (b) defer — ship Phases 1 + metadata + Google Doc copy first, leave
   WP push as-is (create/manual) until you're ready to touch the plugin. Recommended: **(b)** —
   Phase 1 has no live-site risk and delivers the detect/audit/metadata value immediately.
4. **Content Type Detection** — deterministic-first with Claude fallback (recommended) vs Claude
   classification every time.

## Effort
Phase 1 ≈ 3–4 days. Phase 2 (WP plugin + same-URL) ≈ 1 week incl. redeploy/testing. Phase 3 ≈ 1–2 days.

## Decisions (locked 2026-07-07)
Additive/surgical redraft · gap audit = template checklist + keyword gaps (deterministic) · WP
same-URL update DEFERRED to Phase 2 · content-type detection deterministic-first + Claude fallback.

## Status — Phase 1 BUILT (uncommitted, 2026-07-07)
- NEW `lib/redraft-analyze.ts` — `detectContentType(outline,url)` (rule scores from URL/headings/
  text; Claude fallback only when not confident) + `auditGaps(outline,detected,keywords)` (per-type
  section checklist + keyword gaps + thin-content notes) + `gapReportPromptBlock()`.
- `lib/page-optimizer.ts` — refactored fetch into a shared helper; added `fetchPageOutline()`
  (text + heading outline) so the audit can see structure. `fetchPageText` behavior unchanged.
- `app/api/content-production/update-draft/route.ts` — now fetches the outline, runs detect + audit,
  switched the prompt from full-rewrite to **additive** (preserve what works, ADD the gaps), fills
  metadata via `autoSeoMetadata` (meta title/desc/slug/pillar — was empty before), stores
  `metadata.redraft_analysis`, and returns it.
- `components/draft-drawer.tsx` — "Redraft summary" panel (detected type + gaps filled + keywords
  added) shown on redraft drafts.
- Verified: tsc clean; eslint clean (1 pre-existing warning); analyzer unit test 9/9 (blog/practice/
  case detect by rules, ambiguous → Claude fallback, gap audit flags/passes correctly).
- NOT done: live redraft E2E (needs a live URL + Claude + auth); drawer panel not screenshotted.

## Status — Phase 2 BUILT (uncommitted, 2026-07-07): same-URL WordPress update
Two latent bugs found + fixed along the way:
- `isWordPressFormat` classified every `km_*` format (incl. redrafts) as NOT WordPress-publishable —
  so they could never reach the WP queue at all. Now recognizes `km_page_update` / `km_blog_post` /
  `km_practice_page` / `km_case_result`.
- The publish route only queued for WP when `surface === "blog"`; `km_page_update` is surface
  "other", so a redraft was marked `published` WITHOUT queuing. Fixed: surface treated as "blog" for
  WordPress formats (also gives them blog-level compliance).

Changes:
- `lib/wp-content-publish.ts` — `WpContentItem.update_url` (from `metadata.source_url`); expanded
  `isWordPressFormat`.
- `app/api/content/drafts/[id]/publish/route.ts` — WP-format surface fix + update-aware queue message.
- `public/wp-plugin/km-autopilot.php` (v0.3.0 → **v0.4.0**) — when a queued item has `update_url`,
  resolve it via `url_to_postid()` and `wp_update_post` the existing post IN PLACE. Deliberately does
  NOT change `post_status` (keeps the live page live — forcing draft would pull it offline) or
  `post_name` (same URL). Unresolvable URL → fail loudly (no duplicate at a new URL). Create path
  unchanged for new posts; idempotent on retry via `_km_autopilot_draft_id`.
- Built `public/wp-plugin/km-autopilot-v4.zip` (fresh folder name to sidestep stuck installs).
- Verified: tsc + eslint clean; logic unit test 14/14. PHP NOT lintable here (no php binary) — manual
  structure review only.

### Update-status behavior — CONFIRMED by Kenneth 2026-07-07
An UPDATE of an already-live page KEEPS its live status (content swapped in place) — it never goes to
draft/offline. "Default to WP draft first" applies to NEW posts only. The MarketOS approve step IS the
review gate. Matches the shipped plugin code (update path never sets `post_status`).

### Manual steps (Kenneth — touches the live site)
1. Install `km-autopilot-v4.zip` on katzmelinger.com (Plugins → Add New → Upload), activate.
2. Settings → KM AutoPilot: set base URL + token, enable "Publish long-form content".
3. Redraft a page → Approve → Publish (queues) → wait for the plugin's 15-min sync (or Sync now) →
   confirm the live page updated at the same URL. NO live E2E has been run from here.
