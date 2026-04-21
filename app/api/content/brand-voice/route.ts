import { NextResponse } from "next/server";

import {
  getBrandVoiceContext,
  getLatestBrandProfile,
  listBrandDocuments,
  setBrandVoiceContext,
} from "@/lib/content-brand-voice";

export const dynamic = "force-dynamic";

export async function GET() {
  const [context, profile, documents] = await Promise.all([
    getBrandVoiceContext(),
    getLatestBrandProfile(),
    listBrandDocuments(),
  ]);
  return NextResponse.json({ context, profile, documents });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const context = typeof o.context === "string" ? o.context : "";
  const updated = await setBrandVoiceContext(context);
  if (!updated.ok) {
    return NextResponse.json({ error: updated.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, context });
}
