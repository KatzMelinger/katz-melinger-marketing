/**
 * Improve to Ready's stored result (metadata.improvement), shared with the
 * client: the review screens read it without importing the server loop.
 */
export type Improvement = { what: string; source: string };
export type ImprovementRecord = {
  at: string;
  passes: number;
  improved: Improvement[];
  /** What only a person can do: who, and the exact question. */
  human: string[];
  ready: boolean;
};

export function readImprovement(meta: Record<string, unknown> | null | undefined): ImprovementRecord | null {
  const r = meta?.improvement as ImprovementRecord | undefined;
  return r && typeof r === "object" && Array.isArray(r.improved) ? r : null;
}
