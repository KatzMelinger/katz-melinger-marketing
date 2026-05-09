"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type CallsBySourceDatum = { name: string; calls: number };

type Props = {
  data: CallsBySourceDatum[];
};

export function CallsBySourceChart({ data }: Props) {
  if (!data.length) {
    return (
      <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No call data by source yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer
      width="100%"
      height={300}
      style={{ backgroundColor: "transparent" }}
    >
      <BarChart
        data={data}
        margin={{ top: 12, right: 12, left: -8, bottom: 8 }}
        style={{ backgroundColor: "transparent" }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#e2e8f0"
          vertical={false}
        />
        <XAxis
          dataKey="name"
          tick={{ fill: "#475569", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#cbd5e1" }}
          interval={0}
          angle={-12}
          textAnchor="end"
          height={56}
        />
        <YAxis
          tick={{ fill: "#475569", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#cbd5e1" }}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(24, 95, 165, 0.1)" }}
          contentStyle={{
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            color: "#0f172a",
            fontFamily: "Arial, Helvetica, sans-serif",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
          labelStyle={{ color: "#0f172a", fontWeight: 600 }}
          itemStyle={{ color: "#0f172a" }}
        />
        <Bar
          dataKey="calls"
          fill="#185FA5"
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
