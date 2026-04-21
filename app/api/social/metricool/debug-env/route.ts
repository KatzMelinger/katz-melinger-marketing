import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function maskSecret(value: string | undefined): string {
  if (value == null || value === "") return "(empty)";
  if (value.length <= 8) return `*** (len=${value.length})`;
  return `${value.slice(0, 4)}...${value.slice(-4)} (len=${value.length})`;
}

/**
 * Safe snapshot of what the server sees (no raw token).
 */
export async function GET() {
  const token = process.env.METRICOOL_API_TOKEN?.trim();
  const userId = process.env.METRICOOL_USER_ID?.trim();
  const blogId = process.env.METRICOOL_BLOG_ID?.trim();

  return NextResponse.json({
    source: "server",
    note:
      "Client-side code never has access to METRICOOL_* env vars unless prefixed with NEXT_PUBLIC_ (do not use for secrets).",
    METRICOOL_API_TOKEN: token ? "set" : "missing",
    METRICOOL_API_TOKEN_masked: maskSecret(token),
    METRICOOL_USER_ID: userId || "missing",
    METRICOOL_BLOG_ID: blogId || "missing",
    ready: Boolean(token && userId && blogId),
  });
}
