# Website Builder & Publisher — Roadmap

**Goal:** Extend MarketOS so it can **(A) update existing law-firm websites** (push content + on-page fixes live) and **(B) create new law-firm websites** from scratch — as a multi-tenant, sellable product.

**Status:** Roadmap / scoping. Drafted 2026-06-13. Ties into the productization goal and the [autonomous content agent plan](autonomous-content-agent-plan.md) (which produces the approved drafts these features publish).

---

## Where we are today

MarketOS *drafts and recommends*; it does not *publish or host*. Concretely:

| Capability | State | File |
|---|---|---|
| Content drafting + approval pipeline | ✓ | `content_drafts`, `content_pipeline` |
| On-page fix queue (meta/schema/H1/links/alt) | ✓ (WordPress only, via plugin) | `lib/wp-autopilot.ts`, `app/api/wp/` |
| WordPress read | ✓ read-only | `lib/wordpress.ts` |
| Site crawl / inventory | ✓ read-only | `lib/site-inventory.ts` |
| Image generation | ✓ (stored in Supabase, not published) | `app/api/images/generate/route.ts` |
| Schema/JSON-LD generation | ✓ (queued, not emitted) | `lib/schema-templates.ts` |
| Multi-tenant data isolation | ✓ (RLS by `tenant_id`) | most schema files |
| GA4 / Search Console / CallRail | ✓ integrated | analytics + calls modules |
| **Publish new pages/posts to a site** | ✗ | — |
| **Build/host an actual website** | ✗ | — |

**Known productization blockers (from prior notes):** hardcoded `SEMRUSH_DOMAIN = "katzmelinger.com"` ([lib/semrush.ts:23](lib/semrush.ts)) and other single-tenant assumptions must be made per-tenant before reselling. A separate `katz-melinger-cms` app exists behind a proxy ([app/api/cms/route.ts](app/api/cms/route.ts)) — its build-out level should be confirmed before deciding build-vs-buy.

---

## Track A — Update existing law-firm websites

Push approved drafts and on-page fixes onto a firm's *existing* site (mostly WordPress). Reuses the AutoPilot plumbing. Smaller, faster, monetizable first.

### A1. Per-firm site connections (foundation)
- A `site_connections` table: tenant_id, platform (`wordpress` | other), base_url, auth (WP application password or AutoPilot token), status.
- The AutoPilot token table already scopes by domain — generalize it so any firm can connect their own site, not just katzmelinger.com.
- Connection test + health check UI.

### A2. WordPress write client
- New write client (today `lib/wordpress.ts` is read-only): create/update **posts** and **pages** via `/wp-json/wp/v2/`, set status (draft/publish), categories, tags, slug, excerpt.
- Auth via WP application passwords per `site_connections` row.

### A3. Publish endpoint
- `POST /api/content/drafts/[id]/publish` — gate on `review → published`, push title + body (markdown→HTML) + meta to the connected site, store the returned live URL on the draft/pipeline row, then call the existing site-inventory ingest to refresh the cluster map.
- Mirror the AutoPilot "applied" audit pattern for a publish log.

### A4. Image publishing
- Upload generated images (currently Supabase-only) into the firm's WP media library; rewrite image URLs in the body to the published media URLs.

### A5. On-page fixes, generalized
- AutoPilot already produces meta/schema/canonical/H1/internal-link/alt fixes — extend it past katzmelinger to any connected firm, and surface "apply" status per firm.

**Outcome of Track A:** the firm (or you, as their agency) approves a draft in MarketOS and it goes live on their WordPress site, images and SEO metadata included — plus ongoing on-page optimization.

---

## Track B — Create new law-firm websites

Stand up a brand-new site for a firm. Two strategic options — pick one (see decision below).

### Option B-1 — MarketOS-hosted Next.js sites (recommended for SaaS)
MarketOS renders and hosts the public sites itself; content lives in the DB you already have.
- **Site templates/themes** tuned for law firms (practice-area pages, attorney bios, case results, blog, contact/intake). A small set of configurable themes.
- **Section/block system** so pages are composed from reusable blocks (hero, services, FAQ, testimonials, CTA) — drafts today are markdown-only with no layout.
- **Public rendering layer** — today the app is 100% authenticated admin with no public routes. Add a public frontend with `[slug]` + tenant-by-domain routing.
- **Custom domains + SSL** — domain mapping per tenant, automated certs (Vercel domains API or equivalent).
- **SEO output** — generate `sitemap.xml`, `robots.txt`, canonical/meta tags, JSON-LD per page (all currently absent on the output side).
- **Forms / intake** — wire site forms to the existing intake/CMS (`app/api/cms/route.ts`) and CallRail.
- **Analytics injection** — drop in GA4 (already integrated for reporting).
- **Media/CDN** — serve generated/uploaded images via a public bucket/CDN.

### Option B-2 — Provision WordPress sites
Spin up a managed WordPress per firm, install a theme, then publish via Track A's write client. Familiar to law firms, but heavy ops (hosting, updates, security, plugins) and weaker as a clean SaaS margin.

### Decision: B-1 vs B-2
- **B-1** is the better *product*: higher margin, full control of performance/SEO/design, multi-tenant by construction, and it reuses your existing DB + content + analytics stack. Bigger up-front build.
- **B-2** is faster to a first sale and matches what firms already know, but it's an ops business, not a software margin.
- Recommendation: **B-1** for the productization goal, but Track A (publish to existing WP) ships value first and validates demand before committing to B-1's build.

---

## Cross-cutting (needed for both tracks, required to resell)

- **De-single-tenant the codebase** — replace hardcoded `SEMRUSH_DOMAIN` and any other firm-specific constants with per-tenant config. This gates everything.
- **Onboarding flow** — add a firm, connect/build their site, set practice areas, brand voice, integrations.
- **Billing / plans** — per-firm subscription tiers.
- **Per-tenant API keys vs. agency keys** — decide whether each firm brings their own Semrush/Anthropic/etc. keys or you operate with yours and meter usage.
- **Roles/permissions** — firm users vs. agency (you) vs. admin.

---

## Suggested sequence

1. **Track A (A1–A5)** — publish-to-existing-WordPress. Ships real value, reuses AutoPilot, validates willingness to pay. *(~weeks)*
2. **Cross-cutting de-single-tenant + onboarding + billing.** *(gates resale)*
3. **Track B Option B-1** — the hosted site builder, once Track A proves demand. *(largest effort; effectively the flagship product)*

The [autonomous content agent](autonomous-content-agent-plan.md) plugs in at the top of both: it keeps each firm's draft queue full; Tracks A/B turn approved drafts into live pages.

---

## Open questions

- **Build vs. reuse the CMS:** how complete is the existing `katz-melinger-cms` app? Could it become the B-1 rendering layer instead of building fresh?
- **Platform coverage for Track A:** WordPress only at first, or do prospect firms use Squarespace/Wix/Webflow (which would need different write clients)?
- **Migration:** when onboarding a firm with an existing site, do we migrate their content into MarketOS, or only manage net-new pages?
- **Hosting model for B-1:** Vercel multi-tenant, or per-firm deploys? Affects domains, cost, and isolation.
