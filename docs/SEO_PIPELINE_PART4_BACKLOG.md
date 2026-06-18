# SEO Content Pipeline — Part 4 Backlog (deferred "build later")

Source: Diana's "System Status for Kenneth" walkthrough (2026-06-10) + follow-up.
Parts 1–3 (urgent fix, bugs, connections), one-click-at-approval, and the Part 2
"fix soon" items are **done** (see git history around 2026-06-11 and the working
notes). This file holds what was intentionally deferred so it isn't lost.

> **STATUS — verified against code 2026-06-18.** Most of Part 4 has since
> shipped. Code review confirmed: **#1 keyword grouper BUILT** (`lib/keyword-clustering.ts`,
> `/api/seo/opportunities/cluster`, "Group into clusters" on `/seo/opportunities`),
> **#2 cannibalization BUILT** (`lib/content-overlap.ts` + `/api/content/overlap-check`
> + the `/seo/cannibalization` detective view), **#4 performance tracker BUILT**
> (`lib/rank-history.ts`, `seo_rank_snapshots`, `components/rank-history-panel.tsx`),
> **#5 WordPress publish BUILT** (pull-plugin model: `lib/wp-content-publish.ts`,
> `/api/wp/content` + `/api/wp/content/applied`, `public/wp-plugin/km-autopilot.php`).
> **Genuinely remaining: only #3 (QA checklist HARD gate — PARTIAL)** plus the new
> cross-cutting **#0 (registry duplicate alert)** added below.

## 0. Registry duplicate alert → Overview "Issues to fix" — REMAINING (recommended next)
**What:** Surface a system-wide count of duplicate/overlapping content as a real
alert in the home "Issues to fix" panel, linking to a filtered Production Board
view of the conflicting items. The Overview already renders a **"Duplicate content"**
row hardcoded to `—` (`app/page.tsx` ~line 152, fed by `lib/dashboard-snapshots.ts`
~line 175 — *"doesn't have a single tidy endpoint yet — placeholder rows"*), so the
slot exists and just needs data.
**Why it matters:** Completes the Canonical Content Registry spec (Addition 3); the
registry/semantic-match layer shipped 2026-06-18 (commit f7919c0) but the after-the-fact
duplicate alert was deferred.
**Likely touch points:** a tenant-scoped duplicate-COUNT function (wrap the
`scripts/find-duplicates.ts` logic into a lib/route, reuse `semanticKey` from
`lib/content-dedup.ts` for consistency) → feed `lib/dashboard-snapshots.ts` →
make the row clickable to a filtered `/content-production` view. No count
function/route exists today.

**Build order:** strictly after Parts 1–3 are solid in production. Within Part 4,
build top-to-bottom — the WordPress publish button is explicitly last.

---

## 1. Intelligence layer — keyword grouper — ✅ BUILT (2026-06-17)
Shipped: `lib/keyword-clustering.ts` (Claude pillar/standalone clustering) + `seo_opportunities` cluster_* columns + `/api/seo/opportunities/cluster` + "Group into clusters" button and PILLAR/STANDALONE rows on `/seo/opportunities`; "Create Cluster Brief" pre-loads members as secondary keywords.
**What:** Group individual keywords into page-level decisions before they hit the
Decisions queue. Diana's example: ~290 raw keywords should collapse into ~31 page
decisions. `wrongful termination lawyer` + `wrongful termination lawyers` +
`wrongful termination attorney` → one page decision.
**Why it matters:** Today each keyword can become its own Decision/Brief, which is
how near-duplicate pages (and cannibalization) get created in the first place.
**Reference:** `KM_Kenneth_IntelligenceLayer_June_2026.docx`
**Likely touch points:** a clustering step feeding `/api/seo/suggestions`; the
Decisions UI (`app/content/decisions`); `lib/strategy-engine.ts`.

