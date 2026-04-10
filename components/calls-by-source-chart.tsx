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

const data = [
  { name: "Google Ads", calls: 89 },
  { name: "Organic Search", calls: 67 },
  { name: "Referral", calls: 45 },
  { name: "Direct", calls: 28 },
  { name: "Avvo", calls: 18 },
];

export function CallsBySourceChart() {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={data}
        margin={{ top: 12, right: 12, left: -8, bottom: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3f5f" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#2a3f5f" }}
          interval={0}
          angle={-12}
          textAnchor="end"
          height={56}
        />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#2a3f5f" }}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(24, 95, 165, 0.12)" }}
          contentStyle={{
            backgroundColor: "#1a2540",
            border: "1px solid #2a3f5f",
            borderRadius: "8px",
            color: "#f8fafc",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
          labelStyle={{ color: "#e2e8f0" }}
        />
        <Bar dataKey="calls" fill="#185FA5" radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}
