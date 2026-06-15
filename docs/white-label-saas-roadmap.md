# White-Label SaaS Conversion Roadmap

**Goal:** Turn this from "Katz Melinger's marketing dashboard" into a multi-tenant SaaS any law
firm can sign up for, brand as their own, and connect to their own tools (email distribution,
social, SEO data, CRM). Constant Contact is *a* choice, not *the* choice — same for every vendor.

**Date:** 2026-06-14
**Status:** Review + plan. Workstream A (brand scrub) partially implemented — see Progress log.

## Progress log

- **2026-06-14 — Workstream A1/A3 (visible brand scrub) — DONE.**
  - New `lib/app-config.ts` → `APP_NAME` (product name, env `NEXT_PUBLIC_APP_NAME`, default
    "Marketing Dashboard"). Used pre-auth (login) and in browser-tab titles.
  - Sidebar wordmark + home subtitle now render the **per-tenant firm name** (sidebar via a new
    `firmName` field on `/api/auth/me`; home via `getTenantConfig()`).
  - Genericized metadata titles/descriptions: root `app/layout.tsx`, `app/page.tsx`, and hubs
    (`social`, `seo`, `campaigns`, `ai`, `executive`, `attribution`, `seo/competitors/[domain]`).
  - **`lib/tenant-config.ts`: KM contact fallbacks now gated behind `DEFAULT_TENANT_ID`** — any
    non-KM tenant gets blanks, never KM's name/address/phone/email/geography. (KM byte-for-byte
    identical: `KM_FALLBACK` === old values.)
  - Genericized placeholders / empty-state defaults: `admin/users`, `brand-voice` firm fields,
    `content` (DEFAULT_BRAND_VOICE + subtitle + textarea), `seo/citations`, `seo/backlinks`
    disavow header, integrations "Katz Melinger CMS" label → "Firm CMS / case-management link".
  - Verified: `tsc --noEmit` clean.
  - **NOT yet done in A:** the color sweep (A2 — `#185FA5` still hardcoded in ~86 files; infra
    not yet added), the content-generation prompt scrub (A4 — see below; this is the one that
    still leaks "Katz Melinger PLLC" into *generated* meta titles / drafts for other firms), and
    the **hardcoded-domain batch (A5, see below)**.

