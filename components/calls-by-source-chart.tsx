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
      <div
        className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed border-white/10 text-sm text-slate-400"
        style={{ backgroundColor: "rgba(15, 23, 41, 0.35)" }}
      >
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
          stroke="rgba(255, 255, 255, 0.12)"
          vertical={false}
        />
        <XAxis
          dataKey="name"
          tick={{ fill: "#ffffff", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "rgba(255, 255, 255, 0.25)" }}
          interval={0}
          angle={-12}
          textAnchor="end"
          height={56}
        />
        <YAxis
          tick={{ fill: "#ffffff", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "rgba(255, 255, 255, 0.25)" }}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(24, 95, 165, 0.2)" }}
          contentStyle={{
            backgroundColor: "rgba(15, 23, 41, 0.95)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: "8px",
            color: "#ffffff",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
          labelStyle={{ color: "#ffffff" }}
          itemStyle={{ color: "#ffffff" }}
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
