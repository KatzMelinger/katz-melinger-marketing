import { NextResponse } from "next/server";

import {
  fetchAllCallRailCalls,
  type CallRailCall,
} from "@/lib/callrail-fetch";

export const dynamic = "force-dynamic";

function utcDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toISOString().slice(0, 10);
}

function last30UtcDateKeys(): string[] {
  const keys: string[] = [];
  const end = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

function buildSummary(calls: CallRailCall[]) {
  const totalCalls = calls.length;
  let answeredCalls = 0;
  let missedCalls = 0;
  let firstTimeCalls = 0;
  let durationSum = 0;

  const sourceCounts = new Map<string, number>();
  const dayKeys = last30UtcDateKeys();
  const daySet = new Set(dayKeys);
  const dayCounts = new Map<string, number>();
  for (const k of dayKeys) {
    dayCounts.set(k, 0);
  }

  for (const c of calls) {
    if (c.answered) {
      answeredCalls += 1;
    } else {
      missedCalls += 1;
    }
    if (c.first_call) {
      firstTimeCalls += 1;
    }
    durationSum += c.duration ?? 0;

    const src = c.source_name?.trim() || "Unknown";
    sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);

    const day = utcDateKey(c.start_time);
    if (day && daySet.has(day)) {
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }
  }

  const avgDuration =
    totalCalls > 0 ? Math.round((durationSum / totalCalls) * 100) / 100 : 0;

  const callsBySource = [...sourceCounts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const callsByDay = dayKeys.map((date) => ({
    date,
    value: dayCounts.get(date) ?? 0,
  }));

  return {
    totalCalls,
    answeredCalls,
    missedCalls,
    firstTimeCalls,
    avgDuration,
    callsBySource,
    callsByDay,
  };
}

export async function GET() {
  const apiKey = process.env.CALLRAIL_API_KEY;
  const accountId = process.env.CALLRAIL_ACCOUNT_ID;

  if (!apiKey || !accountId) {
    return NextResponse.json({
      totalCalls: 0,
      answeredCalls: 0,
      missedCalls: 0,
      firstTimeCalls: 0,
      avgDuration: 0,
      callsBySource: [] as { name: string; value: number }[],
      callsByDay: [] as { date: string; value: number }[],
      error: "Missing CALLRAIL_API_KEY or CALLRAIL_ACCOUNT_ID",
    });
  }

  const result = await fetchAllCallRailCalls(apiKey, accountId);

  if (!result.ok) {
    return NextResponse.json({
      totalCalls: 0,
      answeredCalls: 0,
      missedCalls: 0,
      firstTimeCalls: 0,
      avgDuration: 0,
      callsBySource: [],
      callsByDay: last30UtcDateKeys().map((date) => ({ date, value: 0 })),
      error: result.error,
    });
  }

  return NextResponse.json(buildSummary(result.calls));
}
