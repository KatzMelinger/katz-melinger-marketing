/**
 * POST /api/google/oauth/disconnect?purpose=gbp
 *
 * Removes the stored OAuth token row so the user can re-authorize cleanly.
 * Does NOT revoke the token at Google — the firm can do that from
 * myaccount.google.com → Security → Third-party access if they want.
 */

import { NextRequest, NextResponse } from "next/server";
import { deleteStoredToken, type Purpose } from "@/lib/google-oauth";

export const runtime = "nodejs";

const ALLOWED: Purpose[] = ["gbp"];

export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const purpose = (searchParams.get("purpose") as Purpose) ?? "gbp";
  if (!ALLOWED.includes(purpose)) {
    return NextResponse.json({ error: `Invalid purpose: ${purpose}` }, { status: 400 });
  }
  await deleteStoredToken(purpose);
  return NextResponse.json({ ok: true });
}
