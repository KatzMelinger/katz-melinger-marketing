/**
 * POST /api/signup — self-serve firm signup (PUBLIC, no session required).
 *   body: { firmName: string, email: string, password: string }
 *
 * Creates a brand-new isolated tenant + its first admin. The client then signs
 * in with the same credentials (the password is set inline here). RLS keeps the
 * new firm fully isolated from every other tenant.
 *
 * This endpoint is intentionally unauthenticated — anyone can create their own
 * firm. The new account only ever sees its own tenant's data.
 */

import { NextRequest, NextResponse } from "next/server";

import { provisionTenant, ProvisionError } from "@/lib/tenant-provision";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    firmName?: unknown;
    email?: unknown;
    password?: unknown;
  };

  try {
    const result = await provisionTenant({
      firmName: typeof body.firmName === "string" ? body.firmName : "",
      adminEmail: typeof body.email === "string" ? body.email : "",
      adminPassword: typeof body.password === "string" ? body.password : "",
    });
    // Don't return ids the client doesn't need; just confirm success.
    return NextResponse.json({ ok: true, slug: result.slug });
  } catch (err) {
    if (err instanceof ProvisionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Signup failed" },
      { status: 500 },
    );
  }
}
