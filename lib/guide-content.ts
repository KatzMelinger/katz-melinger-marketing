/**
 * Guide content — the source text rendered by the in-app Guide page
 * (`app/guide/page.tsx`).
 *
 * The Guide's STRUCTURE (which sections/items exist, their order and grouping)
 * is derived at render time from `SIDEBAR_SECTIONS` in `lib/departments.ts`, so
 * the Guide can never drift out of sync with the actual sidebar. This module
 * only supplies the prose for each item, keyed by the item's `href`.
 *
 * When a new route is added to the sidebar, it automatically appears in the
 * Guide; until an entry is added here it renders with a gentle "description
 * coming soon" fallback rather than breaking. Keep blurbs to one sentence each.
 */

export type GuideEntry = {
  /** One-sentence, plain-English description of what the section does. */
  whatItIs: string;
  /** One-sentence "how to use it" pointer to the primary action. */
  howToUse: string;
};

/** Keyed by the sidebar item's `href`. */
export const GUIDE_ENTRIES: Record<string, GuideEntry> = {
  "/agent": {
    whatItIs:
      "Peggy is the app's built-in Claude-powered marketing assistant — it reasons over trending topics, content ideas, keyword status, and your recommendations.",
    howToUse:
      "Ask plain-language questions about what's trending, your top recommendations, or the next step on any content project.",
  },
  "/content-production": {
    whatItIs:
      "The unified production board for the whole content pipeline: opportunities, briefs in progress, drafts awaiting approval, and published pieces.",
    howToUse:
      "Move cards across the columns to track each piece from idea through approval to launch; open a card to review or approve the draft.",
  },
  "/recommendations": {
    whatItIs:
      "Claude-generated action items across SEO, AEO, content, technical, local, and social — each scored by effort and impact.",
    howToUse:
      "Work the active list, mark items Done / Hold / Disregard, or generate a fresh batch against the latest metrics.",
  },
  "/seo/recent": {
    whatItIs:
      "A rolling timeline of ranking changes, new backlinks, technical alerts, and other SEO events across every tracked surface.",
    howToUse:
      "Scan the feed to spot trends and quick wins — the highest-leverage changes surface first.",
  },
  "/seo": {
    whatItIs:
      "The SEO hub that aggregates keyword tracking, backlinks, competitors, technical health, and the content pipeline in one landing page.",
    howToUse:
      "Click any sub-area card to drill into the keyword tracker, technical audit, competitor intel, or content production.",
  },
  "/content/site-map": {
    whatItIs:
      "Site Inventory — every page on the site crawled from the sitemap, grouped by pillar and practice area so you know what already exists.",
    howToUse:
      "Search or filter by pillar to see existing content and spot gaps before drafting anything new.",
  },
  "/seo/keywords": {
    whatItIs:
      "The keyword tracker: position, search volume, estimated traffic, and movement over time for every target keyword, with AI Overview signals.",
    howToUse:
      "Add keywords to track, sort by position or traffic, filter by geo/cluster, and prune the target list as strategy shifts.",
  },
  "/keyword-research": {
    whatItIs:
      "A four-tab research hub — Discover new keywords by intent, Expand clusters, find Competitor Gaps, and review what's already Tracked.",
    howToUse:
      "Use Discover to brainstorm, Gaps to find competitor openings, then deep-link a promising keyword straight into content creation.",
  },
  "/seo/topical-maps": {
    whatItIs:
      "A pillar-centered visual map of your keyword clusters, color-coded by ranking (green = top 10, amber = 11–30, red = unranked).",
    howToUse:
      "Click a keyword node to see its rank history and jump directly to drafting an article for that cluster.",
  },
  "/seo/competitors": {
    whatItIs:
      "A side-by-side tracker of the competitor domains you monitor — keyword overlap, backlinks, and content cadence.",
    howToUse:
      "Manage your tracked competitor list and add new domains from the top-organic-competitor suggestions.",
  },
  "/seo/competitor-gaps": {
    whatItIs:
      "Keywords your tracked competitors rank for that you don't (or rank worse on), sorted by opportunity score.",
    howToUse:
      "Scan the sorted gaps and turn the highest-scoring ones into brief-creation projects.",
  },
  "/search-console": {
    whatItIs:
      "Your Google Search Console data — clicks, impressions, CTR, and average position by query and page.",
    howToUse:
      "Filter by date range and query to see what Google already shows you for, and where better CTR is within reach.",
  },
  "/aeo": {
    whatItIs:
      "AEO & AI Search — track how often the firm is cited by answer engines (ChatGPT, Perplexity, Claude, Gemini) and score AI-search readiness.",
    howToUse:
      "Check your citation rate and AEO score, then run fresh prompts to see how the firm shows up in AI answers.",
  },
  "/ai/referrals": {
    whatItIs:
      "A GA4-sourced view of sessions arriving from AI answer engines (ChatGPT, Claude, Perplexity, Gemini, Copilot) over the last 30 days.",
    howToUse:
      "Track AI-attributed traffic trends and line spikes up against your content updates and AEO improvements.",
  },
  "/ai/bot-traffic": {
    whatItIs:
      "Crawl logs showing AI bots (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) hitting your site.",
    howToUse:
      "After connecting log ingest (WordPress plugin or server logs), monitor which bots crawl what, and how often.",
  },
  "/llms-txt": {
    whatItIs:
      "A generator for the /llms.txt manifest that tells AI crawlers which content to read, grouped by practice area.",
    howToUse:
      "Generate from your sitemap, review the sections, copy the file to your site root, and track versions over time.",
  },
  "/prompts": {
    whatItIs:
      "The workspace for authoring and versioning the prompts that power the content, AEO, and recommendation pipelines.",
    howToUse:
      "Create a prompt project, edit its text and variables, and run test executions to preview Claude's output.",
  },
  "/seo/technical": {
    whatItIs:
      "Technical SEO — Core Web Vitals, schema coverage, crawl errors, and mobile/desktop performance from cached PageSpeed runs.",
    howToUse:
      "Re-scan for fresh metrics, review what's healthy vs. critical, and queue fixes to the WordPress plugin.",
  },
  "/seo/cannibalization": {
    whatItIs:
      "Spots queries where two or more of your URLs compete for the same keyword, grouped by severity with fix suggestions.",
    howToUse:
      "Work the high-severity issues first — consolidate the duplicate URLs or re-target the weaker page.",
  },
  "/seo/schema-generator": {
    whatItIs:
      "Curated Schema.org templates (FAQ, Product, Breadcrumb, and more) that you fill in and Claude composes into JSON-LD.",
    howToUse:
      "Pick a template, complete the form, preview the JSON-LD, and queue it to the WordPress plugin for injection.",
  },
  "/seo/internal-links": {
    whatItIs:
      "A crawl-based audit of your internal link graph — orphan pages, thin pages, and your strongest hub pages.",
    howToUse:
      "Run the crawl, review the audit, and override pillar assignments where the crawl guessed wrong.",
  },
  "/local-seo": {
    whatItIs:
      "Local SEO / GBP — Google Business Profile presence, local-pack rankings, review aggregation, and neighborhood visibility.",
    howToUse:
      "Manage GBP settings, view rankings by ZIP, respond to reviews, and keep an eye on local citations.",
  },
  "/seo/directories": {
    whatItIs:
      "A tracker for your claimed profiles across legal and business directories, with status and priority per listing.",
    howToUse:
      "Add directories manually or use Suggest for AI picks, then update status as you claim and optimize each one.",
  },
  "/seo/citations": {
    whatItIs:
      "A NAP (Name / Address / Phone) consistency tracker that flags drift from your canonical details across listings.",
    howToUse:
      "Paste a listing to audit its NAP, save the finding, and flag inconsistencies to fix across directories.",
  },
  "/content/refresh": {
    whatItIs:
      "The Refresh Queue — pages flagged as decay candidates (often positions 11–30, the highest ROI to refresh).",
    howToUse:
      "Approve a refresh to send the page back into the content pipeline as a brief for the writing team.",
  },
  "/content": {
    whatItIs:
      "Content Studio — AI-generated drafts for Website, Social, and Email using your brand voice and SEO guidance.",
    howToUse:
      "Pick a content type, set the topic and practice area, generate a draft, and it auto-saves to the library for review.",
  },
  "/content/drafts": {
    whatItIs:
      "Content Approvals — the searchable library of every generated draft, with readability, keyword density, AEO, and brand-voice analysis.",
    howToUse:
      "Search a draft, run analysis, apply suggested edits, then mark it approved or archived (export to .docx if needed).",
  },
  "/seo/pr-pitches": {
    whatItIs:
      "Paste a HARO query, journalist email, or SourceBottle request and Claude scores the fit and drafts a response.",
    howToUse:
      "Paste the query, review the drafted pitch, and send it to the journalist or save it for team review.",
  },
  "/ads": {
    whatItIs:
      "Paid Ads — a five-tab dashboard: Overview, Compliance (Claude reviews ad copy), Creatives, Keywords, and Connections.",
    howToUse:
      "Connect Google Ads / Meta / LinkedIn, run compliance checks, manage the shared negative-keyword list, and track performance.",
  },
  "/forms": {
    whatItIs:
      "Web-form and CallRail form submissions aggregated with date filters, source tracking, and lead-status labels.",
    howToUse:
      "Sync from CallRail, filter by date and source, and review submission detail to track form performance.",
  },
  "/social/content-calendar": {
    whatItIs:
      "A month and week grid of every scheduled and published social post across all channels, color-coded by platform.",
    howToUse:
      "Switch between Month and Week views and click a post to see its detail, cadence, and platform mix.",
  },
  "/social/kpi-tracker": {
    whatItIs:
      "Last-30-day reach, engagement rate, followers, and post counts across all channels, with a per-platform breakdown.",
    howToUse:
      "Review the aggregate numbers and compare performance across Instagram, Facebook, LinkedIn, and TikTok.",
  },
  "/social/trends-performance": {
    whatItIs:
      "Your best-performing formats and top posts, plus the audience demographics and trending topics you curate.",
    howToUse:
      "Edit your audience and Hot / Warm / Growing topics, and see which content formats are winning.",
  },
  "/social/best-time": {
    whatItIs:
      "An engagement heatmap by day and hour (NY time) built from your post history, with the top time slots highlighted.",
    howToUse:
      "Read the heatmap per channel to find your highest-engagement windows; weigh the cell count for confidence.",
  },
  "/social/hashtag-performance": {
    whatItIs:
      "Your top-performing Instagram hashtags by reach versus the generic, over-competitive tags worth dropping.",
    howToUse:
      "Compare tag performance, drop the over-competitive ones, and adopt the suggested set for your next post.",
  },
  "/social/competitor-tracking": {
    whatItIs:
      "Head-to-head benchmarking of competitor firm accounts on Instagram and LinkedIn against your own.",
    howToUse:
      "Configure competitors in Metricool, then compare followers, posts, and engagement rate side by side.",
  },
  "/social/trends": {
    whatItIs:
      "Claude-generated trending topics for your practice areas plus per-platform playbooks (hashtags, hooks, captions).",
    howToUse:
      "Review the trends, use the platform playbooks for post ideas, and save a run to reference later.",
  },
  "/community": {
    whatItIs:
      "A monitor for Reddit, Hacker News, news, Quora, YouTube, TikTok, and Avvo where you can catch and reply to mentions.",
    howToUse:
      "Scan the channels daily, draft a Claude-powered reply, and mark each item Responded or Skipped.",
  },
  "/reviews": {
    whatItIs:
      "Aggregated Google and third-party reviews with response tracking, a rating snapshot, and a platform breakdown.",
    howToUse:
      "Filter by platform, respond to feedback directly, and watch your rating trend over time.",
  },
  "/social/analytics": {
    whatItIs:
      "A Metricool-backed dashboard with follower counts, engagement, posts, top content, and a scheduling preview.",
    howToUse:
      "Review the detailed analytics, compare networks, and dig into per-post performance.",
  },
  "/email": {
    whatItIs:
      "The Constant Contact integration — campaigns, open / click / bounce rates, contacts, and list growth.",
    howToUse:
      "Pick a list, review the aggregate metrics, and drill into individual campaigns by type.",
  },
  "/calls": {
    whatItIs:
      "The CallRail call log — duration, agent, status (answered / voicemail / missed), lead status, and per-call scoring.",
    howToUse:
      "Filter by agent, date, or lead status, and review call detail and scoring to coach on quality.",
  },
  "/lead-response": {
    whatItIs:
      "Lead-leakage analysis: missed first contacts, recovery rate, lost leads, after-hours gaps, and estimated lost revenue.",
    howToUse:
      "See where leads slip through, which sources leak most, and plan staffing around the gaps.",
  },
  "/coaching": {
    whatItIs:
      "A call-scoring framework aligned to NY/NJ bar rules; Claude evaluates recorded calls and writes coaching feedback.",
    howToUse:
      "Connect or upload calls, review the rubric scoring, and coach agents on compliance and quality.",
  },
  "/pipeline": {
    whatItIs:
      "A lightweight CRM for prospects — firm, contact, stage, estimated MRR, and activity history.",
    howToUse:
      "Add prospects, log activities, advance the stage as they progress, and track the next follow-up.",
  },
  "/executive": {
    whatItIs:
      "Executive Reporting — an executive overview dashboard plus board-ready weekly/monthly reports.",
    howToUse:
      "Review the KPIs and trends, then generate and download a report for board presentations.",
  },
  "/analytics": {
    whatItIs:
      "Website Analytics — a GA4 dashboard for sessions, users, pages, bounce rate, duration, and conversion funnels.",
    howToUse:
      "Review traffic sources, drill into page performance, and spot where conversions are leaking.",
  },
  "/attribution": {
    whatItIs:
      "A cross-channel attribution funnel (leads → intakes → matters → settlements) with spend and ROI per source.",
    howToUse:
      "Enter spend per channel and read full-funnel attribution and cost-per-case by source.",
  },
  "/correlation": {
    whatItIs:
      "Joins organic rankings with AEO citations to flag 'Double Winners' (rank + cited) versus rank-only or cite-only URLs.",
    howToUse:
      "Find your strongest assets and the pages that need better schema, FAQs, or sources to become quotable.",
  },
  "/brand-voice": {
    whatItIs:
      "Content Directions — firm settings (name, tone, key messages), audience avatars, and content guidelines in one place.",
    howToUse:
      "Set the brand voice, upload sample documents for style training, and maintain compliance rules the AI must follow.",
  },
  "/content/images": {
    whatItIs:
      "A text-to-image generator with style scopes (general, social, blog, website); every output is saved to the library.",
    howToUse:
      "Enter a prompt, pick a style and size, generate, and save the image for reuse across content and campaigns.",
  },
  "/settings/practice-areas": {
    whatItIs:
      "The canonical list of practice areas that feeds Content Studio dropdowns and the AI's firm-context prompts.",
    howToUse:
      "Add, rename, or remove practice areas — changes apply across the whole app immediately.",
  },
  "/alerts": {
    whatItIs:
      "A unified inbox for SEO rank drops, AEO scoring changes, cannibalization, and technical issues, with tunable thresholds.",
    howToUse:
      "Mark alerts read or dismissed, tune the sensitivity rules, and spin high-severity alerts into action items.",
  },
  "/clarity": {
    whatItIs:
      "A Microsoft Clarity launcher with one-click deep links to heatmaps, session recordings, and the Clarity dashboard.",
    howToUse:
      "Set your Clarity project ID, then jump straight to heatmaps, recordings, and visitor insights.",
  },
  "/integrations": {
    whatItIs:
      "A health dashboard for every external service (DataForSEO, GA4, Google Ads, Metricool, and more) with setup status.",
    howToUse:
      "Check each integration's status, see what env vars are missing, and follow the setup steps to unlock features.",
  },
  "/admin/users": {
    whatItIs:
      "Admin-only — invite users, manage roles, and enable or disable accounts.",
    howToUse:
      "Add a teammate by email (Supabase sends the invite), promote to admin, or deactivate access as needed.",
  },
  "/settings": {
    whatItIs:
      "An environment-variable and configuration reference for the app's integrations.",
    howToUse:
      "Use it as a reference for the Integrations dashboard; the actual env vars are set outside the app.",
  },
  "/settings/marketing-spend": {
    whatItIs:
      "Monthly marketing spend per channel — the input that lets the Attribution funnel compute ROI, CPA, and efficiency.",
    howToUse:
      "Enter spend per channel (matching your CallRail source or GA4 channel names) so spend lines up with leads and revenue.",
  },
  "/seo/backlinks": {
    whatItIs:
      "Your backlink profile — authority score, total links, referring domains, toxicity risk, and a Disavow Manager.",
    howToUse:
      "Review authority and toxicity, expand risky domains to inspect links, and export a .txt for Google's Disavow tool.",
  },
  "/seo/link-strategy": {
    whatItIs:
      "Outbound link analysis plus an AI-generated link-building plan with target categories, email templates, and a 3-month plan.",
    howToUse:
      "Run the analysis to surface opportunities, review the plan, and verify backlinks earned from your outreach.",
  },
};

