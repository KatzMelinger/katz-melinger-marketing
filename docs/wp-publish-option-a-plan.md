# WordPress publish — Option A (extend KM AutoPilot) — implementation plan

_Status: **awaiting Kenneth's approval to build.** No code written yet._

Goal: make "Approve → Publish to WordPress" actually publish, by extending the **existing**
KM AutoPilot plugin (which we control) instead of using a WordPress Application Password — so we
sidestep Wordfence entirely.

---

## Scope (v1)

**In:** Publishing a **new blog post** to WordPress from an approved draft, including title, body,
URL slug, and (optionally) the SEO meta title/description. Pull model: the plugin polls, publishes,
and reports the live URL back.

**Out (later):** Updating/replacing an *existing* WordPress page (the Optimize/Repurpose flow —
that's an update, not an insert), featured images, and category taxonomy mapping. Noted so the
boundary is explicit.

---

## How it works (data flow)

```
Huraqan (dashboard)                         WordPress (katzmelinger.com)
───────────────────                         ────────────────────────────
1. Draft approved in the board
   → enqueue a publish job
   (snapshot: title, HTML body, slug,
    meta title/desc, target status)
                                            2. KM AutoPilot plugin (cron, ~15 min,
                                               or "Sync now") calls
   GET /api/wp/publish-queue?status=queued  ◄──────── (X-KM-AutoPilot-Token)
   → returns queued jobs for this domain ──────────►
                                            3. Plugin runs wp_insert_post()
                                               (+ sets Yoast/RankMath meta),
                                               gets the new post ID + permalink
   POST /api/wp/published                   ◄──────── { id, wp_post_id, wp_url }
   → mark job published; write URL back ───────────►
4. content_drafts.status = 'published',
   content_pipeline.url + status updated,
   live URL shown on the board
```

No WordPress REST write, no Application Password, no Wordfence involvement — the plugin acts from
inside WordPress and only makes outbound calls to us, exactly like it does today for SEO fixes.

---

## The pieces to build

### 1. DB — new queue table (`supabase/wp_publish_jobs_schema.sql`)
Mirror the `wp_autopilot_recommendations` convention (idempotent, RLS, `updated_at` trigger).
`wp_publish_jobs`:
- `id` uuid PK
- `domain` text (which site — scoped by token, like recommendations)
- `tenant_id` uuid
- `draft_id` uuid → content_drafts, `pipeline_id` bigint → content_pipeline (nullable)
- snapshot at approval: `title`, `slug`, `content_html`, `excerpt`, `meta_title`,
  `meta_description`, `target_status` ('draft' | 'publish')
- `status` text: 'queued' | 'published' | 'failed' (default 'queued')
- filled on confirm: `wp_post_id` bigint, `wp_url` text, `error` text
- `created_at`, `updated_at`
- Guard against double-publish: partial unique on `draft_id` where status <> 'failed'.

### 2. lib — helpers in `lib/wp-autopilot.ts`
- `enqueuePublishJob({ draftId, domain, tenantId, targetStatus })` — reads the draft, converts
  markdown body → HTML (we already have `marked`), appends the attorney-advertising disclaimer,
  pulls meta title/desc/slug from the draft brief, inserts a `wp_publish_jobs` row.
- `listPublishJobs({ domain, tenantId, status, limit })` — mirrors `listRecommendations`.
- `markPublished({ id, domain, tenantId, wpPostId, wpUrl })` — requires status 'queued'
  (mirrors `markApplied`'s "must be approved" guard), flips to 'published', and writes back to
  `content_drafts` (status='published') + `content_pipeline` (url, status='published').

### 3. API — three endpoints
- `GET /api/wp/publish-queue` — token-auth (reuse `authenticateToken`); returns queued jobs for the
  caller's domain. Mirrors `recommendations/route.ts`.
- `POST /api/wp/published` — token-auth; `{ id, wp_post_id, wp_url }` → `markPublished`. Mirrors
  `applied/route.ts`.
- `POST /api/wp/publish` — **session-guarded** (guardUser); body `{ draftId }` → `enqueuePublishJob`.
  This is what the board button calls.

### 4. Plugin — `public/wp-plugin/km-autopilot.php` (bump to v0.2.0)
- New `km_autopilot_run_publish_sync()`: `GET /api/wp/publish-queue?status=queued`; for each job
  call `wp_insert_post([ post_title, post_content (HTML), post_name (slug), post_status, post_type ])`;
  set Yoast/RankMath meta via the existing `km_autopilot_apply_meta_field()` helper; then
  `POST /api/wp/published` with the new post ID + `get_permalink()`.
- Add it to the 15-min cron and the "Sync now" button; log to the existing activity log.
- Skip-guard: if a job already carries a `wp_post_id`, don't re-insert.
- **Site admin re-uploads the updated plugin** (version bump) — the one on-site step.

### 5. Dashboard wiring
- `components/draft-drawer.tsx` "Approve → Publish to WordPress" (line ~606): instead of just
  flipping status, call `POST /api/wp/publish`. Keep the existing gate (legal-review + proofread
  checks) and add the auto-compliance check. While a job is queued, show "Publishing… (syncs within
  ~15 min)"; when confirmed, show the live URL.

---

## Defaults I'll use (tell me to change any)
1. **Publish target: WordPress _draft_, not live**, for the first rollout — so Diana eyeballs the
   first posts in WP before they go public. Flip to live publish once trusted. (`target_status`.)
2. **SEO meta sync: included** — the plugin already has the Yoast/RankMath helper, so it's cheap.
3. **Categories / featured image / author: none in v1** (default WP author = the plugin's WP user).
4. **Scope: new posts only** (not updating existing pages).

---

## Prerequisite (operational, not code)
The KM AutoPilot plugin must be **installed + enabled on katzmelinger.com with a valid token**.
If it isn't yet, that's a one-time install (Settings → KM AutoPilot → paste base URL + token,
tick Enable). I'll build everything regardless; this only gates the final live test.

## What I can verify vs. what needs the site
- **I can verify:** typecheck/build passes; the enqueue endpoint creates a job; the queue + confirm
  endpoints behave (I can simulate the plugin's calls with a test token); the board button enqueues.
- **Needs the live site (you/Diana):** the actual `wp_insert_post` on katzmelinger.com after the
  updated plugin is uploaded — the true end-to-end publish.

---

## Build order
1. DB migration (`wp_publish_jobs`) + run it on the live Supabase project.
2. `lib/wp-autopilot.ts` helpers (enqueue / list / markPublished) + markdown→HTML + disclaimer.
3. Three API routes (publish-queue, published, publish).
4. Plugin publish routine + version bump.
5. Wire the board button + "Publishing…" state + live-URL display.
6. Verify the dashboard + endpoint path locally; hand off the updated plugin for the on-site test.
```
```
