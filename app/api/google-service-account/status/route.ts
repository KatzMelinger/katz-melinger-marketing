import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CredentialShape = {
  client_email?: unknown;
  private_key?: unknown;
};

export async function GET() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  if (!raw) {
    return NextResponse.json({
      configured: false,
      error: "GOOGLE_SERVICE_ACCOUNT_JSON is not set",
    });
  }

  try {
    const parsed = JSON.parse(raw) as CredentialShape;
    const hasClientEmail = typeof parsed.client_email === "string";
    const hasPrivateKey = typeof parsed.private_key === "string";
    if (!hasClientEmail || !hasPrivateKey) {
      return NextResponse.json({
        configured: false,
        error:
          "GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key",
      });
    }
    return NextResponse.json({ configured: true });
  } catch {
    return NextResponse.json({
      configured: false,
      error: "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON",
    });
  }
}
