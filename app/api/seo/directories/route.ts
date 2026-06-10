/**
 * GET    /api/seo/directories        — list tracked legal directories
 * POST   /api/seo/directories        — body: DirectoryInput (add/upsert by name)
 * PATCH  /api/seo/directories        — body: { id, ...patch } (update a row)
 * DELETE /api/seo/directories?id=…    — remove a row
 *
 * AI suggestions live at /api/seo/directories/suggest.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  addDirectory,
  listDirectories,
  removeDirectory,
  updateDirectory,
  type DirectoryInput,
} from "@/lib/seo-directories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const directories = await listDirectories();
    return NextResponse.json({ directories });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list directories" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const input = (body && typeof body === "object" ? body : {}) as DirectoryInput;
  const result = await addDirectory(input);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, row: result.row });
}

export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { id: _omit, ...patch } = obj;
  const result = await updateDirectory(id, patch as Partial<DirectoryInput>);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, row: result.row });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const result = await removeDirectory(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
