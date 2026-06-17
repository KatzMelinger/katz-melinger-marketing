/**
 * GET /api/integrations/status
 *
 * Returns one row per integration with:
 *   - id, label, category
 *   - status: "connected" | "missing_env" | "needs_oauth" | "error"
 *   - missing: env vars that need to be set
 *   - hint: what the user should do
 *   - feature_pages: which dashboard pages depend on this integration
 *
 * Never returns or echoes the actual secret values — only presence flags.
 */

import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { ensureGrantedEmail } from "@/lib/google-oauth";
import { resolveTenantId } from "@/lib/tenant-context";

export const runtime = "nodejs";

type GBPState = {
  status: Status;
  granted_email: string | null;
  expires_at: string | null;
};

async function gbpOAuthState(): Promise<GBPState> {
  const supabase = getSupabaseServer();
  if (!supabase) return { status: "missing_env", granted_email: null, expires_at: null };
  const haveClient =
    Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()) &&
    Boolean(process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim());
  if (!haveClient) return { status: "missing_env", granted_email: null, expires_at: null };
  try {
    const { data } = await supabase
      .from("google_oauth_tokens")
      .select("granted_email, expires_at")
      .eq("tenant_id", await resolveTenantId())
      .eq("purpose", "gbp")
      .maybeSingle();
    if (!data) return { status: "needs_oauth", granted_email: null, expires_at: null };
    return {
      status: "connected",
      granted_email: (data.granted_email as string | null) ?? null,
      expires_at: (data.expires_at as string | null) ?? null,
    };
  } catch {
    return { status: "needs_oauth", granted_email: null, expires_at: null };
  }
}

type Status =
  | "connected"
  | "missing_env"
  | "needs_oauth"
  | "needs_setup"
  | "error";

type Integration = {
  id: string;
  label: string;
  category: "AI" | "Search" | "Social" | "Email" | "Calls" | "Database" | "Content";
  status: Status;
  missing: string[];
  set: string[];
  hint?: string;
  feature_pages: string[];
  // Optional: actions the user can take from the UI (Connect, Disconnect).
  actions?: { label: string; href: string; method?: "GET" | "POST"; tone?: "primary" | "danger" }[];
  meta?: Record<string, string | null>;
};

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function envCheck(names: string[]): { missing: string[]; set: string[] } {
  const missing: string[] = [];
  const set: string[] = [];
  for (const n of names) (present(n) ? set : missing).push(n);
  return { missing, set };
}

async function constantContactStatus(): Promise<Status> {
  const envs = ["CONSTANT_CONTACT_CLIENT_ID", "CONSTANT_CONTACT_CLIENT_SECRET"];
  if (envs.some((e) => !present(e))) return "missing_env";
  // Need a stored OAuth token in supabase to actually be "connected".
  const supabase = getSupabaseServer();
  if (!supabase) return "needs_oauth";
  try {
    const { data } = await supabase
      .from("constant_contact_tokens")
      .select("access_token")
      .eq("tenant_id", await resolveTenantId())
      .limit(1);
    return data && data.length > 0 ? "connected" : "needs_oauth";
  } catch {
    return "needs_oauth";
  }
}

async function wordpressStatus(): Promise<Status> {
  // Token-based, not env-based: connected iff a non-revoked AutoPilot token
  // exists for this tenant. The plugin uses that token to pull approved fixes.
  const supabase = getSupabaseServer();
  if (!supabase) return "needs_setup";
  try {
    const { data } = await supabase
      .from("wp_autopilot_tokens")
      .select("id")
      .eq("tenant_id", await resolveTenantId())
      .is("revoked_at", null)
      .limit(1);
    return data && data.length > 0 ? "connected" : "needs_setup";
  } catch {
    return "needs_setup";
  }
}

function googleServiceAccountStatus(): Status {
  if (!present("GOOGLE_SERVICE_ACCOUNT_JSON")) return "missing_env";
  // Parseable?
  try {
    const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}");
    if (!parsed.client_email || !parsed.private_key) return "error";
    return "connected";
  } catch {
    return "error";
  }
}

