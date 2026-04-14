"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const COLORS = [
  "#185FA5",
  "#1D9E75",
  "#CA8A04",
  "#A855F7",
  "#E24B4A",
  "#64748b",
  "#0EA5E9",
  "#F97316",
];

type Row = { name: string; value: number };

type Props = {
  data: Row[];
  /** How values are shown in the tooltip (default: USD for settlement-style charts). */
  valueMode?: "currency" | "number";
};

export function RechartsPie({ data, valueMode = "currency" }: Props) {
  if (!data.length) {
    return (
      <p className="text-sm text-slate-400">No data for chart.</p>
    );
  }
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ name, percent }) =>
              `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`
            }
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => {
              if (typeof v !== "number") return String(v ?? "");
              if (valueMode === "number") {
                return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
              }
              return v.toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              });
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
