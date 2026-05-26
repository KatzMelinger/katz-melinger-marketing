"use client";

/**
 * Topical Maps — pillar → keyword cluster visualization.
 *
 * Reads from /api/seo/topical-map which buckets tracked keywords by
 * practice area. We render each cluster as a star: pillar in the center,
 * keywords radiating out. Node color encodes rank:
 *   green = top 10, amber = 11–30, red = unranked / 31+.
 *
 * Switching the dropdown to a specific practice area zooms into a single
 * cluster. The "All" view shows every practice area as a small star.
 *
 * Click a keyword node → drawer with rank movement + "→ Draft article".
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";

import { SeoShell } from "@/components/seo-shell";
import {
  DashCard,
  DashSelect,
  DashSpinner,
  DashPill,
} from "@/components/dashboard-ui";

type ClusterKeyword = {
  id: string;
  keyword: string;
  rank: number | null;
  previousRank: number | null;
  volume: number | null;
  difficulty: number | null;
  url: string | null;
};

type Cluster = {
  pillar: string;
  totalVolume: number;
  topRank: number | null;
  childCount: number;
  rankedCount: number;
  keywords: ClusterKeyword[];
};

type Payload = {
  pillar: string;
  clusters: Cluster[];
  meta: { totalKeywords: number; practiceAreas: number };
};

const PRACTICE_AREAS = [
  "All",
  "Employment Discrimination",
  "FMLA",
  "Wage & Hour Claims",
  "Wrongful Termination",
  "Sexual Harassment at Work",
  "Severance Negotiations",
  "Commercial Collections",
  "Judgment Enforcement",
  "Unassigned",
];

function rankTone(
  rank: number | null,
): { fill: string; border: string; label: string } {
  if (rank == null) {
    return { fill: "#fef2f2", border: "#fca5a5", label: "unranked" };
  }
  if (rank <= 10) {
    return { fill: "#ecfdf5", border: "#6ee7b7", label: "top 10" };
  }
  if (rank <= 30) {
    return { fill: "#fffbeb", border: "#fcd34d", label: "11–30" };
  }
  return { fill: "#fef2f2", border: "#fca5a5", label: "31+" };
}

/**
 * Lay out one cluster: pillar at (cx, cy), N keywords around it on a circle.
 * Multiple clusters are arranged in a grid across the canvas.
 */
