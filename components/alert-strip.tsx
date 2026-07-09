"use client";

/**
 * Alert strip (Huraqan design system §6).
 *
 * A navy strip pinned above all page content that surfaces ONLY real action
 * items: integrations that are broken or need reconnecting, and content waiting
 * for approval. It pulls from the same live sources the Integrations and
 * Production Board pages use — nothing here is decorative or hardcoded.
 *
 * Per the spec: if there is nothing to act on, the strip renders nothing at all
 * (no "everything's good" message). Mounted once in LayoutShell, so it fetches
 * once per full load and persists across client navigation.
 */

import Link from "next/link";

import { useSystemStatus, type IntegrationStatus } from "@/components/system-status";

type Chip = { tone: "critical" | "warning"; label: string; href: string };

// Only these integration states are real, actionable problems. "missing_env" /
// "needs_setup" mean an (often optional) integration was never configured —
// that belongs on the Integrations page, not as an alert, so we don't surface
// it here and drown out genuine breakage.
const ALERTABLE = new Set(["error", "needs_oauth"]);

const MAX_CHIPS = 6;

function buildChips(
  integrations: IntegrationStatus[],
  reviewCount: number,
  criticalIssues: number,
): Chip[] {
  const chips: Chip[] = [];

  for (const i of integrations) {
    if (!ALERTABLE.has(i.status)) continue;
    chips.push({
      tone: i.status === "error" ? "critical" : "warning",
      label: i.status === "error" ? `${i.label} error` : `${i.label} needs reconnect`,
      href: "/integrations",
    });
  }

  if (criticalIssues > 0) {
    chips.push({
      tone: "critical",
      label: `${criticalIssues} critical site issue${criticalIssues > 1 ? "s" : ""}`,
      href: "/ai-search",
    });
  }

  if (reviewCount > 0) {
    chips.push({
      tone: "warning",
      label: `${reviewCount} item${reviewCount > 1 ? "s" : ""} awaiting approval`,
      href: "/content-production",
    });
  }

  // Criticals first so the most urgent stays visible if we cap the list.
  chips.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "critical" ? -1 : 1));
  return chips;
}

const CHIP_CLASS: Record<Chip["tone"], string> = {
  critical: "bg-red-500/15 border-red-500/30",
  warning: "bg-amber-500/15 border-amber-500/30",
};

export function AlertStrip() {
  const { integrations, reviewCount, criticalIssues, loaded } = useSystemStatus();

  // Nothing to act on (or still loading) → render nothing, per spec §6.
  if (!loaded) return null;
  const chips = buildChips(integrations, reviewCount, criticalIssues);
  if (chips.length === 0) return null;

  const shown = chips.slice(0, MAX_CHIPS);
  const overflow = chips.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-2 bg-[#0D1F3C] px-5 py-2.5">
      {shown.map((c, i) => (
        <Link
          key={i}
          href={c.href}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] font-medium text-white hover:brightness-125 ${CHIP_CLASS[c.tone]}`}
        >
          <span aria-hidden>{c.tone === "critical" ? "⚠" : "⏱"}</span>
          {c.label}
        </Link>
      ))}
      {overflow > 0 && (
        <Link href="/integrations" className="text-[11px] font-medium text-white/60 hover:text-white">
          +{overflow} more
        </Link>
      )}
    </div>
  );
}