export async function GET() {
  const items: Integration[] = [];
  const gbp = await gbpOAuthState();
  const wp = await wordpressStatus();

  // ---- AI providers ----
  items.push({
    id: "anthropic",
    label: "Anthropic (Claude)",
    category: "AI",
    ...envCheck(["ANTHROPIC_API_KEY"]),
    status: present("ANTHROPIC_API_KEY") ? "connected" : "missing_env",
    hint: "Required. Powers content drafting, AEO sweeps, recommendations, source review, and brand-voice analysis.",
    feature_pages: ["/aeo", "/recommendations", "/content", "/keyword-research"],
  });
  items.push({
    id: "openai",
    label: "OpenAI (ChatGPT)",
    category: "AI",
    ...envCheck(["OPENAI_API_KEY"]),
    status: present("OPENAI_API_KEY") ? "connected" : "missing_env",
    hint: "Optional. Adds ChatGPT to AEO sweeps for true cross-engine share-of-voice.",
    feature_pages: ["/aeo"],
  });
  items.push({
    id: "perplexity",
    label: "Perplexity",
    category: "AI",
    ...envCheck(["PERPLEXITY_API_KEY"]),
    status: present("PERPLEXITY_API_KEY") ? "connected" : "missing_env",
    hint: "Optional. Adds Perplexity to AEO sweeps; returns explicit citations.",
    feature_pages: ["/aeo"],
  });
  items.push({
    id: "gemini",
    label: "Google Gemini",
    category: "AI",
    ...envCheck(["GEMINI_API_KEY"]),
    status: present("GEMINI_API_KEY") ? "connected" : "missing_env",
    hint: "Optional. Adds Gemini (with Google Search grounding) to AEO sweeps.",
    feature_pages: ["/aeo"],
  });

  // ---- Search / SEO ----
  items.push({
    id: "semrush",
    label: "Semrush",
    category: "Search",
    ...envCheck(["SEMRUSH_API_KEY"]),
    status: present("SEMRUSH_API_KEY") ? "connected" : "missing_env",
    hint: "Required for SEO data — keyword ranks, backlinks, competitors, cannibalization detection.",
    feature_pages: ["/seo", "/seo/keywords", "/seo/backlinks", "/seo/cannibalization", "/correlation"],
  });
  const gsaStatus = googleServiceAccountStatus();
  items.push({
    id: "google-service-account",
    label: "Google Service Account (GA4 + Search Console + GBP)",
    category: "Search",
    ...envCheck(["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_ANALYTICS_PROPERTY_ID", "GOOGLE_SEARCH_CONSOLE_SITE_URL"]),
    status: gsaStatus,
    hint:
      gsaStatus === "missing_env"
        ? "GOOGLE_SERVICE_ACCOUNT_JSON env var not set. Create a service account in GCP, grant GA4 + Search Console access, paste the full JSON."
        : gsaStatus === "error"
          ? "JSON failed to parse or missing client_email/private_key. Re-download the key."
          : "Connected. Grant access to your GA4 property and Search Console site if you haven't.",
    feature_pages: ["/analytics", "/search-console", "/local-seo"],
  });
  items.push({
    id: "pagespeed",
    label: "Google PageSpeed Insights",
    category: "Search",
    ...envCheck(["PAGESPEED_API_KEY"]),
    status: present("PAGESPEED_API_KEY") ? "connected" : "missing_env",
    hint: "Optional. Free Google API key. Powers Core Web Vitals readings on the SEO Technical page.",
    feature_pages: ["/seo/technical"],
  });

  // ---- YouTube Data API (community comment scanner) ----
  items.push({
    id: "youtube",
    label: "YouTube Data API",
    category: "Social",
    ...envCheck(["YOUTUBE_API_KEY"]),
    status: present("YOUTUBE_API_KEY") ? "connected" : "missing_env",
    hint:
      "Free Google API key. Powers the YouTube comment scanner on /community. Get one at console.cloud.google.com → APIs & Services → Credentials → API key, restricted to YouTube Data API v3. ~600 quota units per scan against a 10,000/day cap.",
    feature_pages: ["/community"],
  });

  // ---- Clarity (heatmaps + session recordings; no secret value, just an ID) ----
  items.push({
    id: "clarity",
    label: "Microsoft Clarity",
    category: "Search",
    ...envCheck(["CLARITY_PROJECT_ID"]),
    status: present("CLARITY_PROJECT_ID") ? "connected" : "missing_env",
    hint:
      "Free heatmaps + session recordings. Project ID is not a secret (it's already in the public tracking script). Sign up at clarity.microsoft.com, paste the script on your site, then add CLARITY_PROJECT_ID here.",
    feature_pages: ["/clarity"],
  });

  // ---- Calls ----
  items.push({
    id: "callrail",
    label: "CallRail",
    category: "Calls",
    ...envCheck(["CALLRAIL_API_KEY", "CALLRAIL_ACCOUNT_ID"]),
    status:
      present("CALLRAIL_API_KEY") && present("CALLRAIL_ACCOUNT_ID")
        ? "connected"
        : "missing_env",
    hint: "Required for the Calls and Forms dashboards.",
    feature_pages: ["/calls", "/forms", "/attribution"],
  });

  // ---- Email ----
  const ccStatus = await constantContactStatus();
  items.push({
    id: "constant-contact",
    label: "Constant Contact",
    category: "Email",
    // LIST_ID is optional — the /email page now lets users pick the list at
    // runtime via a dropdown. Only the OAuth client credentials are required.
    ...envCheck(["CONSTANT_CONTACT_CLIENT_ID", "CONSTANT_CONTACT_CLIENT_SECRET"]),
    status: ccStatus,
    hint:
      ccStatus === "missing_env"
        ? "Set the OAuth client + secret, then click Connect."
        : ccStatus === "needs_oauth"
          ? "Env vars are set, but no OAuth token stored yet. Click Connect to authorize."
          : "Connected and authorized. Pick a list from the dropdown on /email.",
    feature_pages: ["/email", "/constant-contact"],
    actions:
      ccStatus === "needs_oauth" || ccStatus === "missing_env"
        ? [{ label: "Connect Constant Contact", href: "/api/constant-contact/oauth/start", tone: "primary" }]
        : [{ label: "Reconnect", href: "/api/constant-contact/oauth/start", tone: "primary" }],
  });

  // ---- Social ----
  items.push({
    id: "metricool",
    label: "Metricool",
    category: "Social",
    ...envCheck(["METRICOOL_API_TOKEN", "METRICOOL_USER_ID", "METRICOOL_BLOG_ID"]),
    status:
      present("METRICOOL_API_TOKEN") && present("METRICOOL_USER_ID") && present("METRICOOL_BLOG_ID")
        ? "connected"
        : "missing_env",
    hint: "Required for FB / IG / X / LinkedIn metrics on the Social page. Find tokens in Metricool → Settings → API.",
    feature_pages: ["/social"],
  });
  items.push({
    id: "ayrshare",
    label: "Ayrshare",
    category: "Social",
    ...envCheck(["AYRSHARE_API_KEY"]),
    status: present("AYRSHARE_API_KEY") ? "connected" : "missing_env",
    hint:
      "Publishes / schedules posts to LinkedIn, Facebook, Instagram, X, and more from one API. Get the key from the Ayrshare dashboard → API Key. For multiple connected accounts (Business plan), set a per-tenant Profile-Key in tenant_settings.ayrshare_profile_key.",
    feature_pages: ["/social", "/content"],
  });

  // ---- Google Business Profile (OAuth user-consent) ----
  items.push({
    id: "gbp-oauth",
    label: "Google Business Profile (OAuth)",
    category: "Search",
    ...envCheck(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]),
    status: gbp.status,
    hint:
      gbp.status === "missing_env"
        ? "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (your existing 'KM Dashboard' OAuth client works). Then click Connect."
        : gbp.status === "needs_oauth"
          ? "OAuth client configured. Click Connect to grant the dashboard access to Google Business Profile (requires a Google account that manages the listing). Approval from Google for the GBP API may also be needed for production volume."
          : `Connected as ${gbp.granted_email ?? "(unknown)"}. Token auto-refreshes.`,
    feature_pages: ["/local-seo", "/reviews"],
    actions:
      gbp.status === "connected"
        ? [{ label: "Reconnect", href: "/api/google/oauth/start?purpose=gbp", tone: "primary" }, { label: "Disconnect", href: "/api/google/oauth/disconnect?purpose=gbp", method: "POST", tone: "danger" }]
        : gbp.status === "needs_oauth"
          ? [{ label: "Connect Google Business Profile", href: "/api/google/oauth/start?purpose=gbp", tone: "primary" }]
          : undefined,
    meta:
      gbp.status === "connected"
        ? { granted_email: gbp.granted_email, expires_at: gbp.expires_at }
        : undefined,
  });

  // ---- Database ----
  items.push({
    id: "supabase",
    label: "Supabase",
    category: "Database",
    ...envCheck(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]),
    status:
      present("NEXT_PUBLIC_SUPABASE_URL") && present("SUPABASE_SERVICE_ROLE_KEY")
        ? "connected"
        : "missing_env",
    hint: "Required for everything that persists data: drafts, AEO runs, alerts, history, brand voice.",
    feature_pages: ["/aeo", "/alerts", "/content", "/brand-voice", "/recommendations"],
  });

  // ---- CMS link ----
  items.push({
    id: "cms",
    label: "Firm CMS / case-management link",
    category: "Database",
    ...envCheck(["CMS_API_URL", "CMS_API_SECRET_KEY"]),
    status:
      present("CMS_API_URL") && present("CMS_API_SECRET_KEY") ? "connected" : "missing_env",
    hint: "Optional. Enables attribution to merge intakes/matters into the funnel reports.",
    feature_pages: ["/attribution", "/pipeline"],
  });

  // ---- Content / publishing & design ----
  items.push({
    id: "wordpress",
    label: "WordPress (KM AutoPilot plugin)",
    category: "Content",
    missing: [],
    set: [],
    status: wp,
    hint:
      wp === "connected"
        ? "Connected. Approved on-page SEO fixes and long-form posts sync to the site via the KM AutoPilot plugin. Use Manage to add another site or revoke a token."
        : "Not set up yet. Generate a per-site token and install the KM AutoPilot plugin on the WordPress site to start pushing approved fixes.",
    feature_pages: ["/seo/technical"],
    actions: [
      {
        label: wp === "connected" ? "Manage connection" : "Set up WordPress",
        href: "/settings/wordpress",
        tone: "primary",
      },
    ],
  });

  const canvaEnv = envCheck(["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET"]);
  const canvaConfigured = canvaEnv.missing.length === 0;
  items.push({
    id: "canva",
    label: "Canva",
    category: "Content",
    ...canvaEnv,
    status: canvaConfigured ? "needs_oauth" : "missing_env",
    hint: canvaConfigured
      ? "OAuth client configured. The Canva account connect flow is the next step — credentials are in place, ready to authorize."
      : "To be set up. Create a Canva Connect app at canva.com/developers, then add CANVA_CLIENT_ID and CANVA_CLIENT_SECRET. Unlocks brand-template design generation for social and content.",
    feature_pages: ["/content/images", "/social"],
  });

  return NextResponse.json({
    integrations: items,
    summary: {
      connected: items.filter((i) => i.status === "connected").length,
      missing_env: items.filter((i) => i.status === "missing_env").length,
      needs_oauth: items.filter((i) => i.status === "needs_oauth").length,
      needs_setup: items.filter((i) => i.status === "needs_setup").length,
      error: items.filter((i) => i.status === "error").length,
      total: items.length,
    },
  });
}