function buildGraph(clusters: Cluster[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const cols = Math.min(clusters.length, 3);
  const spacingX = 700;
  const spacingY = 600;

  clusters.forEach((cluster, ci) => {
    const col = ci % cols;
    const row = Math.floor(ci / cols);
    const cx = col * spacingX + 350;
    const cy = row * spacingY + 300;

    const pillarId = `pillar-${ci}`;
    nodes.push({
      id: pillarId,
      type: "default",
      position: { x: cx, y: cy },
      data: {
        label: (
          <div className="text-center">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Pillar
            </div>
            <div className="font-semibold text-sm text-slate-900 leading-tight">
              {cluster.pillar}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {cluster.childCount} keywords · {cluster.rankedCount} ranked
            </div>
          </div>
        ),
      },
      style: {
        background: "#185FA5",
        color: "#fff",
        border: "2px solid #0f3d6b",
        borderRadius: 12,
        padding: 10,
        width: 200,
        textAlign: "center" as const,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    const kws = cluster.keywords.slice(0, 12); // cap visible children
    const radius = 230;
    kws.forEach((kw, ki) => {
      const angle = (2 * Math.PI * ki) / Math.max(kws.length, 1);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      const tone = rankTone(kw.rank);
      const kwId = `kw-${ci}-${ki}`;
      nodes.push({
        id: kwId,
        type: "default",
        position: { x, y },
        data: {
          label: (
            <div className="text-center">
              <div className="text-[11px] font-medium text-slate-900 leading-tight">
                {kw.keyword}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">
                {kw.rank != null ? `#${kw.rank}` : "—"}
                {kw.volume != null ? ` · ${kw.volume.toLocaleString()}/mo` : ""}
              </div>
            </div>
          ),
          keyword: kw,
        },
        style: {
          background: tone.fill,
          border: `2px solid ${tone.border}`,
          borderRadius: 10,
          padding: 8,
          width: 170,
        },
      });
      edges.push({
        id: `e-${ci}-${ki}`,
        source: pillarId,
        target: kwId,
        style: { stroke: "#cbd5e1", strokeWidth: 1 },
      });
    });

    if (cluster.keywords.length > 12) {
      const moreId = `more-${ci}`;
      nodes.push({
        id: moreId,
        type: "default",
        position: { x: cx, y: cy + radius + 60 },
        data: { label: `+${cluster.keywords.length - 12} more` },
        style: {
          background: "#f1f5f9",
          color: "#64748b",
          border: "1px dashed #cbd5e1",
          borderRadius: 8,
          fontSize: 11,
          padding: 6,
          width: 120,
        },
      });
      edges.push({
        id: `e-more-${ci}`,
        source: pillarId,
        target: moreId,
        style: { stroke: "#e2e8f0", strokeDasharray: "4 4" },
      });
    }
  });

  return { nodes, edges };
}

export default function TopicalMapsPage() {
  const [pillar, setPillar] = useState("All");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ClusterKeyword | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/seo/topical-map?pillar=${encodeURIComponent(pillar)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const j = (await r.json()) as Payload & { error?: string };
        if (!r.ok) throw new Error(j.error ?? "fetch failed");
        return j;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "fetch failed"))
      .finally(() => setLoading(false));
  }, [pillar]);

  const { nodes, edges } = useMemo(
    () => buildGraph(data?.clusters ?? []),
    [data],
  );

  // Wire node clicks: only the keyword nodes carry a `keyword` field in their data.
  const onNodeClick = (_: unknown, node: Node) => {
    const kw = (node.data as { keyword?: ClusterKeyword })?.keyword;
    if (kw) setSelected(kw);
  };

  return (
    <SeoShell
      title="Topical Maps"
      subtitle="Visualize practice-area pillars and the keywords clustered under each. Color = current rank: green top 10, amber 11–30, red unranked. Click a keyword to draft an article."
    >
      <DashCard>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="min-w-48">
            <label className="text-xs font-medium text-slate-700">Pillar</label>
            <DashSelect
              value={pillar}
              onChange={(e) => setPillar(e.target.value)}
              className="w-full mt-1"
            >
              {PRACTICE_AREAS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </DashSelect>
          </div>
          {data ? (
            <div className="flex items-center gap-3 text-xs text-slate-600 flex-wrap">
              <span>{data.meta.totalKeywords} tracked keywords</span>
              <span>·</span>
              <span>{data.meta.practiceAreas} pillars</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> top 10
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> 11–30
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> unranked
              </span>
            </div>
          ) : null}
        </div>
      </DashCard>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <DashCard>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <DashSpinner /> Loading clusters…
          </div>
        </DashCard>
      ) : null}

      <div
        className="rounded-xl border border-slate-200 bg-white"
        style={{ height: "70vh", minHeight: 520 }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          panOnScroll
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background gap={20} size={1} color="#e2e8f0" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {/* Drawer — opened by clicking a keyword node */}
      {selected ? (
        <DashCard>
          <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {selected.keyword}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {selected.url ? (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-[#185FA5]"
                  >
                    {selected.url.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  "No URL assigned yet"
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-slate-500 hover:text-slate-800"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-slate-700 mb-3">
            <DashPill
              tone={
                selected.rank == null
                  ? "red"
                  : selected.rank <= 10
                    ? "emerald"
                    : selected.rank <= 30
                      ? "amber"
                      : "red"
              }
            >
              rank {selected.rank ?? "—"}
            </DashPill>
            {selected.previousRank != null && selected.rank != null ? (
              <DashPill
                tone={
                  selected.previousRank > selected.rank
                    ? "emerald"
                    : selected.previousRank < selected.rank
                      ? "red"
                      : "neutral"
                }
              >
                {selected.previousRank > selected.rank ? "↑" : selected.previousRank < selected.rank ? "↓" : "→"}
                {Math.abs((selected.previousRank ?? 0) - (selected.rank ?? 0))}
              </DashPill>
            ) : null}
            {selected.volume != null ? (
              <DashPill tone="blue">
                {selected.volume.toLocaleString()}/mo
              </DashPill>
            ) : null}
            {selected.difficulty != null ? (
              <DashPill tone="violet">KD {selected.difficulty}</DashPill>
            ) : null}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Link
              href={`/content/batch?topic=${encodeURIComponent(selected.keyword)}&keywords=${encodeURIComponent(selected.keyword)}`}
              className="text-xs px-3 py-1.5 rounded border border-[#185FA5] text-[#185FA5] hover:bg-[#185FA5]/5"
            >
              → Draft article
            </Link>
            <Link
              href={`/seo/keywords?q=${encodeURIComponent(selected.keyword)}`}
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]"
            >
              Open in keyword tracker
            </Link>
          </div>
        </DashCard>
      ) : null}
    </SeoShell>
  );
}
