import { NextResponse } from "next/server";

import { metricoolFetch, readMetricoolEnv } from "@/lib/metricool";

export const dynamic = "force-dynamic";

/**
 * Credential check: single GET to /admin/simpleProfiles (Metricool docs example).
 */
export async function GET() {
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
    const response = await metricoolFetch(
      "/admin/simpleProfiles",
      token,
      userId,
      blogId,
    );

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      body = { parseError: "Response was not JSON", raw: text };
    }

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      path: "/admin/simpleProfiles",
      body,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
