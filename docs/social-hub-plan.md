# Social Hub — replacing Metricool with an Ayrshare-backed hub in MarketOS

_Status: **plan only** (no build started). Decided 2026-06-16. Keep the existing Metricool
integration in place until the Ayrshare analytics are verified on the plan._

## Goal

Move social media off Metricool and run the whole workflow **inside MarketOS**, with
**Ayrshare** as the backend for publishing and analytics:

- Generate social posts from a published blog (Repurpose).
- Schedule them **intelligently** across every channel (best times, no collisions).
- See them all in one **calendar + list** view, edit/approve, auto-publish.
- See the **KPIs** that matter, per channel.

Channels: Facebook, Instagram, LinkedIn, TikTok, Google Business Profile (all supported by
Ayrshare today).

## The end-to-end flow Diana described

1. Diana publishes a blog (e.g. _"How NY Sexual Harassment Laws Protect Workers"_).
2. The **Repurpose** tab shows the blog → **Create social content** → 3 posts generated.
3. Posts land on the **calendar**, pre-filled with:
   - Copy generated from the blog
   - Suggested image (from the image generator; Canva later if connected)
   - Relevant hashtags
   - Distributed across the week at **best times**
   - **Auto-publish** already toggled on
4. Diana opens the calendar, sees the posts, clicks **Edit** on any: change copy, swap image,
   add/remove hashtags, change time, duplicate to make a variation.
5. Diana **approves** → it publishes automatically at the scheduled time.
6. The scheduler is smart: if 9:00 AM is already taken, the next post is placed at another
   good time — it **rotates hours/days** based on best-times.

## What already exists (the backbone)

| Capability | Where | Status |
|---|---|---|
| Publish/schedule to all channels (platforms, media, schedule date) | `lib/ayrshare.ts` → `postToAyrshare` | ✅ |
| Local store of scheduled/published posts | `social_posts` table | ✅ |
| AI post generation with hashtags + image suggestions | `lib/content-multiformat.ts` | ✅ |
| Repurpose → "Generate 3 social posts" | Content Production → Repurpose | ✅ (fixed Mon/Wed/Fri 14:00 — no intelligence yet) |
| KPI dashboard | `/social/analytics` | ⚠️ Metricool-powered — repoint to Ayrshare |

## What's missing (the build)

1. **Ayrshare client gaps** — only *posting* is wired. Add: list scheduled/published
   (`/history`), analytics (`/analytics/post`, `/analytics/social`), delete (`/delete`),
   media upload (`/media`), and status polling.
2. **Calendar + List UI** — a week grid + list of `social_posts` across every channel
   (the Metricool "Planning" equivalent).
3. **Composer modal** — multi-channel create/edit: per-platform copy, media, hashtags,
   schedule, auto-publish toggle, live preview.
4. **KPI dashboard** repointed from Metricool to Ayrshare.
5. **The intelligence layer** (below).

## Phased delivery

Building a Metricool replacement is genuinely multi-phase. Each phase is usable on its own.

- **Phase 1 — Scheduler foundation.** Finish the Ayrshare client (history / analytics /
  delete / media) + the **Calendar + List** views showing all channels in one place, with
  status sync. _(Recommended first — everything hangs off this.)_
- **Phase 2 — Composer + edit/approve.** The multi-channel create/edit modal, media attach,
  hashtags, auto-publish, approve → publish.
- **Phase 3 — Repurpose → calendar + intelligence layer.** "Create social content" drops 3
  posts onto the calendar via the best-time engine (distribution + collision avoidance),
  auto-publish on. Build the engine + the learning loop.
- **Phase 4 — KPI dashboard** on Ayrshare, matching the mockups.

## The intelligence layer (best-time rotation + collision avoidance)

This is the unique IP — Diana's "how do we rotate hours/best times/days" question.

**A per-platform best-time score grid** = day-of-week (0–6) × hour (0–23), each cell 0–100,
blended from two sources:

- **Your own engagement history** (from Ayrshare analytics): average engagement of posts you
  published in each (day, hour) bucket, normalized.
- **Audience priors** (cold-start defaults for a NY/NJ law-firm audience: LinkedIn Tue–Thu
  8–10am/12pm; FB/IG weekdays 11–1 & 6–8pm; GBP mornings; TikTok evenings), weighted down as
  your own data accumulates.

**Slot allocation when scheduling N posts:**

1. Rank candidate (day, hour) slots by score within the window (e.g. next 7 days).
2. Greedily assign each post to the highest-scoring slot **not already taken** in
   `social_posts`, enforcing a **minimum gap** (e.g. ≥3h between posts on the same channel,
   ≤1/day) — that's the "9am is taken, move the next one" rule.
3. Spread across **distinct days first**, then fill — natural rotation.
4. "Don't reuse the same slot within K days" keeps variety.

**Learning loop:** a weekly cron recomputes the grid from Ayrshare analytics, so best-times
adapt to what actually performs.

Execution stays Ayrshare (`postToAyrshare` with the computed schedule date); the brain is ours.

## Decisions / dependencies to confirm before building

- **Ayrshare plan tier** must include **analytics** (and **Business** if posting as multiple
  profiles). The dashboard and best-time learning depend on the analytics API. `AYRSHARE_API_KEY`
  is set; verify the tier before Phase 4.
- **Canva is not integrated.** Suggested images come from the existing image generator (or
  manual upload) until/unless Canva is added.
- **Metricool deprecation** is a safe cutover: repoint the dashboard to Ayrshare first, remove
  `lib/metricool.ts` + `/api/social/metricool` + the Metricool env vars only once Ayrshare
  analytics are confirmed working.
