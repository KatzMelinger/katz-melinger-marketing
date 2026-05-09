/**
 * POST /api/llms-txt/generate
 * Body: { url?: string }   — defaults to katzmelinger.com
 *
 * Returns the generated llms.txt body and a list of source pages used.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateLlmsTxt } from "@/lib/llms-txt";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const url = (body?.url as string | undefined) ?? "https://www.katzmelinger.com";
    const result = await generateLlmsTxt(url);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
