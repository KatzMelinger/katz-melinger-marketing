"use client";

/**
 * Readability standards — tenant-editable green/amber/red bands for the content
 * readability checks. Lives under Content Standards (/brand-voice). Backed by
 * /api/content/readability-thresholds (GET/PUT/DELETE).
 *
 * Edits take effect on the next analysis run (on Save or generation completion);
 * a draft already open can be re-scored with "Re-run analysis".
 */

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_THRESHOLDS,
  METRIC_LABELS,
  type MetricThreshold,
  type ReadabilityMetric,
  type ReadabilityThresholds,
} from "@/lib/readability/config";

const METRIC_ORDER = Object.keys(DEFAULT_THRESHOLDS) as ReadabilityMetric[];

const input =
  "block w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 tabular-nums";

function bandHint(t: MetricThreshold): string {
  return t.direction === "lower"
    ? `green ≤ ${t.green}, amber ≤ ${t.amber}, red above`
    : `green ≥ ${t.green}, amber ≥ ${t.amber}, red below`;
}

/** Ordering is wrong when it contradicts the metric's direction. */
function orderingInvalid(t: MetricThreshold): boolean {
  return t.direction === "lower" ? t.green > t.amber : t.green < t.amber;
}

type Register = "formal" | "accessible" | "neutral";

const REGISTER_COPY: Record<Register, string> = {
  formal:
    "Your brand voice reads formal/authoritative, so the bands are looser — longer sentences and more formal phrasing won't be over-flagged.",
  accessible:
    "Your brand voice reads concise/client-facing, so the bands are tighter — they push toward plainer, easier copy.",
  neutral:
    "No strong register detected in your brand voice yet, so balanced default bands are used. Add writing samples in Brand voice to sharpen this.",
};

export default function ReadabilityStandardsManager() {
  const [thresholds, setThresholds] = useState<ReadabilityThresholds | null>(null);
  const [register, setRegister] = useState<Register>("neutral");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/readability-thresholds", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setThresholds(json.thresholds as ReadabilityThresholds);
        if (json.register) setRegister(json.register as Register);
      } else setError(json.error ?? "Failed to load thresholds");
    } catch {
      setError("Failed to load thresholds");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setBand = (
    metric: ReadabilityMetric,
    field: "green" | "amber",
    value: number,
  ) => {
    setThresholds((prev) =>
      prev ? { ...prev, [metric]: { ...prev[metric], [field]: value } } : prev,
    );
    setMessage(null);
  };

  const save = async () => {
    if (!thresholds) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/content/readability-thresholds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholds }),
      });
      const json = await res.json();
      if (res.ok) {
        setThresholds(json.thresholds as ReadabilityThresholds);
        setMessage("Saved. New scores apply on the next analysis run.");
      } else {
        setError(json.error ?? "Failed to save");
      }
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/content/readability-thresholds", { method: "DELETE" });
      const json = await res.json();
      if (res.ok) {
        setThresholds(json.thresholds as ReadabilityThresholds);
        setMessage("Reset — now following your brand voice.");
      } else {
        setError(json.error ?? "Failed to reset");
      }
    } catch {
      setError("Failed to reset");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-800">Readability standards</h2>
        <p className="mt-1 text-xs text-slate-500">
          The green / amber / red bands the content readability checks score against.
          These start from your <strong>brand voice</strong> automatically — any band
          you don&apos;t override keeps tracking it as your voice evolves. Edits apply
          on the next analysis run.
        </p>
        <div className="mt-2 rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs text-violet-800">
          <span className="font-medium">Following your brand voice ({register}).</span>{" "}
          {REGISTER_COPY[register]}
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-slate-500">Loading…</div>
      ) : !thresholds ? (
        <div className="text-xs text-red-600">{error ?? "No thresholds available."}</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
                  <th className="px-3 py-2 font-semibold">Metric</th>
                  <th className="px-3 py-2 font-semibold">Green at</th>
                  <th className="px-3 py-2 font-semibold">Amber at</th>
                  <th className="px-3 py-2 font-semibold">Bands</th>
                </tr>
              </thead>
              <tbody>
                {METRIC_ORDER.map((metric) => {
                  const t = thresholds[metric];
                  const invalid = orderingInvalid(t);
                  return (
                    <tr key={metric} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 font-medium text-slate-700">
                        {METRIC_LABELS[metric]}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className={input}
                          value={t.green}
                          onChange={(e) => setBand(metric, "green", Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className={input}
                          value={t.amber}
                          onChange={(e) => setBand(metric, "amber", Number(e.target.value))}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {bandHint(t)}
                        {invalid && (
                          <span className="ml-2 text-amber-600">
                            ⚠ ordering looks reversed for this metric
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md border border-emerald-400 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save standards"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={resetting}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-400 disabled:opacity-60"
              title="Clear your overrides and follow the brand-voice bands exactly"
            >
              {resetting ? "Resetting…" : "Reset to brand voice"}
            </button>
            {message && <span className="text-xs text-emerald-700">{message}</span>}
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
