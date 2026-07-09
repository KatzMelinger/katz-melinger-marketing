"use client";

/**
 * Shared live system-status context.
 *
 * Fetches the two "is anything wrong / pending" signals ONCE per full load and
 * shares them with every consumer, so the alert strip and the sidebar don't
 * each hit the same endpoints:
 *   - integration connection health  (/api/integrations/status)
 *   - content awaiting approval count (/api/content/pipeline → stats.review)
 *
 * Mounted in LayoutShell around the sidebar + content. Persists across client
 * navigation (the layout stays mounted), so it fetches once per hard load.
 */

import { createContext, useContext, useEffect, useState } from "react";

export type IntegrationStatus = { id: string; label: string; status: string };

export type SystemStatus = {
  integrations: IntegrationStatus[];
  /** Content items sitting in the "review" stage, awaiting approval. */
  reviewCount: number;
  /** Critical issues from the latest AI-search readiness scan. */
  criticalIssues: number;
  /** True once the initial fetch has resolved (success or failure). */
  loaded: boolean;
};

const SystemStatusContext = createContext<SystemStatus>({
  integrations: [],
  reviewCount: 0,
  criticalIssues: 0,
  loaded: false,
});

type IntegrationsResp = { integrations?: IntegrationStatus[] };
type PipelineResp = { stats?: { byStatus?: Record<string, number> } };
type CriticalResp = { count?: number };

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function SystemStatusProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SystemStatus>({
    integrations: [],
    reviewCount: 0,
    criticalIssues: 0,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchJson<IntegrationsResp>("/api/integrations/status"),
      fetchJson<PipelineResp>("/api/content/pipeline"),
      fetchJson<CriticalResp>("/api/ai-search/critical-count"),
    ]).then(([intg, pipe, crit]) => {
      if (cancelled) return;
      setState({
        integrations: (intg?.integrations ?? []).map((i) => ({
          id: i.id,
          label: i.label,
          status: i.status,
        })),
        reviewCount: pipe?.stats?.byStatus?.review ?? 0,
        criticalIssues: crit?.count ?? 0,
        loaded: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <SystemStatusContext.Provider value={state}>{children}</SystemStatusContext.Provider>;
}

export function useSystemStatus(): SystemStatus {
  return useContext(SystemStatusContext);
}
