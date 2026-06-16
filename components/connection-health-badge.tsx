"use client";

/**
 * Connection-health badge — shows the live status of every OAuth connection
 * (Constant Contact, Google Business Profile) so a lapsing token is caught
 * before a send/sync fails. "Refresh tokens now" triggers the same keep-alive
 * the cron runs. Reads GET /api/connections/health.
 */

import { useCallback, useEffect, useState } from "react";

type Conn = {
  id: string;
  label: string;
  connected: boolean;
  hasRefreshToken: boolean;
  expiresAt: string | null;
  expiresInMinutes: number | null;
  status: "ok" | "expiring" | "at_risk" | "disconnected";
  detail: string;
};
type Payload = { connections: Conn[]; overall: Conn["status"] };

const TONE: Record<Conn["status"], { dot: string; text: string; label: string }> = {
  ok: { dot: "bg-emerald-500", text: "text-emerald-700", label: "Healthy" },
  expiring: { dot: "bg-amber-500", text: "text-amber-700", label: "Refresh pending" },
  at_risk: { dot: "bg-amber-600", text: "text-amber-800", label: "Needs reconnect soon" },
  disconnected: { dot: "bg-red-500", text: "text-red-700", label: "Disconnected" },
};

export function ConnectionHealthBadge({
  className,
  defaultOpen,
}: {
  className?: string;
  defaultOpen?: boolean;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(!!defaultOpen);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/connections/health", { cache: "no-store" });
      const j = await r.json();
      if (r.ok) setData(j as Payload);
    } catch {
      /* leave as-is */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/connections/keepalive");
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading || !data) return null;
  const tone = TONE[data.overall];

  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2"
      >
        <span className="flex items-center gap-2 text-sm">
          <span className={`inline-block h-2 w-2 rounded-full ${tone.dot}`} aria-hidden />
          <span className="font-medium text-slate-700">Connections</span>
          <span className={`text-xs ${tone.text}`}>{tone.label}</span>
        </span>
        <span className="text-xs text-slate-400" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-2">
          {data.connections.map((c) => {
            const t = TONE[c.status];
            return (
              <div key={c.id} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />
                  <span className="font-medium text-slate-700">{c.label}</span>
                  <span className={t.text}>{t.label}</span>
                </div>
                <p className="ml-3.5 text-slate-500">{c.detail}</p>
              </div>
            );
          })}
          <button
            type="button"
            onClick={refreshNow}
            disabled={refreshing}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh tokens now"}
          </button>
        </div>
      )}
    </div>
  );
}
