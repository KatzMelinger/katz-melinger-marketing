"use client";

/**
 * Light-theme primitives shared by the AEO/alerts/correlation/llms-txt/
 * recommendations/cannibalization/internal-links/ai-search pages.
 */

import { type ReactNode } from "react";

export function DashShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {children}
    </main>
  );
}

export function DashCard({
  children,
  className = "",
  padding = "p-5",
}: {
  children: ReactNode;
  className?: string;
  padding?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${padding} ${className}`}
    >
      {children}
    </div>
  );
}

export function DashButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline" | "ghost" | "danger";
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-[#185FA5] text-white hover:bg-[#1f6fb8]",
    outline: "border border-slate-300 text-slate-700 hover:border-[#185FA5] hover:text-[#185FA5]",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    danger: "border border-red-300 text-red-700 hover:bg-red-50",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function DashPill({
  tone,
  children,
}: {
  tone: "emerald" | "red" | "amber" | "blue" | "violet" | "neutral";
  children: ReactNode;
}) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    red: "bg-red-50 text-red-700 border border-red-200",
    amber: "bg-amber-50 text-amber-700 border border-amber-200",
    blue: "bg-blue-50 text-blue-700 border border-blue-200",
    violet: "bg-violet-50 text-violet-700 border border-violet-200",
    neutral: "bg-slate-50 text-slate-600 border border-slate-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${colors[tone]}`}>
      {children}
    </span>
  );
}

export function DashSpinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin ${className}`}
      style={{ width: "1em", height: "1em" }}
      aria-hidden
    >
      ◐
    </span>
  );
}

export function DashInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { className?: string },
) {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={`px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5] ${className}`}
    />
  );
}

export function DashSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & { className?: string },
) {
  const { className = "", children, ...rest } = props;
  return (
    <select
      {...rest}
      className={`px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#185FA5]/30 focus:border-[#185FA5] ${className}`}
    >
      {children}
    </select>
  );
}

export function DashBar({
  pct,
  tone = "blue",
}: {
  pct: number;
  tone?: "self" | "competitor" | "blue";
}) {
  const bg =
    tone === "self" ? "bg-emerald-500" : tone === "competitor" ? "bg-amber-500" : "bg-[#185FA5]";
  return (
    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-full ${bg}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, transition: "width 0.5s" }}
      />
    </div>
  );
}
