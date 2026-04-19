import { NextResponse } from "next/server";

import { maskSecret, readMetricoolEnv } from "@/lib/metricool-app-api";

export const dynamic = "force-dynamic";

/**
 * Safe snapshot of what the server sees (no raw token). Client components cannot
 * read METRICOOL_* from process.env — only this route can confirm server config.
 */
export async function GET() {
  const env = readMetricoolEnv();
  if (env.ok) {
    return NextResponse.json({
      source: "server",
      note:
        "Client-side code never has access to METRICOOL_* env vars unless prefixed with NEXT_PUBLIC_ (do not use for secrets).",
      METRICOOL_API_TOKEN: "set",
      METRICOOL_API_TOKEN_masked: maskSecret(env.token),
      METRICOOL_USER_ID: env.userId,
      METRICOOL_BLOG_ID: env.blogId,
      ready: true,
    });
  }

  return NextResponse.json({
    source: "server",
    note:
      "Client-side code never has access to METRICOOL_* env vars unless prefixed with NEXT_PUBLIC_ (do not use for secrets).",
    METRICOOL_API_TOKEN: env.present.METRICOOL_API_TOKEN ? "set" : "missing",
    METRICOOL_USER_ID: env.present.METRICOOL_USER_ID
      ? process.env.METRICOOL_USER_ID?.trim() ?? "(empty after trim)"
      : "missing",
    METRICOOL_BLOG_ID: env.present.METRICOOL_BLOG_ID
      ? process.env.METRICOOL_BLOG_ID?.trim() ?? "(empty after trim)"
      : "missing",
    present: env.present,
    error: env.error,
    ready: false,
  });
}
