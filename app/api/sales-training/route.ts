/**
 * GET /api/sales-training — list all training materials (uploaded SOPs +
 * the rubric merged with overrides) so the admin UI can show what the
 * AI scorer is actually using.
 *
 * PUT /api/sales-training — upsert a rubric override row. Body:
 *   { rubric_type, dimension_key, dimension_name, max_score,
 *     sort_order, criteria_text, sop_reference, active }
 */
import { NextResponse } from "next/server";

import { ALL_RUBRICS, loadRubric } from "@/lib/sales-coach-rubric";
import { ALL_SOPS } from "@/lib/sales-coach-sops";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type Json = Record<string, unknown>;

export async function GET() {
  const supabase = getSupabaseServer();
  const { data: materialsDb } = supabase
    ? await supabase.from("sales_training_materials").select("*").eq("active", true).order("section_code")
    : { data: null };

  const intake = await loadRubric(supabase, "intake");
  const consultation = await loadRubric(supabase, "consultation");

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
    },
    rubric_defaults: {
      intake: ALL_RUBRICS.filter((r) => r.rubricType === "intake"),
      consultation: ALL_RUBRICS.filter((r) => r.rubricType === "consultation"),
    },
  });
}

export async function PUT(req: Request) {
  const supabase = getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });

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
    rubric_type: rubricType,
    dimension_key: dimensionKey,
    dimension_name: typeof body.dimension_name === "string" ? body.dimension_name : dimensionKey,
    max_score: max,
    sort_order: order,
    criteria_text: typeof body.criteria_text === "string" ? body.criteria_text : "",
    sop_reference: typeof body.sop_reference === "string" ? body.sop_reference : null,
    active: body.active === false ? false : true,
  };
  const { error } = await supabase
    .from("sales_rubric")
    .upsert(row, { onConflict: "rubric_type,dimension_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return GET();
}
