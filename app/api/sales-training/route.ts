/**
 * GET /api/sales-training — list all training materials (uploaded SOPs +
 * the rubric merged with overrides) so the admin UI can show what the
 * AI scorer is actually using.
 *
 * POST /api/sales-training — multipart upload of one or more SOP/script docs
 *   (.pdf/.docx/.txt/.md/.rtf/.html). Each file is parsed to plain text and
 *   stored in public.sales_training_materials. A doc that shares a section_code
 *   (or, lacking one, a file_name) with an existing active row replaces it.
 *   Form fields: files[] (required), doc_type, section_code (optional).
 *
 * PUT /api/sales-training — upsert a rubric override row. Body:
 *   { rubric_type, dimension_key, dimension_name, max_score,
 *     sort_order, criteria_text, sop_reference, active }
 */
import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import {
  extractText,
  isSupportedUpload,
  SUPPORTED_UPLOAD_EXTENSIONS,
} from "@/lib/document-extract";
import { ALL_RUBRICS, loadRubric } from "@/lib/sales-coach-rubric";
import { ALL_SOPS } from "@/lib/sales-coach-sops";
import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { resolveTenantId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const DOC_TYPES = ["sop", "script", "playbook", "glossary", "training", "other"] as const;
type DocType = (typeof DOC_TYPES)[number];

function parseDocType(value: FormDataEntryValue | null): DocType {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (DOC_TYPES as readonly string[]).includes(raw) ? (raw as DocType) : "sop";
}

/** Pull a leading section code like "5.2.3-a" off the filename, else null. */
function deriveSectionCode(filename: string): string | null {
  const m = filename.match(/^\s*(\d+(?:\.\d+)*(?:-[a-z])?)/i);
  return m ? m[1] : null;
}

type Json = Record<string, unknown>;

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  const tenantId = await resolveTenantId();
  const { data: materialsDb } = supabase
    ? await supabase
        .from("sales_training_materials")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("section_code")
    : { data: null };

  const intake = await loadRubric(supabase, "intake", tenantId);
  const consultation = await loadRubric(supabase, "consultation", tenantId);
  const callback = await loadRubric(supabase, "callback", tenantId);

  // The hardcoded SOPs are always available; the DB rows extend them.
  const materials = (materialsDb ?? []).length > 0
    ? materialsDb
    : ALL_SOPS.map((s) => ({
        id: null,
        file_name: s.fileName,
        doc_type: s.docType,
        section_code: s.sectionCode,
        full_text: s.text,
        summary: null,
        active: true,
        source: "embedded" as const,
      }));

  return NextResponse.json({
    materials,
    rubric: {
      intake,
      consultation,
      callback,
    },
    rubric_defaults: {
      intake: ALL_RUBRICS.filter((r) => r.rubricType === "intake"),
      consultation: ALL_RUBRICS.filter((r) => r.rubricType === "consultation"),
      callback: ALL_RUBRICS.filter((r) => r.rubricType === "callback"),
    },
  });
}

