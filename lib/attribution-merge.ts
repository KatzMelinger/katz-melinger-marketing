export type CallSummary = {
  totalCalls?: number;
  callsBySource?: { name: string; value: number }[];
};

export type CmsAttributionBreakdown = {
  area_of_law: string;
  total_settlement_value: number;
  settlement_count: number;
};

export type CmsIntakeSource = { source: string; count: number };

export type AttributionTableRow = {
  source: string;
  totalCalls: number;
  intakes: number;
  mattersOpened: number;
  totalSettlementValue: number;
  conversionRate: number;
  avgSettlement: number;
};

/** Union marketing sources (calls, intakes) with practice-area settlement rows from CMS. */
export function buildAttributionRows(
  summary: CallSummary,
  breakdown: CmsAttributionBreakdown[],
  intakesBySource: CmsIntakeSource[],
): AttributionTableRow[] {
  const intakeMap = new Map(
    intakesBySource.map((r) => [r.source, r.count] as const),
  );
  const attrMap = new Map(
    breakdown.map((r) => [r.area_of_law, r] as const),
  );
  const keys = new Set<string>();
  for (const c of summary.callsBySource ?? []) {
    keys.add(c.name);
  }
  for (const s of intakeMap.keys()) {
    keys.add(s);
  }
  for (const b of breakdown) {
    keys.add(b.area_of_law);
  }

  const rows: AttributionTableRow[] = [...keys].map((source) => {
    const totalCalls =
      summary.callsBySource?.find((x) => x.name === source)?.value ?? 0;
    const intakes = intakeMap.get(source) ?? 0;
    const attr = attrMap.get(source);
    const mattersOpened = attr?.settlement_count ?? 0;
    const totalSettlementValue = attr?.total_settlement_value ?? 0;
    const conversionRate =
      totalCalls > 0 ? Math.round((intakes / totalCalls) * 1000) / 10 : 0;
    const avgSettlement =
      mattersOpened > 0 ? totalSettlementValue / mattersOpened : 0;
    return {
      source,
      totalCalls,
      intakes,
      mattersOpened,
      totalSettlementValue,
      conversionRate,
      avgSettlement,
    };
  });

  rows.sort((a, b) => {
    if (b.totalSettlementValue !== a.totalSettlementValue) {
      return b.totalSettlementValue - a.totalSettlementValue;
    }
    if (b.totalCalls !== a.totalCalls) return b.totalCalls - a.totalCalls;
    return a.source.localeCompare(b.source);
  });

  return rows;
}
