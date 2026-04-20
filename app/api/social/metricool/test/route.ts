import { NextResponse } from "next/server";

import {
  logMetricoolEnvSnapshot,
  metricoolFetchLogged,
  readMetricoolEnv,
} from "@/lib/metricool-app-api";

export const dynamic = "force-dynamic";

/**
 * Single-call credential check against Metricool (overview endpoint).
 * Check server logs for full request/response details.
 */
export async function GET() {
  console.log("[Metricool test] validating credentials…");
  logMetricoolEnvSnapshot();

  const env = readMetricoolEnv();
  if (!env.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: env.error,
        present: env.present,
      },
      { status: 503 },
    );
  }

  const { token, userId, blogId } = env;

  try {
    const { response, log } = await metricoolFetchLogged(
      "test-overview",
      "/analytics/overview",
      token,
      userId,
      blogId,
    );

    let parsed: unknown = null;
    try {
      parsed = log.bodyText ? JSON.parse(log.bodyText) : null;
    } catch {
      parsed = { parseError: "Response was not JSON", raw: log.bodyText };
    }

    const ok = response.ok;

    return NextResponse.json({
      ok,
      status: log.status,
      statusText: log.statusText,
      url: log.url,
      request: {
        headerKeys: log.headerKeys,
        xMcAuth: log.xMcAuth,
        queryParams: Object.fromEntries(new URL(log.url).searchParams.entries()),
      },
      response: {
        contentType: log.contentType,
        body: parsed,
        bodyRaw: log.bodyText,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[Metricool test] fetch error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