## 2. Intelligence layer — cannibalization check (pre-surface) — ✅ BUILT
Shipped: generation-time overlap (`lib/content-overlap.ts` `detectContentOverlap` + `/api/content/overlap-check`, "link don't redefine" + one-click Add-link) and a detective `/seo/cannibalization` view off `cannibalization_snapshots`. NOTE: the explicit decision-time "route to Refresh Queue instead of proposing a new page" step is the one sub-piece not wired as its own gate (the dedup guard + overlap check cover the duplication risk).
**What:** Before surfacing a keyword as a new Decision, check whether
katzmelinger.com already has a page covering it. If yes, route it to the Refresh
Queue instead of proposing a new page.
**Why it matters:** Prevents creating competing pages for terms the site already
ranks for. Complements the *generation-time* overlap check (`detectContentOverlap`
in `lib/content-overlap.ts`) that already enforces "link, don't redefine" — this is
the *earlier* gate at decision time.
**Reference:** `KM_Kenneth_IntelligenceLayer_June_2026.docx`
**Likely touch points:** site inventory (`lib/site-inventory.ts`, `site_pages`),
`app/content/refresh`, the suggestion-creation path.

## 3. QA checklist automation — ⚠ PARTIAL (the real remaining Part-4 item)
The advisory analysis engine is fully built (`lib/content-analysis.ts`, `/api/content/drafts/[id]/analyze`: readability, AEO, SEO breakdown incl. headingStructure/keywordPlacement; soft 75/75/75 warning in the DraftDrawer). What's MISSING is the HARD gate: blocking pass/fail checks (meta description present, H1 contains primary keyword, pillar link present, min word count) surfaced on `/content/publishing-qa` / the DraftDrawer approve step. This is the one item that still needs building.
**What:** When a pipeline item reaches QA (status `review`), automatically check:
meta description present; H1 contains the primary keyword; pillar link present;
word count meets the minimum. Surface pass/fail in the Publishing QA stage.
**Why it matters:** Makes QA a real gate instead of a manual eyeball. Much of this
already exists as *advisory* analysis on drafts (`/api/content/drafts/[id]/analyze`
— readability, AEO, SEO breakdown incl. headingStructure/keywordPlacement); the
work is wiring those signals into a hard QA checklist on the board.
**Reference:** `KM_Kenneth_Technical_Brief_June_2026.docx`
**Likely touch points:** `app/content/publishing-qa`, reuse the analysis pipeline.

## 4. Performance Tracker — ✅ BUILT
Shipped: `lib/rank-history.ts` (`writeRankSnapshots` on the daily tracked-keyword cron) + `seo_rank_snapshots` table + `/api/seo/rank-history` (180-day window) + `components/rank-history-panel.tsx` (Semrush-style visibility trend + competitor comparison) embedded on `/seo/keywords`.
**What:** Track ranking position over time per published URL, show what moved the
ranking, and feed insights back to Opportunities.
**Why it matters:** Closes the loop from published content back to strategy.
**Reference:** `KM_Kenneth_Technical_Brief_June_2026.docx`
**Likely touch points:** DataForSEO rank data (vendor migration already approved —
see memory `vendor-migration-and-agent-plan`), a new tracking table + cron, and
`app/seo/opportunities`.

## 5. WordPress publish — ✅ BUILT (pull-plugin model, not REST push)
Shipped: the Publish step queues approved long-form drafts (`metadata.wp_publish.queued`); `lib/wp-content-publish.ts` + `/api/wp/content` (plugin polls) + `/api/wp/content/applied` (plugin confirms → flips to published + site_pages ingest); plugin `public/wp-plugin/km-autopilot.php` v0.2.0. NOTE: chose the pull-plugin over WP REST push (no WP creds in the app). Still needs a live WP site to exercise end-to-end.
**What:** One button sends an approved draft to WordPress via the REST API. Diana
clicks once.
**Why it matters:** Removes the final manual hand-off — the end of the
"approve → publish" vision.
**Do not build until 1–4 are complete and Parts 1–3 are stable in prod.**
**Reference:** `KM_Kenneth_Technical_Brief_June_2026.docx`
**Likely touch points:** new publish route (WP REST), reuses the published-URL →
`site_pages` ingest already wired in `app/api/content/drafts/[id]` PATCH.

