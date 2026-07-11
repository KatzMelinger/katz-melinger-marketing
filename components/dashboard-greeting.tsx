"use client";

/**
 * Dashboard greeting header (Huraqan design system §7).
 *
 * A friendly daily briefing, not a cold "Marketing Intelligence" title: a
 * time-of-day greeting on the left, today's date on the right. Both are
 * computed on the client so the greeting word and date match the viewer's
 * local timezone rather than the server's.
 *
 * The greeting uses the person's first name when we have one; the firm name is
 * kept for the subtitle so the header stays warm even before a name is wired
 * through auth.
 */

import { useHydrated } from "@/lib/use-persistent-state";

function greetingWord(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function DashboardGreeting({
  firstName,
  firmName,
}: {
  firstName?: string | null;
  firmName?: string | null;
}) {
  // Compute the (locale + timezone dependent) greeting word and date only after
  // hydration, so the server render and first client render match. useHydrated
  // is the repo's effect-free mount signal — no setState-in-effect.
  const hydrated = useHydrated();
  const now = hydrated ? new Date() : null;

  const greeting = now ? greetingWord(now.getHours()) : "Welcome";
  const name = firstName?.trim();
  const dateLabel = now
    ? now.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const subtitle = firmName
    ? `Here's what's happening across ${firmName} marketing today.`
    : "Here's what's happening across your marketing today.";

  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">
          {greeting}
          {name ? `, ${name}` : ""}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
      </div>
      {dateLabel && (
        <p className="shrink-0 pt-1 text-xs text-slate-400" suppressHydrationWarning>
          {dateLabel}
        </p>
      )}
    </header>
  );
}