export async function POST(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });
  const tenantId = await resolveTenantId();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const docType = parseDocType(form.get("doc_type"));
  const sectionOverride =
    typeof form.get("section_code") === "string"
      ? (form.get("section_code") as string).trim()
      : "";

  const files = form
    .getAll("files")
    .filter((v): v is File => typeof File !== "undefined" && v instanceof File);

  if (!files.length) {
    return NextResponse.json(
      { error: `No files uploaded. Attach one or more files (${SUPPORTED_UPLOAD_EXTENSIONS.join(", ")}).` },
      { status: 400 },
    );
  }

  const uploaded: Array<{ file_name: string; chars: number; section_code: string | null }> = [];
  const failures: Array<{ filename: string; error: string }> = [];

  for (const file of files) {
    if (!isSupportedUpload(file.name)) {
      failures.push({
        filename: file.name,
        error: `Unsupported file type. Supported: ${SUPPORTED_UPLOAD_EXTENSIONS.join(", ")}.`,
      });
      continue;
    }
    try {
      const extracted = await extractText({
        filename: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
      });
      const text = (extracted.text ?? "").trim();
      if (!text) {
        failures.push({ filename: file.name, error: "No extractable text found in file." });
        continue;
      }

      const sectionCode = sectionOverride || deriveSectionCode(file.name);
      const row = {
        tenant_id: tenantId,
        file_name: file.name,
        doc_type: docType,
        section_code: sectionCode,
        full_text: text,
        active: true,
        updated_at: new Date().toISOString(),
      };

      // No DB unique key, so emulate upsert: an existing active row in THIS
      // tenant with the same section_code (or, lacking one, the same file_name)
      // is replaced. Scoping by tenant_id keeps one firm's upload from matching
      // and overwriting another firm's row.
      let existingId: string | null = null;
      const matchCol = sectionCode ? "section_code" : "file_name";
      const matchVal = sectionCode ?? file.name;
      const { data: existing } = await supabase
        .from("sales_training_materials")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .eq(matchCol, matchVal)
        .limit(1)
        .maybeSingle();
      if (existing && typeof (existing as { id?: unknown }).id === "string") {
        existingId = (existing as { id: string }).id;
      }

      const { error: writeErr } = existingId
        ? await supabase
            .from("sales_training_materials")
            .update(row)
            .eq("tenant_id", tenantId)
            .eq("id", existingId)
        : await supabase.from("sales_training_materials").insert(row);

      if (writeErr) {
        failures.push({ filename: file.name, error: writeErr.message });
        continue;
      }
      uploaded.push({ file_name: file.name, chars: text.length, section_code: sectionCode });
    } catch (e) {
      failures.push({
        filename: file.name,
        error: e instanceof Error ? e.message : "Failed to process file.",
      });
    }
  }

  if (!uploaded.length) {
    return NextResponse.json(
      { error: "No files were processed successfully.", failures },
      { status: 400 },
    );
  }

  // Return the refreshed list (same shape as GET) plus the upload report.
  const base = await GET();
  const payload = (await base.json()) as Json;
  return NextResponse.json({ ...payload, uploaded, failures });
}

export async function PUT(req: Request) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });
  const tenantId = await resolveTenantId();

  let body: Json = {};
  try {
    body = (await req.json()) as Json;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rubricType = typeof body.rubric_type === "string" ? body.rubric_type : "";
  if (!["intake", "consultation", "callback"].includes(rubricType)) {
    return NextResponse.json({ error: "rubric_type must be intake|consultation|callback" }, { status: 400 });
  }
  const dimensionKey = typeof body.dimension_key === "string" ? body.dimension_key.trim() : "";
  if (!dimensionKey) return NextResponse.json({ error: "dimension_key required" }, { status: 400 });
  const max =
    typeof body.max_score === "number" && Number.isFinite(body.max_score) ? Math.max(1, Math.min(100, Math.floor(body.max_score))) : 10;
  const order =
    typeof body.sort_order === "number" && Number.isFinite(body.sort_order) ? Math.floor(body.sort_order) : 0;

  const row = {
    tenant_id: tenantId,
    rubric_type: rubricType,
    dimension_key: dimensionKey,
    dimension_name: typeof body.dimension_name === "string" ? body.dimension_name : dimensionKey,
    max_score: max,
    sort_order: order,
    criteria_text: typeof body.criteria_text === "string" ? body.criteria_text : "",
    sop_reference: typeof body.sop_reference === "string" ? body.sop_reference : null,
    active: body.active === false ? false : true,
  };
  // The sales_rubric unique key is (rubric_type, dimension_key) and does NOT
  // include tenant_id, so a DB upsert(onConflict) would overwrite another
  // tenant's row. Emulate a tenant-scoped upsert by hand instead.
  const { data: existing } = await supabase
    .from("sales_rubric")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("rubric_type", rubricType)
    .eq("dimension_key", dimensionKey)
    .limit(1)
    .maybeSingle();
  const { error } =
    existing && typeof (existing as { id?: unknown }).id === "string"
      ? await supabase
          .from("sales_rubric")
          .update(row)
          .eq("tenant_id", tenantId)
          .eq("id", (existing as { id: string }).id)
      : await supabase.from("sales_rubric").insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return GET();
}