---

## Smaller leftover cleanups (not Part 4, but parked here)
- **Duplicate approved suggestions:** two `abogado de despido injustificado` rows
  exist in `brief_suggestions` (status approved), predating the dedup guard. The
  guard blocks new dupes; these old ones need a manual delete if desired. The
  `content_pipeline` dupe was already removed via `scripts/dedupe-pipeline.ts`.
- **True one-click coverage:** new approvals are one-click-ready (cannibalization
  gate auto-confirmed on approval); existing approved briefs were already
  confirmed. `scripts/confirm-approved-cannibalization.ts` exists as an idempotent
  backstop.

---

## Diana follow-up direction (2026-06-11) — refinements + new asks

Captured from Diana's note; some refine the items above, some are new. Two
vendor decisions (★) must be settled before building.

### A. Opportunity Radar = broaden beyond SEMrush (refines item #1/#2)
Diana's framing: the Radar is "SEO overall opportunities" and should ALSO pull
**Google Trends** and **other sites people visit weekly for employment-law help**
(community/forum signals). **Reality:** the Radar (`app/seo/opportunities`,
`lib/seo-intelligence.ts`, `lib/opportunity-pipeline.ts`) is **SEMrush-only**
today (competitor gaps, missing targets, long-tail). No Google Trends. The
`app/social/trends` page is Claude reasoning, not a live Trends feed. There's a
`community` module (`lib/community-suggester.ts`) that could feed the "other
sites" signal. → Work: add Google Trends + community/forum source ingestion to
the Radar.

### B. ★ Keyword tracking vendor — SEMrush vs DataForSEO
Diana: "keyword tracking is okay, it should come from SEMrush — which is what it's
doing." **Reality matches her:** production routes call `lib/semrush.ts`.
BUT the approved vendor plan (memory `vendor-migration-and-agent-plan`) is
SEMRush→DataForSEO, and `lib/dataforseo.ts` is already built as a drop-in
replacement (not yet swapped in). **DECISION NEEDED:** finish the DataForSEO
migration, or keep SEMrush for tracking? Don't half-migrate.

### C. Content draft editor — make it visual (SEMrush-style), not raw markdown
Diana's main concrete ask: the draft comes back as raw **markdown**; she wants a
better visual editor like the **SEMrush** screenshots she sent. **Reality:** a
rendered markdown preview ALREADY exists in Content Studio (`app/content/page.tsx`
uses `marked` + `dangerouslySetInnerHTML`), but the **Drafts library**
(`app/content/drafts/page.tsx`, where the SEO pipeline drafts live) is a raw
`<textarea>` only. → Quick win: reuse the Content Studio rendering for a
live preview pane in Drafts. → Fuller: SEMrush-style editor with live SEO score
sidebar (reuse the existing `/analyze` signals). Pending Diana's screenshots for
the exact visual target.

### D. Social media calendar + scheduling (NEW; overlaps item #5 publish)
Diana: from one blog, create social posts AND **schedule** them like Metricool;
she's sending a spec doc. **Reality:** one-blog→9-format generation ALREADY
exists (`lib/content-multiformat.ts`, `app/content/batch`). Metricool is wired
read-only for analytics. **No scheduling/calendar and no publish integration
exist** (agent publish leg is a stub). **★ DECISION:** the approved plan replaces
Metricool with **Ayrshare** for publishing — build the calendar/scheduling on
Ayrshare (matching the Metricool UX Diana likes), not Metricool. Waiting on her
calendar spec doc + "other features" details.

---

## Related one-off scripts (all dry-run by default, `--apply` to write)
- `scripts/clean-existing-geo-keywords.ts` — strip non-NY/NJ keywords (applied).
- `scripts/dedupe-pipeline.ts` — remove duplicate board rows (applied).
- `scripts/confirm-approved-cannibalization.ts` — confirm cannibalization on
  approved briefs (no-op as of 2026-06-11; backstop).
- `scripts/verify-pipeline-link.ts` — read-only smoke test of the pipeline↔draft
  wiring.
