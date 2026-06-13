# API Route Auth Audit

**Date:** 2026-06-13
**Scope:** all `app/**/route.ts` (232 files)

## Root cause

The auth proxy (`proxy.ts`) deliberately excludes `/api/*` from its matcher, so **middleware does not protect API routes** — each route must gate itself. `resolveTenantId()` (`lib/tenant-context.ts`) **silently returns `DEFAULT_TENANT_ID`** when there is no session. So any handler that does privileged work using a service-role client (`getSupabaseServer`/`getSupabaseAdmin`, which bypass RLS) + `resolveTenantId()` and **no** explicit auth check is reachable by anyone on the internet, operating against the default tenant.

Only ~22 of 232 route files gate themselves. Routes that use `getTenantClient()` (RLS, cookie-based) are partially self-protecting (RLS blocks a session-less caller); the **service-role + `resolveTenantId`** routes are wide open.

## The gates (`lib/supabase-route.ts`)

- `guardUser()` → returns a 401/403 `NextResponse`, or `null` when authed. Use: `const denied = await guardUser(); if (denied) return denied;`
- `requireUser()` / `requireAdmin()` / `requireSuperAdmin()` → throw; wrap in try/catch.
- `isAuthorizedCron(req)` (Bearer `CRON_SECRET`) → protects cron GET handlers.

**Triage heuristic:** any handler whose only tenant logic is `resolveTenantId()` with a `getSupabaseServer()`/`getSupabaseAdmin()` client and no `requireAdmin`/`requireUser`/`guardUser`/`isAuthorizedCron` above it is anonymously reachable.

---

## 🔴 HIGH — credentials / financials / publishing / PII / money-spend / mutations

> Status: being gated with `guardUser` (this pass). Tightening `wp/tokens` and `marketing/spend` to `requireAdmin` is a recommended follow-up.

### Credentials / financials / outbound publishing
| Route | Handlers | Risk |
|---|---|---|
| `wp/tokens` | POST, GET, DELETE | Mint/list/revoke WordPress autopilot API tokens |
| `marketing/spend` | GET, POST, DELETE | Read/mutate/delete ad-spend financials |
| `social/ayrshare/publish` | POST | Publish/schedule social posts |
| `local-seo/gbp/reply` | POST | Public reply on Google Business reviews |
| `local-seo/google-business` | POST | Publish a Google Business post |
| `local-seo/gbp/draft-reply` | POST | AI-draft GBP reply (Anthropic spend) |

### PII / sensitive reads
| Route | Handlers |
|---|---|
| `calls`, `calls/[id]`, `calls/coaching` | GET |
| `callrail/calls`, `callrail/forms`, `callrail/summary` | GET |
| `forms` | GET |
| `cms`, `cms/attribution`, `cms/intakes-by-source`, `cms/funnel-by-source` | GET |
| `pipeline/prospects` (+ `/[id]`), `pipeline/activities` | GET/POST/PATCH |

### Money-spend — GET cron-gated but POST open (gate the POST only)
`agent/run`, `calls/score-pending`, `seo/opportunities/sync`, `seo/tracked-keywords/refresh`, `content/site-inventory/crawl`, `aeo/runs/start`

### Money-spend — fully open POST
`prompts/[id]/run` (calls `getCurrentUser` but ignores the result), `agent`, `content/draft`, `content/km-draft`, `content/drafts`, `content/drafts/[id]/apply-suggestion`, `content/research/packet` (GET+POST), `content/intelligence/{topics,trends,social,topic-fit,metadata}`, `content/pillars/suggest`, `community/suggest`, `brand-voice/wizard/generate`, `calls/[id]/score`, `images/generate`, `images/edit`, `aeo/recommendations`, `recommendations/generate`, `keyword-research/{discover,expand,competitor-gaps}/start`, `seo/keywords/{fan-out,recommendations}`, `seo/schema-generator`, `seo/suggest-qa`, `seo/pr-pitches` (+ `/screen`), `seo/backlinks/strategy`, `seo/briefs/meta`, `seo/technical/suggest-fixes`

### Other mutations / abuse
`seo/technical/queue-fixes`, `seo/internal-links/scan`, `seo/cannibalization/scan`, `seo/backlinks/verify`, `seo/backlinks/disavow` (POST/DELETE), `seo/opportunities/import`, `seo/tracked-keywords/push-to-semrush`, `content/pipeline/[id]` (PATCH/DELETE), `sales-training` (POST/PUT), `ai-search/crawl` (POST — SSRF-ish: fetches a caller-supplied URL)

---

## 🟡 MEDIUM — non-sensitive reads / minor (not yet gated)

`reviews` GET, `semrush/{overview,keywords,backlinks,competitors}` GET, `metrics/overview`, `correlation/dashboard`, `constant-contact/lists`, `email/constant-contact` GET, `community/*/scan` GET, `ai-bots/ingest` POST (sessionless telemetry write, no shared secret).

---

## ✅ Already safe (no action)

- **Gated:** all `admin/*` (`requireAdmin`/`requireSuperAdmin`); `leads/*`, `reviews/requests`, `ads/competitor-ads`, `calls/sync` POST, `forms/sync` POST (`guardUser`); `community/posts/[id]/status`, `auth/me` (`getCurrentUser` enforced).
- **Cron GETs** (`isAuthorizedCron`): the GET halves of the split routes above.
- **Public by design:** `r/[token]`, `signup`, `auth/confirm`, `auth/signout`, `google/*` + `constant-contact/oauth/*` callbacks, `integrations/status`.

---

## Recommended durable fix

Consider **default-deny at the proxy**: stop excluding `/api` from the matcher and enforce auth there, with an allowlist for genuinely public routes (`/api/auth/*`, oauth callbacks, `/r`, signup, `integrations/status`, signature-verified webhooks). This protects every route at once. Prerequisite: confirm no route is fetched server-side without the session cookie (most are client `fetch`es that carry it).
