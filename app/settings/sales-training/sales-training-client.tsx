"use client";

import { useCallback, useEffect, useState } from "react";

type Material = {
  id: string | null;
  file_name: string;
  doc_type: string;
  section_code: string | null;
  full_text: string;
  summary: string | null;
  active: boolean;
  source?: string;
};

type RubricDimension = {
  rubricType: "intake" | "consultation" | "callback";
  dimensionKey: string;
  dimensionName: string;
  maxScore: number;
  sortOrder: number;
  criteriaText: string;
  sopReference: string;
};

type ApiResponse = {
  materials: Material[];
  rubric: { intake: RubricDimension[]; consultation: RubricDimension[] };
  rubric_defaults: { intake: RubricDimension[]; consultation: RubricDimension[] };
};

export function SalesTrainingClient() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"intake" | "consultation" | "materials">("consultation");
  const [openMaterialId, setOpenMaterialId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sales-training", { cache: "no-store" });
      if (!res.ok) {
        setError(`Load failed (${res.status})`);
        return;
      }
      setData((await res.json()) as ApiResponse);
      setError(null);
    } catch (e) {
      setError((e as Error).message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveDimension(d: RubricDimension) {
    setSaving(true);
    try {
      const res = await fetch("/api/sales-training", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rubric_type: d.rubricType,
          dimension_key: d.dimensionKey,
          dimension_name: d.dimensionName,
          max_score: d.maxScore,
          sort_order: d.sortOrder,
          criteria_text: d.criteriaText,
          sop_reference: d.sopReference,
          active: true,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Save failed");
        return;
      }
      setData((await res.json()) as ApiResponse);
      setError(null);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-slate-400">Loading…</p>;
  if (!data) return <p className="text-rose-400">{error ?? "No data"}</p>;

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      ) : null}

      <div className="flex gap-1 rounded-lg bg-[#1a2540] p-1 ring-1 ring-[#2a3f5f]">
        <TabButton active={tab === "consultation"} onClick={() => setTab("consultation")}>
          Consultation rubric ({data.rubric.consultation.length})
        </TabButton>
        <TabButton active={tab === "intake"} onClick={() => setTab("intake")}>
          Intake rubric ({data.rubric.intake.length})
        </TabButton>
        <TabButton active={tab === "materials"} onClick={() => setTab("materials")}>
          Source materials ({data.materials.length})
        </TabButton>
        <span className="ml-auto self-center text-xs text-slate-500">{saving ? "Saving…" : "Saved"}</span>
      </div>

      {tab !== "materials" ? (
        <RubricEditor dimensions={data.rubric[tab]} onSave={saveDimension} />
      ) : (
        <MaterialsView
          materials={data.materials}
          openId={openMaterialId}
          setOpenId={setOpenMaterialId}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        active ? "bg-[#185FA5] text-white" : "text-slate-400 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function RubricEditor({
  dimensions,
  onSave,
}: {
  dimensions: RubricDimension[];
  onSave: (d: RubricDimension) => Promise<void>;
}) {
  return (
    <section className="space-y-3">
      {dimensions.map((d) => (
        <DimensionCard key={d.dimensionKey} dimension={d} onSave={onSave} />
      ))}
    </section>
  );
}

function DimensionCard({
  dimension,
  onSave,
}: {
  dimension: RubricDimension;
  onSave: (d: RubricDimension) => Promise<void>;
}) {
  const [name, setName] = useState(dimension.dimensionName);
  const [max, setMax] = useState(dimension.maxScore);
  const [criteria, setCriteria] = useState(dimension.criteriaText);
  const [editing, setEditing] = useState(false);

  const dirty =
    name !== dimension.dimensionName ||
    max !== dimension.maxScore ||
    criteria !== dimension.criteriaText;

  return (
    <article className="rounded-xl border border-[#2a3f5f] p-5" style={{ backgroundColor: "#1a2540" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          {editing ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm font-medium text-white"
            />
          ) : (
            <h3 className="text-base font-semibold text-white">{dimension.dimensionName}</h3>
          )}
          <p className="mt-1 text-xs text-slate-500">
            key: <code className="text-slate-400">{dimension.dimensionKey}</code>
            {dimension.sopReference ? ` · SOP ${dimension.sopReference}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Max</label>
          {editing ? (
            <input
              type="number"
              value={max}
              onChange={(e) => setMax(Math.max(1, Math.min(100, parseInt(e.target.value || "0", 10))))}
              className="w-16 rounded-lg border border-[#2a3f5f] bg-[#0f1729] px-2 py-1 text-sm text-white"
            />
          ) : (
            <span className="text-sm text-white">{dimension.maxScore}</span>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          rows={5}
          className="mt-3 w-full rounded-lg border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-100"
        />
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-slate-300">{dimension.criteriaText}</p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        {editing ? (
          <>
            <button
              onClick={() => {
                setName(dimension.dimensionName);
                setMax(dimension.maxScore);
                setCriteria(dimension.criteriaText);
                setEditing(false);
              }}
              className="rounded-lg px-3 py-1 text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              disabled={!dirty}
              onClick={async () => {
                await onSave({ ...dimension, dimensionName: name, maxScore: max, criteriaText: criteria });
                setEditing(false);
              }}
              className="rounded-lg bg-[#185FA5] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg border border-[#185FA5] bg-transparent px-3 py-1 text-xs text-[#5fa1d8] hover:bg-[#0f1729]"
          >
            Edit
          </button>
        )}
      </div>
    </article>
  );
}

function MaterialsView({
  materials,
  openId,
  setOpenId,
}: {
  materials: Material[];
  openId: string | null;
  setOpenId: (id: string | null) => void;
}) {
  return (
    <section className="space-y-3">
      <p className="text-xs text-slate-500">
        These are the SOPs the AI references on every call. To replace one, upload an updated docx via the
        next-phase upload UI (or insert into <code>public.sales_training_materials</code> directly).
      </p>
      {materials.map((m, i) => {
        const id = m.id ?? `embedded-${i}`;
        const open = openId === id;
        return (
          <article
            key={id}
            className="rounded-xl border border-[#2a3f5f] p-4"
            style={{ backgroundColor: "#1a2540" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">{m.file_name}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {m.section_code ?? "—"} · {m.doc_type} · {m.full_text.length.toLocaleString()} chars
                  {m.source === "embedded" ? " · embedded default" : ""}
                </p>
              </div>
              <button
                onClick={() => setOpenId(open ? null : id)}
                className="rounded-lg border border-[#185FA5] bg-transparent px-3 py-1 text-xs text-[#5fa1d8] hover:bg-[#0f1729]"
              >
                {open ? "Hide" : "View"}
              </button>
            </div>
            {open ? (
              <pre className="mt-3 max-h-[400px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#0f1729] p-3 text-xs text-slate-200 ring-1 ring-[#2a3f5f]">
                {m.full_text}
              </pre>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
