# Tasks + Content Calendar + Email Notifications — Plan

Status: **Not started** — captured as ideas 2026-06-19. Nothing built yet.

Three related features, all of which fit existing patterns in the app. Most of the
infrastructure (Resend email, Vercel Cron, tenant RLS, a calendar UI pattern) already
exists; the only genuinely new piece is a `tasks` table.

---

## 1. Tasks section

No `tasks` table exists yet — this is the one new build.

- **Route:** `/tasks`, added to the sidebar via `lib/departments.ts` (likely a new
  "Workspace"/"Operations" group). Renders with `components/marketing-sidebar.tsx`.
- **Table:** `tasks(id, tenant_id, title, description, assigned_to, due_date, status,
  priority, related_content_id, created_at, updated_at)` — tenant-scoped with RLS, modeled
  on `content_pipeline`. `related_content_id` links a task back to a draft/pipeline item
  (e.g. "Review draft: Personal Injury FAQ").
- **UI:** kanban board (To do / In progress / Done) reusing the pattern in
  `app/content-production/page.tsx`, plus a filtered "My tasks" list.
- **Auto-generation:** tasks can be created manually *or* spawned from the content
  pipeline (e.g. when a draft hits the `review`/`approve` stage, create a "Review X" task
  for the assignee).

### Scope options (decide before building)
- **Tied to content (recommended):** mostly auto-generated from the pipeline + ad-hoc
  manual tasks. Tightest fit with what exists.
- **Full standalone tracker:** general team to-do system (projects, labels, priorities),
  independent of content. More to build.
- **Personal reminders only:** lightweight "my tasks with due dates," no boards/assignment.

---

## 2. Content Calendar section

A calendar pattern already exists to copy: `/social/content-calendar` (reads
`social_posts`, monthly/weekly grid, via `GET /api/social/calendar`). This is mostly
extension, not new construction.

- **Gap to fill:** `content_pipeline` has `created_at`/`updated_at` but **no
  `scheduled_at`/publish-date column.** Add one column (SQL migration).
- **Route:** `/content-calendar` rendering pipeline items + social posts + (optionally)
  task due dates on one month grid, color-coded by status/channel. Click a day to
  schedule/reschedule (drag-and-drop is a later enhancement).
- **Payoff:** one editorial calendar across long-form content, social, and deadlines —
  vs. the social-only calendar today.

### Scope options
- **Unified everything (recommended):** content + social + task due dates on one grid.
- **Long-form content only:** just the pipeline/drafts by publish date; social stays separate.
- **Content + social, no tasks.**

---

## 3. Email notifications

No new infrastructure needed — both pieces already exist:
- **Resend adapter:** `lib/messaging/resend.ts` (already used for review-request emails).
  Gated by env `RESEND_API_KEY` + `RESEND_FROM`; absent ⇒ stubbed/dev mode.
- **Vercel Cron:** `vercel.json` (already runs ~10 daily/weekly jobs).

Notification types:
- **Task assigned (event-based):** email the assignee immediately from the task
  create/update route.
- **Daily due/overdue digest (cron):** new route `/api/tasks/notify-due` on e.g.
  `0 7 * * *`, emails each person their tasks due today/overdue. One line added to
  `vercel.json`.
- **Upcoming calendar items (optional cron):** reminder for content/posts scheduled to
  publish soon.

**Prod requirement:** live email needs `RESEND_API_KEY` + `RESEND_FROM` set in prod.
Without them, sends are stubbed (fine for dev/testing).

---

## Build estimate (MVP)

- 2 SQL migrations: `tasks` table (+ RLS) and the `scheduled_at` column on `content_pipeline`.
- 2 new routes + pages: `/tasks`, `/content-calendar`.
- ~3 small API routes (tasks CRUD, calendar feed, notify-due cron).
- 1 cron entry in `vercel.json`.
- 1 sidebar entry in `lib/departments.ts`.

## Notes / cautions
- Team ships to `main` in parallel — build on a branch and check `main` first to avoid
  colliding with their content-pipeline work.
- Apply SQL migrations via the pooler (`NEW_POOLER_HOST` port 6543, user `postgres.<ref>`),
  not the default IPv6-only host.

## Key files (reference)
| Concern | Files |
|---------|-------|
| Sidebar / routes | `lib/departments.ts`, `components/marketing-sidebar.tsx` |
| Content board | `app/content-production/page.tsx`, `app/api/content-production/route.ts` |
| Existing calendar | `app/social/content-calendar/`, `app/api/social/calendar/route.ts` |
| Pipeline schema | `supabase/content_pipeline_schema.sql` |
| Email | `lib/messaging/resend.ts`, `lib/messaging/types.ts`, `lib/messaging/index.ts` |
| Cron | `vercel.json` |
| Auth / tenancy | `app/api/auth/me/route.ts`, `lib/supabase-route.ts`, `supabase/multitenancy_phase4_rls.sql` |
