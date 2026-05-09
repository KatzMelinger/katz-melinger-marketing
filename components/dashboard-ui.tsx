"use client";

/**
 * Dark-theme primitives shared by the AEO/alerts/correlation/llms-txt/
 * recommendations/cannibalization/internal-links/ai-search pages.
 *
 * The legacy pages hardcode their own #0f1729/#1a2540/#2a3f5f/#185FA5
 * palette with inline helpers; this consolidates those into one place
 * so the new pages match the rest of the dashboard without duplicating
 * styling per page.
 */

import { type ReactNode } from "react";

export function DashShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen text-white"
      style={{ backgroundColor: "#0f1729", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {children}
      </main>
    </div>
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
      className={`rounded-xl border border-[#2a3f5f] ${padding} ${className}`}
      style={{ backgroundColor: "#1a2540" }}
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
    outline: "border border-[#2a3f5f] text-slate-200 hover:border-[#185FA5] hover:text-white",
    ghost: "text-slate-300 hover:bg-[#1a2540] hover:text-white",
    danger: "border border-red-500/40 text-red-300 hover:bg-red-500/10",
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
    emerald: "bg-emerald-500/15 text-emerald-300",
    red: "bg-red-500/15 text-red-300",
    amber: "bg-amber-500/15 text-amber-300",
    blue: "bg-blue-500/15 text-blue-300",
    violet: "bg-violet-500/15 text-violet-300",
    neutral: "bg-[#0f1729] text-slate-300 border border-[#2a3f5f]",
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
      className={`px-3 py-2 rounded-md border border-[#2a3f5f] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#185FA5] ${className}`}
      style={{ backgroundColor: "#0f1729" }}
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
      className={`px-3 py-2 rounded-md border border-[#2a3f5f] text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#185FA5] ${className}`}
      style={{ backgroundColor: "#0f1729" }}
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
    <div className="w-full bg-[#0f1729] rounded-full h-1.5 overflow-hidden border border-[#2a3f5f]/60">
      <div
        className={`h-full ${bg}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, transition: "width 0.5s" }}
      />
    </div>
  );
}
