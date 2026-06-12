/**
 * Katz Melinger internal CMS adapter — the first concrete CrmProvider, wrapping
 * the existing lib/cms-server.ts client so today's attribution funnel keeps
 * working through the new abstraction.
 *
 * Capability note: the CMS currently exposes only *aggregate* by-source
 * endpoints, not individual intake records — so intakeRecords is false and
 * getIntakeRecords is intentionally absent. Exposing a per-record intakes
 * endpoint (id, phone, source, area_of_law, created_at) is the keystone Phase 2
 * ask that flips this to true and unlocks call→intake matching.
 */

import { fetchCmsJson, getCmsBaseUrl } from "@/lib/cms-server";
import type { CrmProvider, SourceCount, SourceRevenue } from "@/lib/crm/types";

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeSource(value: unknown): string {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : "Unknown";
}

function toSourceCounts(input: unknown): SourceCount[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      return {
        source: normalizeSource(r.source ?? r.channel),
        count: num(r.count ?? r.matters ?? r.intakes),
      };
    })
    .filter((r): r is SourceCount => r !== null);
}

function toRevenue(input: unknown): SourceRevenue[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      return {
        source: normalizeSource(r.source ?? r.channel ?? r.area_of_law),
        settlements: num(r.settlements ?? r.settlement_count ?? r.count),
        revenue: num(r.revenue ?? r.total_settlement_value ?? r.value),
      };
    })
    .filter((r): r is SourceRevenue => r !== null);
}

export const katzCmsProvider: CrmProvider = {
  id: "katz-cms",
  label: "Katz Melinger CMS",
  capabilities: { bySource: true, intakeRecords: false },
  isAvailable: () => getCmsBaseUrl() !== null,

  async getIntakesBySource() {
    return toSourceCounts(await fetchCmsJson<unknown>("/api/v1/intakes/by-source"));
  },
  async getMattersBySource() {
    return toSourceCounts(await fetchCmsJson<unknown>("/api/v1/matters/by-source"));
  },
  async getRevenueBySource() {
    const direct = toRevenue(await fetchCmsJson<unknown>("/api/v1/revenue/settlements-by-source"));
    if (direct.length > 0) return direct;
    // Fall back to the area-of-law attribution breakdown.
    const attribution = await fetchCmsJson<{ breakdown?: unknown }>("/api/v1/revenue/attribution");
    return toRevenue(attribution?.breakdown);
  },
};
