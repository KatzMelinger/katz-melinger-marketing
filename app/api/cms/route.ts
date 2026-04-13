import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Proxy to the CMS (katz-melinger-cms). Set CMS_API_URL to the deployed CMS origin
 * (e.g. https://your-cms.vercel.app) and CMS_API_SECRET_KEY to match API_SECRET_KEY on the CMS.
 */
export async function GET(req: Request) {
  const base = process.env.CMS_API_URL?.replace(/\/$/, "");
  if (!base) {
    return NextResponse.json(
      { error: "CMS_API_URL is not configured" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const path =
    url.searchParams.get("path")?.trim() || "/api/v1/intakes/by-source";
  const safePath = path.startsWith("/") ? path : `/${path}`;
  const target = `${base}${safePath}`;

  const secret =
    process.env.CMS_API_SECRET_KEY?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    "";

  try {
    const res = await fetch(target, {
      cache: "no-store",
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });

    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 500) };
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: "CMS request failed", status: res.status, body },
        { status: 502 },
      );
    }

    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
