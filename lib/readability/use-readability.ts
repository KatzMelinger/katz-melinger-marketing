"use client";

/**
 * Client hooks that turn a draft body into readability ranges/summary using the
 * same pure checks the server scores with. A module-level cache means the panel
 * and the editor share a single thresholds fetch and therefore always agree.
 */

import { useEffect, useMemo, useState } from "react";

import { toPlaintext } from "./plaintext";
import {
  analyzeLengths,
  analyzePassive,
  type LengthAnalysis,
  type PassiveAnalysis,
} from "./checks";
import { DEFAULT_THRESHOLDS, type ReadabilityThresholds } from "./config";

let cached: ReadabilityThresholds | null = null;
let inflight: Promise<ReadabilityThresholds> | null = null;

function fetchThresholds(): Promise<ReadabilityThresholds> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch("/api/content/readability-thresholds", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        cached = (d?.thresholds as ReadabilityThresholds) ?? DEFAULT_THRESHOLDS;
        return cached;
      })
      .catch(() => DEFAULT_THRESHOLDS);
  }
  return inflight;
}

export function useReadabilityThresholds(): ReadabilityThresholds {
  const [thresholds, setThresholds] = useState<ReadabilityThresholds>(
    cached ?? DEFAULT_THRESHOLDS,
  );
  useEffect(() => {
    let active = true;
    fetchThresholds().then((t) => {
      if (active) setThresholds(t);
    });
    return () => {
      active = false;
    };
  }, []);
  return thresholds;
}

export type ReadabilityHighlight = {
  start: number;
  end: number;
  severity: "amber" | "red";
};

/**
 * Flagged ranges (for editor highlighting), the length analysis, the passive
 * analysis, and the resolved thresholds — all from one parse + one fetch.
 */
export function useReadabilityRanges(body: string | undefined): {
  ranges: ReadabilityHighlight[];
  lengths: LengthAnalysis | null;
  passive: PassiveAnalysis | null;
  thresholds: ReadabilityThresholds;
} {
  const thresholds = useReadabilityThresholds();
  return useMemo(() => {
    if (!body) return { ranges: [], lengths: null, passive: null, thresholds };
    const pt = toPlaintext(body);
    const lengths = analyzeLengths(pt, thresholds);
    const passive = analyzePassive(pt, thresholds);
    const ranges = [...lengths.longSentences, ...lengths.longParagraphs].map((f) => ({
      start: f.start,
      end: f.end,
      severity: f.severity,
    }));
    return { ranges, lengths, passive, thresholds };
  }, [body, thresholds]);
}
