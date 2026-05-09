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

export const runtime = "nodejs";

type Status = "connected" | "missing_env" | "needs_oauth" | "error";

type Integration = {
  id: string;
  label: string;
  category: "AI" | "Search" | "Social" | "Email" | "Calls" | "Database";
  status: Status;
  missing: string[];
  set: string[];
  hint?: string;
  feature_pages: string[];
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
      .limit(1);
    return data && data.length > 0 ? "connected" : "needs_oauth";
  } catch {
    return "needs_oauth";
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
    ...envCheck([
      "CONSTANT_CONTACT_CLIENT_ID",
      "CONSTANT_CONTACT_CLIENT_SECRET",
      "CONSTANT_CONTACT_LIST_ID",
    ]),
    status: ccStatus,
    hint:
      ccStatus === "missing_env"
        ? "Set the OAuth client + secret + list ID, then visit /api/constant-contact/oauth to authorize."
        : ccStatus === "needs_oauth"
          ? "Env vars are set, but no OAuth token stored. Visit /api/constant-contact/oauth to authorize."
          : "Connected and authorized.",
    feature_pages: ["/email", "/constant-contact"],
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
    label: "Katz Melinger CMS",
    category: "Database",
    ...envCheck(["CMS_API_URL", "CMS_API_SECRET_KEY"]),
    status:
      present("CMS_API_URL") && present("CMS_API_SECRET_KEY") ? "connected" : "missing_env",
    hint: "Optional. Enables attribution to merge intakes/matters into the funnel reports.",
    feature_pages: ["/attribution", "/pipeline"],
  });

  return NextResponse.json({
    integrations: items,
    summary: {
      connected: items.filter((i) => i.status === "connected").length,
      missing_env: items.filter((i) => i.status === "missing_env").length,
      needs_oauth: items.filter((i) => i.status === "needs_oauth").length,
      error: items.filter((i) => i.status === "error").length,
      total: items.length,
    },
  });
}