- **A5 — hardcoded `katzmelinger.com` references in tool pages — DONE (2026-06-14).**
  Built the per-tenant client infra and swept every UI reference. Verified live (sidebar shows the
  per-tenant firm name; `/llms-txt` prefills the tenant's own domain) + `tsc` clean + no console
  errors. What landed:
  - `/api/auth/me` now also returns `domain` (tenant_settings.semrush_domain).
  - New `components/tenant-provider.tsx`: `TenantProvider` (mounted once in `LayoutShell`, one
    `/api/auth/me` fetch for the whole app) + `useTenant()` and `useTenantSiteUrl()` hooks.
  - `marketing-sidebar.tsx` refactored to consume the provider (removed its own fetch).
  - URL prefills now use `useTenantSiteUrl()`: `ai-search`, `llms-txt`, `seo/technical`,
    `seo/internal-links`. Placeholders genericized: `content/{decisions,pipeline,refresh}`.
  - Output-leak links/output fixed: `km-brief-wizard` meta titles + copy (firmName via hook),
    `clarity` deep link + copy (domain via hook), `seo/cannibalization` search link (uses
    `snapshot.domain`). Helper copy genericized to "your site" in `ads`, `ai/referrals`,
    `ai/bot-traffic`, `content/site-map`, `seo/link-strategy`, `seo/backlinks`, `ai`/`seo` hubs.
    `local-seo` mock data domain genericized.
  - **Settings table-split unified:** `/api/brand-voice/settings` now mirrors firm-identity fields
    into `tenant_settings` on PUT and overlays them on GET, so the sidebar (tenant_settings) and the
    brand-voice form stay consistent. `tenant_settings` is the canonical home for firm identity.

  <details><summary>Original A5 file list (now resolved)</summary>
  - URL prefills (`useState("https://www.katzmelinger.com")`): `app/ai-search/page.tsx:240`,
    `app/llms-txt/page.tsx:24`, `app/seo/technical/page.tsx:98`, `app/seo/internal-links/page.tsx:31`.
  - Placeholders: `app/content/decisions/page.tsx:469`, `app/content/refresh/page.tsx:353`,
    `app/content/pipeline/page.tsx:678`.
  - Helper/instructional copy naming the domain: `app/ads/page.tsx:313,1984,1991`,
    `app/ai/page.tsx:139`, `app/ai/referrals/page.tsx:125,306`,
    `app/ai/bot-traffic/page.tsx:99,262`, `app/clarity/page.tsx:12,134,194,241`,
    `app/content/site-map/page.tsx:173`, `app/seo/page.tsx:107`,
    `app/seo/backlinks/page.tsx:305`, `app/seo/cannibalization/page.tsx:242`,
    `app/seo/link-strategy/page.tsx:353,378,396`.
  - Hardcoded example/sample data (KM practice-page URLs): `app/local-seo/page.tsx:325-346`.
  </details>

- **Crawler-constant batch — DONE (2026-06-14).** Verified `tsc` clean + SEO routes load 200 +
  no console errors. All crawl/SEO functions now resolve the firm's domain per-tenant
  (KM's config returns katzmelinger.com, so KM is identical):
  - `lib/seo-intelligence.ts` — added a `tenantDomain()` helper; all 9 functions that defaulted to
    `SEMRUSH_DOMAIN` now swap in the per-tenant domain when the default/KM domain was used (explicit
    competitor domains are untouched).
  - `lib/cannibalization.ts` — resolves the firm domain from `getTenantConfig(tid)`.
  - `lib/backlink-strategy.ts` — `analyzeOutboundLinkProfile()` crawls the tenant's own sitemap;
    `isOurDomain`/`extractExternalLinks`/`extractAllHrefs` now take the firm domain as a param.
  - `lib/backlink-verify.ts`, `lib/link-verify.ts`, `lib/site-inventory.ts` — resolve the firm
    domain per-tenant; genericized KM user-agent strings.
  - `lib/ai-crawler.ts` (dead-fallback → example.com), `lib/agent-tools.ts` (tool description).
  - **GSC routing:** the 5 `app/api/search-console/*` routes now query the tenant's
    `gscSiteUrl` (was the hardcoded `getGscSiteUrl()` / KM default). All `app/api/semrush/*` and
    `tracked-keywords/refresh` already resolved per-tenant.
  - Low-level `SEMRUSH_DOMAIN` / `DATAFORSEO_DOMAIN` / `getGscSiteUrl()` constants are retained as
    the **default-tenant fallback only** (callers now pass the resolved per-tenant domain).
  - Note: GSC/GA data for a 2nd firm also needs the Google service account to have access to that
    firm's property — see per-tenant credentials (Workstream B5). A 2nd firm should still set
    `tenant_settings.semrush_domain` + `gsc_site_url`.

- **A4 — content-generation output-leaks — MOSTLY DONE (2026-06-14).** Verified `tsc --noEmit`
  clean + app loads (sidebar/home now show the per-tenant firm name live).
  - **System-prompt + pillars gating** (`lib/tenant-config.ts`): non-default tenants now get a new
    `NEUTRAL_SYSTEM_PROMPT` (`lib/km-content-system.ts`) and empty pillars instead of inheriting
    KM_SYSTEM_PROMPT / ALL_KM_PILLARS. KM (default) unchanged.
  - **Routed through per-tenant config** (KM byte-identical because its config returns KM values):
    `lib/strategy-engine.ts` meta title/description (default-gated), `lib/content-multiformat.ts`,
    `lib/content-language.ts`, `app/api/content/draft/route.ts`,
    `app/api/content/intelligence/metadata/route.ts` (domain), `app/api/content/km-draft/route.ts`,
    `app/api/seo/briefs/meta/route.ts` (firmName), `app/api/agent/route.ts` (APP_NAME),
    `app/api/keyword-research/{discover,expand,competitor-gaps}/start/route.ts` (domain),
    `app/api/seo/backlinks/strategy/route.ts` (prompt domain).
  - **Still KM-bound → defer to Workstream E** (these need more than a name swap):
    - `app/api/seo/pr-pitches/route.ts` + `screen/route.ts` — hardcode attorney **"Kenneth Katz, Partner"**
      and a full employment practice-area list. Needs a new `tenant_settings` spokesperson/attorney
      field + practice-area generalization. Do NOT use pr-pitches for another firm until fixed.
    - `lib/strategy-engine.ts` `CLAUDE_JUDGE_SYSTEM` — internal classifier framed as KM employment/
      collections (affects routing, not output; lower risk).
    - `lib/sales-coach*.ts` — entire rubric/SOPs are KM's; KM-only feature until a firm supplies SOPs.
    - `KM_SYSTEM_PROMPT` body + `KM_STRUCTURES` — KM's domain content (kept via Option A; wizard
      generates per-firm versions).
    - `app/api/seo/backlinks/strategy/route.ts` — still uses a KM practice-area list and its data
      source `analyzeOutboundLinkProfile()` crawls KM's domain (see crawler-constant batch below).

- **Product name = "Huraqan" + MarketOS scrub — done (2026-06-14).** `APP_NAME` default is now
  "Huraqan" (`lib/app-config.ts`; override via `NEXT_PUBLIC_APP_NAME`); all "MarketOS" strings →
  "Huraqan" across 13 app/components/lib files. Verified (tab title + UI render "Huraqan", tsc clean).
  - **Deferred cosmetic (per user — do before selling, not blocking):**
    - Rename `km-*` files + `KM_`/`KM…` symbols (`lib/km-content-system.ts`, `km-brief-wizard.tsx`,
      `km-per-page-brief-form.tsx`, `km-content-generator.tsx`, `api/content/km-draft`; symbols
      `KM_SYSTEM_PROMPT`/`KM_STRUCTURES`/`KM_HUB_LINKS`/`ALL_KM_PILLARS` + `KMPillar`/`KMPerPageBrief`/
      `KMContentType`/`KMPracticeArea`) — ~147 refs / 23 files, internal-only.
    - `package.json` name `katz-melinger-marketing` (+ repo folder); localStorage keys
      `km_sidebar_collapsed`/`km_sidebar_groups` (rename resets saved sidebar prefs).
    - Leave: default tenant slug `katz-melinger` + seed rows; `sales-collateral/*` +
      `public/wp-plugin/km-autopilot.php` (KM's own collateral).

- **B1 email-distribution provider swappability — delivered (2026-06-14).** `tsc` clean; verified
  `/api/email/providers` lists 3 providers (Constant Contact active) and `/api/email` resolves
  through the registry, no console errors.
  - `lib/email/types.ts` (`EmailProvider` interface + normalized `EmailDashboard`), `providers/
    constant-contact.ts` (real — ports the old CC dashboard logic), `providers/stubs.ts` (Mailchimp
    + SendGrid stubs — available once their API key is set, implement to activate),
    `lib/email/registry.ts` (`resolveEmailProvider`: tenant pref → `EMAIL_PROVIDER` env → first
    available — same pattern as CRM).
  - `tenant_settings.email_provider` column (migration `supabase/tenant_settings_email_provider.sql`)
    → `getTenantConfig().emailProvider`.
  - New provider-agnostic `GET /api/email` (the page now calls this instead of
    `/api/email/constant-contact`) + `GET /api/email/providers`. Email is no longer hardwired to
    Constant Contact — it's provider #1 in a registry.
  - **Follow-up:** implement a real 2nd provider (Mailchimp/SendGrid) when wanted, and add a
    provider-picker in the UI; apply `supabase/tenant_settings_email_provider.sql`.

- **B2 social — decision: Ayrshare IS the abstraction (no registry needed).** Ayrshare is already a
  one-API-to-all-networks layer, so social publishing stays on Ayrshare for the SaaS. The only
  non-Ayrshare social piece is Metricool (analytics) — migrate it to Ayrshare analytics later (same
  DataForSEO-style swap), then social is fully single-vendor. No swappable registry to build.

- **B4 CRM provider selection — deferred** (per user). Registry exists; just needs a
  `tenant_settings.crm_provider` column wired into `resolveCrmProvider(preferredId)`.

- **#2 SEMrush→DataForSEO (backlinks/competitors/organic) — delivered with fallback (2026-06-14).**
  `tsc` clean; verified `/api/seo/competitors` + `/api/seo/backlinks` return real data, no console errors.
  - New `lib/dataforseo-seo.ts`: DataForSEO implementations of organic keywords (proven Labs
    `ranked_keywords`), organic competitors (`competitors_domain`), backlink summary / referring
    domains / recent backlinks (`backlinks/*` — the **paid Backlinks API**, mapped per DataForSEO
    docs but NOT verified against a live paid account).
  - `lib/seo-intelligence.ts`: `getDomainOrganicKeywords`, `getBacklinkOverview`, `getBacklinkDomains`,
    `getRecentBacklinks`, `getOrganicCompetitors` now try DataForSEO FIRST, then fall back to the
    existing Semrush implementation on empty/throw. So `getTrackedKeywordPerformance` + the
    keyword-gap functions ride along (they call `getDomainOrganicKeywords`).
  - **No regression**: Semrush stays the safety net, so `SEMRUSH_API_KEY` is still needed until
    DataForSEO Backlinks is confirmed working in prod (then it can be removed). The keyword/
    competitor paths use the already-working Labs API.
  - Verify in prod that the `backlinks/*` field mapping is right (authority = rank/10, etc.);
    fallback covers it if not.

- **B5 per-tenant credentials — v1 delivered (2026-06-14).** `tsc` clean; secrets API returns
  presence (200); Google auth resolves per-tenant; no regression (default tenant uses env).
  - New `tenant_secrets` table (migration `supabase/tenant_secrets.sql`) — **server-only**: RLS on
    with zero policies, so only the service-role client can touch it (secrets never reach the browser).
  - `lib/tenant-secrets.ts`: `getTenantSecret(key)` → firm's stored secret, else (default tenant
    ONLY) the env-var fallback, else undefined — a non-default firm never inherits KM's credentials.
    Plus `setTenantSecret`.
  - `lib/google-access-token.ts` now reads the service account via `getTenantSecret` (per-firm GA4/GSC).
  - Write/presence API `app/api/integrations/secrets` (write-only, like Vercel sensitive vars;
    validates the Google SA JSON on save).
  - **Remaining B5 follow-ups:** wire CallRail's 7 routes (`app/api/{calls,forms,callrail}/**`) to
    `getTenantSecret` (they still read env directly); a firm-facing settings UI to paste Google SA +
    CallRail (the API exists); admin-role gate on the PUT (currently any authenticated tenant member);
    apply `supabase/tenant_secrets.sql`. (DataForSEO/Anthropic stay shared platform keys — not per-tenant.)

- **Workstream C (branding / theming) — delivered (2026-06-14).** Verified `tsc` clean + live
  re-theming + no console errors.
  - **Themeable color:** `globals.css` exposes `--brand` (default `#185FA5`) + a Tailwind v4
    `--color-brand` token → `bg-brand` / `text-brand` / `border-brand` / `ring-brand` (+ opacity)
    utilities. Swept all 78 components: `[#185FA5]` → `brand`, `[#1f6fb8]` (hover) → `brand/90`.
    `TenantProvider` injects the tenant's `brand_primary_color` onto `<html>` as `--brand`, so the
    whole UI re-themes from one variable (proven: setting it to red turned the wordmark red).
  - **Logo:** sidebar renders `logo_url` (from useTenant) if set, else the firm-name wordmark.
  - **Config:** `tenant_settings.brand_primary_color` + `logo_url` (migration
    `supabase/tenant_settings_branding.sql`); surfaced via `getTenantConfig().brandColor/logoUrl`
    and `/api/auth/me`. Editable in the **onboarding wizard** (color picker + logo URL) and on
    **/brand-voice → Brand settings** (synced to tenant_settings).
  - KM unchanged: defaults to `#185FA5` + firm-name wordmark when columns are null.
  - **Apply migration:** `supabase/tenant_settings_branding.sql` (until then theming defaults to
    `#185FA5` gracefully; saving a custom color/logo errors).

- **Workstream D (onboarding wizard) — delivered (2026-06-14).** Verified `tsc` clean + renders
  chromeless + prefills + no console errors.
  - New `/onboarding` 4-step wizard (`app/onboarding/page.tsx`): (1) firm identity incl. PR
    spokesperson, (2) SEO domain + GSC URL (auto-derived from the website), (3) practice areas +
    brand voice + tone, (4) AI-generated content system prompt (reuses `/api/brand-voice/
    system-prompt` generate + save). Chromeless (added to `NO_CHROME_PATHS`).
  - New `POST /api/onboarding` persists the profile in one call via `getTenantDb` (RLS, tenant_id
    auto-stamped): `tenant_settings` (identity + domains + geography + spokesperson + practice_areas
    jsonb), a `brand_voice_settings` mirror (so `getFirmContext` picks up identity + voice), and the
    `practice_areas` table (replace-all → content gen uses them).
  - Signup now redirects new firms to `/onboarding` (was `/`). Practice areas are NOT prefilled (a
    new firm starts blank rather than inheriting KM's defaults); identity/voice prefill from
    existing settings so re-running is safe.
  - Verified: `/onboarding` renders with no sidebar, firmName prefilled, step 2 auto-derives
    `semrush_domain`/`gsc_site_url` from the website. (Save/generate not triggered in test to avoid
    mutating the live KM tenant; endpoint is tsc-clean and uses the verified getTenantDb pattern.)

- **Workstream E (domain knowledge) — core delivered (2026-06-14).** Verified `tsc` clean + new
  UI/endpoints load + no console errors.
  - **System-prompt generator + editor (the E keystone).** New `lib/system-prompt-generator.ts`
    (`generateSystemPrompt()` — Claude writes a firm-specific content system prompt from the firm
    profile), `app/api/brand-voice/system-prompt` (GET saved/effective/isDefault, PUT save, POST
    generate), and a new **"System prompt" tab** on `/brand-voice` (Generate from firm profile →
    review/edit → Save to `tenant_settings.system_prompt`). Empty = built-in default. **KM keeps its
    hand-written `KM_SYSTEM_PROMPT`** (Option A) — verified: KM's GET returns `isDefault:true`,
    `saved:null`, effective = the 17K-char KM literal. New firms generate their own.
  - **pr-pitches generalized.** Both `pr-pitches` routes are now firm-agnostic: firm name + practice
    areas come from config/firm-context (not the hardcoded employment list), and the attorney
    attribution uses a new per-tenant **`firm_spokesperson`** field (migration
    `supabase/tenant_settings_spokesperson.sql`; seeded to "Kenneth Katz, Partner at Katz Melinger
    PLLC" for KM). Editable on `/brand-voice` (Brand settings), synced to `tenant_settings`, exposed
    via `getTenantConfig().firmSpokesperson`. The "don't use pr-pitches for another firm" caveat is
    resolved.
  - `lib/strategy-engine.ts` `CLAUDE_JUDGE_SYSTEM` — firm name genericized.
  - **Still in E (deferred, genuinely bigger):** `lib/sales-coach*.ts` is a KM-specific feature
    (its entire rubric + SOPs are KM's) — generalizing means per-firm SOP/rubric upload, a product
    feature, not a string swap. The strategy-engine's employment/collections content MODEL +
    `KM_STRUCTURES` remain KM-shaped (a firm in another practice area still gets KM-style routing).
    Compliance (`state_rules`/`disclaimers`) is per-tenant already but not audited end-to-end.
  - **Apply migration:** run `supabase/tenant_settings_spokesperson.sql` (adds `firm_spokesperson`).
    Until then, config falls back gracefully (KM gets its seeded default; others get blank).

- **AEO tenant-scoping — VERIFIED already fixed + hardened (2026-06-14).** The earlier "no
  tenant_id column" flag was a false alarm (it read only the base `geo_alerts_schema.sql`, missing
  the migrations). Actual state:
  - `tenant_id` column is **live** on `aeo_targets`/`aeo_prompts` (`multitenancy_phase1_schema.sql`,
    backfilled to KM — verified against the DB: 0 nulls, all rows = KM tenant).
  - Tenant-scoped RLS + `(tenant_id, type, domain)` constraint in `multitenancy_phase4_aeo.sql`.
  - Code already scopes: `lib/aeo-runner.ts` + `lib/alerts-engine.ts` thread `tenantId`; routes use
    the RLS-enforced `getTenantClient()`; the weekly cron (`app/api/aeo/runs/start` GET) loops
    `listTenantIds()` → per-tenant sweeps.
  - **Added defense-in-depth:** explicit `.eq("tenant_id", tenantId)` on all AEO read/mutate routes
    (`aeo/targets`, `aeo/prompts`, their `[id]` PATCH/DELETE, `aeo/dashboard`) so isolation holds
    even if the `phase4_aeo` RLS migration hasn't been applied to a given environment. Verified:
    `tsc` clean; routes return 200 with KM-scoped data (2 targets, 10 prompts).
  - Follow-ups (optional): confirm `multitenancy_phase4_aeo.sql` is applied in prod; consider
    seeding a `self` AEO target (the firm's own domain) in `lib/tenant-provision.ts` so a new firm
    starts with a tracked self-target instead of an empty AEO dashboard.

---

## TL;DR — where we actually are

The hard part is largely done. The repo already has:

- **Real multi-tenancy** — `tenants` + `app_users.tenant_id`, per-request `resolveTenantId()`,
  RLS migrations through Phase 4, per-tenant DB helpers (`lib/tenant-db.ts`).
- **Self-serve signup** — `POST /api/signup` + `app/signup/page.tsx` provision a tenant, an admin
  user, and a `tenant_settings` row, then auto-login.
- **A tenant config layer** — `lib/tenant-config.ts` resolves firm name/address/contact/geography/
  practice-areas/pillars/system-prompt per tenant, falling back to constants.
- **A provider-registry pattern that already works for CRM** — `lib/crm/registry.ts` +
  `lib/crm/providers/*` (Clio, Lawmatics, Litify, internal CMS) selected by env or
  `resolveCrmProvider(preferredId)`. This is the template to copy for every other vendor.
- **A drop-in SEO provider swap** — `lib/dataforseo.ts` mirrors `lib/semrush.ts`'s interface.
- **A pluggable transactional-messaging layer** — `lib/messaging/*` (Resend, Twilio behind a
  `MessagingAdapter` interface).

So this is **not** a rewrite. It's three things: (1) scrub KM-specific defaults/strings,
(2) generalize the two integrations still hard-wired to one vendor (marketing email, social),
(3) add branding + a real onboarding wizard so a firm can self-configure.

---

## The mental model going forward

Every tenant-specific value falls into one of three buckets. When adding any feature, ask which
bucket each value is in:

1. **Firm identity** — name, address, phone, email, website, logo, colors, geography, practice
   areas. Source of truth: `tenant_settings` (+ `brand_voice_settings`). Never hardcode.
2. **Vendor choice + credentials** — which email/social/SEO/CRM provider this firm uses and its
   keys/tokens. Source of truth: a `*_provider` column in `tenant_settings` + per-tenant token
   rows (like `constant_contact_tokens` / `oauth_tokens`). Resolve through a registry, never
   import one vendor directly from a route.
3. **Domain knowledge** — the content system prompt, statutes, content structures, compliance
   rules. Today these are employment-law/KM-specific literals. Generalize into templates with
   firm-identity variables interpolated, defaulting to a neutral baseline for non-KM tenants.

KM stays as the seeded default tenant (`DEFAULT_TENANT_ID = 0000…0001`) and keeps behaving
exactly as today — that's our regression baseline. New tenants get neutral defaults.

---

## Workstream A — Scrub KM-specific defaults & strings

Most of these are one-line changes from a hardcoded literal to a `getTenantConfig()` /
`getFirmContext()` read. Grouped by risk.

### A1. User-facing branding (highest visibility, do first)
- `app/layout.tsx:17,19` — root `<title>`/description hardcoded "KatzMelinger Marketing".
- `app/page.tsx:41,43,58` — dashboard title + visible "Katz Melinger PLLC ·" subtitle.
- `components/marketing-sidebar.tsx:102` — sidebar wordmark "KatzMelinger".
- `app/login/page.tsx:91` — login `<h1>` "KatzMelinger Marketing".
- Per-hub metadata titles "… | Katz Melinger PLLC": `app/social/page.tsx:19,21`,
  `app/seo/page.tsx:17`, `app/campaigns/page.tsx:18,20`, `app/ai/page.tsx:18`,
  `app/executive/page.tsx:9`, `app/attribution/page.tsx:11`,
  `app/seo/competitors/[domain]/page.tsx:9`.
  → Replace with a shared `generateMetadata()` helper that reads the resolved tenant's
  `firmName` (and a product name like `appName`).

### A2. Brand color `#185FA5`
- Hardcoded as Tailwind arbitrary values (`text-[#185FA5]`, `bg-[#185FA5]`, `focus:ring-[#185FA5]`)
  across ~86 files.
  → Introduce a CSS variable `--brand-primary` (set on `<html>`/`<body>` from
  `tenant_settings.brand_primary_color`) and a Tailwind token (e.g. `text-brand`, `bg-brand`).
  Do this as a mechanical find-and-replace once the token exists. Default = `#185FA5` so KM
  is unchanged.

### A3. Firm contact fallbacks
- `lib/firm-context.ts:53-59` (`DEFAULT_CONTACT`) and `lib/tenant-config.ts:52-59` (`FALLBACK`)
  hardcode KM's address/phone/email/website/geography.
  → Keep these ONLY behind the `DEFAULT_TENANT_ID` guard (firm-context already does this for the
  fallback *context*; extend the same guard to the contact constants). Non-KM tenants get blanks,
  and the prompt already forbids fabricating contact info.

### A4. AI system prompts with KM baked in
These embed "Katz Melinger PLLC" / "katzmelinger.com" / "plaintiff-side employment law" directly:
- `lib/km-content-system.ts:336-547` (`KM_SYSTEM_PROMPT`, structures, pillars) — the big one.
- `lib/strategy-engine.ts:295,376-384` (judge prompt + meta title/description templates).
- `app/api/content/draft/route.ts:173`
- `app/api/seo/pr-pitches/route.ts:58`, `app/api/seo/pr-pitches/screen/route.ts:71`
- `app/api/seo/briefs/meta/route.ts:62`
- `app/api/content/intelligence/metadata/route.ts:31`
- `app/api/keyword-research/discover/start/route.ts:57`
- `components/km-brief-wizard.tsx:121,444` (meta title `… | Katz Melinger PLLC`)
  → Route all of these through `getFirmContext(tenantId)` / `getTenantConfig()` so the firm name,
  domain, geography, and practice areas come from config. The literal KM prompt becomes the
  *seeded default* for the KM tenant's `tenant_settings.system_prompt`, not a code constant other
  tenants inherit.

### A5. Hardcoded default domains/URLs
- `lib/semrush.ts:23-24`, `lib/dataforseo.ts:31-34` — `SEMRUSH_DOMAIN/DATABASE` = katzmelinger.com/us.
- `lib/gsc-site-url.ts:4,24` — defaults to `https://katzmelinger.com/`.
- Default `useState("https://www.katzmelinger.com")` in: `app/ai-search/page.tsx:240`,
  `app/llms-txt/page.tsx:24`, `app/seo/technical/page.tsx:98`, `app/seo/internal-links/page.tsx:31`.
- Placeholders: `app/admin/users/page.tsx:156` (`teammate@katzmelinger.com`),
  `app/brand-voice/page.tsx:113-138`, `app/seo/citations/page.tsx:270`,
  `app/content/page.tsx:17` (`DEFAULT_BRAND_VOICE`).
  → Domains: read from `getTenantConfig().semrushDomain` / `.firmWebsite` / `.gscSiteUrl`.
  Client pages should hydrate defaults from the tenant config API rather than a string literal.
  Placeholders should be generic ("you@yourfirm.com", "Your Firm LLP").

---

## Workstream B — Make every integration swappable per tenant

Copy the **CRM registry pattern** (`lib/crm/registry.ts`) to the categories still hard-wired.
Each gets: an interface, a `providers/` folder, a registry resolver, a `*_provider` column in
`tenant_settings`, and per-tenant credential storage.

### B1. Email distribution (currently LOCKED to Constant Contact) — top priority per the ask
- Today: `lib/constant-contact-server.ts` + `app/api/constant-contact/*` + `app/api/email/*` +
  `app/email/page.tsx` all call Constant Contact directly. OAuth tokens *are* already tenant-scoped
  (`constant_contact_tokens` keyed by `tenant_id`), so the storage is future-proof — only the
  selection/abstraction is missing.
- Plan:
  1. Define `EmailProvider` interface (`lib/email/types.ts`): `isAvailable()`, `listLists()`,
     `createCampaign()`, `sendCampaign()`, `getCampaignAnalytics()`, OAuth start/callback hooks.
  2. Wrap Constant Contact as the first provider (`lib/email/providers/constant-contact.ts`).
  3. Add `lib/email/registry.ts` with `resolveEmailProvider(tenantId)` reading
     `tenant_settings.email_provider`.
  4. Add `email_provider` column to `tenant_settings`.
  5. Point `app/email/page.tsx` + the email API routes at the resolver.
  6. Add a second provider to prove the seam — **Mailchimp or SendGrid Marketing** are the
     natural next two for law firms. (Note: the existing `lib/messaging/*` Resend/Twilio layer is
     *transactional*; keep it separate from this *marketing/distribution* layer.)

### B2. Social publishing (Ayrshare) + analytics (Metricool)
- Ayrshare already takes a per-tenant `ayrshareProfileKey` — half abstracted. Wrap behind a
  `SocialPublishProvider` interface; add `social_publish_provider` column. Candidate alt: Later /
  Sprout / Buffer.
- Metricool bakes 3 env vars into every call (`lib/metricool.ts:6-29`) — no per-tenant path.
  Wrap behind `SocialAnalyticsProvider`; add `social_analytics_provider` + per-tenant cred storage.

### B3. SEO data (Semrush ↔ DataForSEO)
- Interfaces already match. Just add `seo_provider` column + a thin `resolveSeoProvider()` so the
  choice is runtime/per-tenant instead of compile-time (which import a caller picks).

### B4. CRM — finish the wiring that's 90% there
- `resolveCrmProvider(preferredId)` already accepts a preference, but there's **no
  `crm_provider` column** in `tenant_settings` to feed it. Add the column and pass it in. Then the
  Clio/Lawmatics/Litify stubs just need real implementations per signed customer.

### B5. Per-tenant credential storage (cross-cutting)
- Today most third-party keys are global env vars (Semrush, Metricool, CallRail, Google SA,
  Anthropic). For true SaaS, firm-specific keys belong per tenant. Add an encrypted
  `tenant_secrets` table (or reuse the OAuth-token pattern) so each firm supplies its own keys
  where it makes sense (their Semrush seat, their CallRail, their GA4). Keep platform-shared keys
  (Anthropic) global. Decide per-integration: shared platform account vs. firm-supplied.

---

## Workstream C — Branding & theming (net-new)

Add to `tenant_settings`: `app_name`, `logo_url`, `favicon_url`, `brand_primary_color`,
`brand_secondary_color`, `custom_domain`.

- Storage: a `branding` bucket in Supabase Storage for logo/favicon uploads.
- Injection: a root layout / middleware that reads the resolved tenant's branding and sets the
  CSS variables (pairs with A2) + swaps logo/wordmark/favicon/`<title>`.
- Custom domain: map a firm's domain → tenant (the `resolveTenantIdByDomain()` helper already does
  host→tenant lookup; extend it to a `custom_domain` column and wire it into middleware).

---

## Decision — system prompt: wizard → AI-generated, saved, editable (2026-06-14)

For per-firm content domain knowledge (the system prompt), the chosen approach is:
**onboarding wizard collects firm answers → Claude generates a first-draft system prompt →
saved to `tenant_settings.system_prompt` → firm can edit it in a textarea.** Once saved it's a
static string (stable + predictable), not re-templated on every call.

- Rejected: a single generic template with variable slots — practice areas differ too much across
  firm types for one instruction set to serve all (an immigration firm needs different instructions
  than KM, not just a name swap).
- **KM stays on Option A:** KM keeps its existing hand-written `KM_SYSTEM_PROMPT` literal as its
  saved prompt. KM never runs the wizard or the generator. Only *new* firms get the generated path.
- Build order: wizard Layer 1 (collect identity → `tenant_settings`) is foundational and feeds the
  branding work too; Layer 2 (AI-generate the prompt) sits on top and is added last.

## Workstream D — Onboarding wizard (net-new)

Signup currently collects only firm name / email / password, then drops the new firm into KM
defaults until someone hand-edits settings. Add a post-signup wizard (`/onboarding`) that collects:

1. Firm identity — legal name, address, phone, email, website, logo upload, brand color.
2. Practice areas + target geography (seeds `practice_areas`, `target_geography`).
3. SEO domain + GSC site URL (seeds `semrush_domain`, `gsc_site_url`).
4. Brand voice / tone (seeds `brand_voice_settings`).
5. Integration connect screen — reuse `/api/integrations/status` to walk them through connecting
   email/social/SEO/CRM/Google, each with a Connect button.

Also: build a **System Prompt editor** UI (today `tenant_settings.system_prompt` is editable only
by direct DB edit) and surface the existing Semrush-domain / GSC / Ayrshare fields in the UI.

---

## Workstream E — Generalize domain knowledge (largest, do last)

- `KM_SYSTEM_PROMPT` and `KM_STRUCTURES` (`lib/km-content-system.ts`) are employment/collections-law
  specific. Refactor into a **template** with `{{firmName}} {{geography}} {{practiceAreas}}
  {{statutes}}` placeholders + a neutral default content structure, so a firm in a different
  practice area gets sensible output without editing a 200-line prompt.
- Compliance: `lib/compliance-core.ts` / `lib/ads-compliance.ts` encode attorney-advertising rules
  — verify they're jurisdiction-parameterized (the `state_rules` / disclaimers tables suggest the
  per-tenant scaffolding exists; confirm and seed per state).

---

## Suggested sequencing

1. **A1 + A2 + A3** — strip visible KM branding, themeable color, contact fallbacks behind the
   default-tenant guard. Cheap, high signal, makes demos look generic immediately.
2. **B1 (email registry + 2nd provider)** — directly answers the stated goal ("Constant Contact
   should be email distribution" → make it *one* distribution option).
3. **C + D** — branding columns + onboarding wizard so a firm can actually self-serve.
4. **A4 + E** — generalize the prompts/domain knowledge (biggest, but KM keeps working throughout
   via the seeded default).
5. **B2/B3/B4/B5** — round out social/SEO/CRM provider selection + per-tenant credentials.

## Guardrails

- KM (`DEFAULT_TENANT_ID`) is the regression baseline: every change must leave the KM tenant
  byte-for-byte identical in behavior. Gate KM-specific defaults behind that ID.
- Don't import a vendor directly from a route ever again — always go through a registry resolver.
- Naming: `km-content-system.ts`, `km-brief-wizard.tsx`, `katz-cms.ts`, the `KM_` prefixes, and
  the repo/folder name `katz-melinger-marketing` are KM-flavored. Renaming is optional cosmetic
  cleanup; functionally harmless to defer, but worth a pass before this is sold as a product.