export type GlossaryTerm = { term: string; definition: string };

/** Alphabetized at render time. Define the jargon used across the app. */
export const GLOSSARY: GlossaryTerm[] = [
  {
    term: "AEO",
    definition:
      "Answer Engine Optimization — optimizing content so AI answer engines (ChatGPT, Perplexity, Claude, Gemini) cite the firm in their responses.",
  },
  {
    term: "GEO",
    definition:
      "Generative Engine Optimization — a synonym for AEO/AIO: getting the firm surfaced inside AI-generated answers rather than the classic blue links.",
  },
  {
    term: "AIO",
    definition:
      "AI Optimization — the umbrella term for making a site discoverable and citeable by AI systems; used interchangeably with AEO/GEO in the app.",
  },
  {
    term: "AI Overview",
    definition:
      "Google's AI-generated answer shown above the organic results; the keyword tracker flags when one is present for a query.",
  },
  {
    term: "Attribution",
    definition:
      "Crediting which marketing channel (SEO, paid ads, calls, etc.) drove each lead through to a closed case and settlement.",
  },
  {
    term: "AutoPilot",
    definition:
      "The WordPress plugin that injects schema, technical fixes, and content from the dashboard into the live site.",
  },
  {
    term: "Backlinks",
    definition:
      "Inbound links from other domains to your site — a core ranking signal for authority and relevance.",
  },
  {
    term: "Cannibalization",
    definition:
      "When two or more of your pages compete for the same query, splitting authority and confusing search intent.",
  },
  {
    term: "Citations (local)",
    definition:
      "Mentions of your firm's Name, Address, and Phone (NAP) across directories and listings; consistency matters for local SEO.",
  },
  {
    term: "CASH framework",
    definition:
      "The content-scoring rubric the app uses to judge how citation-worthy a piece is for AI answer engines.",
  },
  {
    term: "Compliance review",
    definition:
      "A Claude evaluation of outbound copy against NY/NJ attorney-advertising rules before it publishes.",
  },
  {
    term: "Core Web Vitals",
    definition:
      "Google's page-experience metrics (loading, interactivity, visual stability) tracked on the Technical SEO page.",
  },
  {
    term: "Correlation",
    definition:
      "A join of organic rankings (SEO) and AI citations (AEO) showing which pages both rank and get cited versus only one.",
  },
  {
    term: "HARO",
    definition:
      "Help A Reporter Out — a service where journalists post source requests; the PR Pitch tool drafts responses to them.",
  },
  {
    term: "KPI",
    definition:
      "Key Performance Indicator — a headline metric such as engagement rate, top-10 rankings, or traffic value.",
  },
  {
    term: "Lead leakage",
    definition:
      "Leads lost to missed calls, voicemails, or after-hours gaps; quantified with a recovery rate and estimated lost value.",
  },
  {
    term: "llms.txt",
    definition:
      "A manifest at your site root (/llms.txt) that tells AI crawlers which content to read and how to attribute it.",
  },
  {
    term: "Metricool",
    definition:
      "The third-party social analytics platform that powers the Social Ops metrics (followers, engagement, per-channel data).",
  },
  {
    term: "NAP",
    definition:
      "Name, Address, Phone — the canonical firm identity that local citations and directories are checked against.",
  },
  {
    term: "Peggy",
    definition:
      "The app's built-in Claude-powered marketing assistant, reachable from the Overview section.",
  },
  {
    term: "Pillar",
    definition:
      "A central topic that a cluster of related pages and keywords supports; used to group content in Site Inventory and Topical Maps.",
  },
  {
    term: "Practice areas",
    definition:
      "The firm's legal specialties; the canonical list scopes content generation and the AI's firm context.",
  },
  {
    term: "Schema (JSON-LD)",
    definition:
      "Structured-data markup added to pages so search engines and AI systems understand the content (FAQ, Organization, etc.).",
  },
  {
    term: "Topical map",
    definition:
      "A visualization of keyword clusters as nodes around a pillar, color-coded by ranking position.",
  },
];
