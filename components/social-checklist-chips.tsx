/**
 * Advisory social quality-checklist chips (Rule 10 + Rule 8), shared by the
 * repurpose review drawer and the Content Calendar post drawer so the two stay
 * in sync. Length caps are enforced at generation; these chips inform the
 * reviewer without blocking. An item whose value is `null` (not applicable —
 * e.g. "Sensitive tone" on a non-sensitive topic) is hidden.
 */

/** Structural shape of the checklist stored on a social draft. */
export type SocialChecklistLike = {
  hookFormula: boolean;
  withinCaps: boolean;
  noDashesOrBannedOpeners: boolean;
  statesSpelledOut: boolean;
  softCta: boolean;
  sensitiveToneApplied: boolean | null;
  noDuplicateThisMonth: boolean | null;
};

const ITEMS: { label: string; key: keyof SocialChecklistLike }[] = [
  { label: "Hook", key: "hookFormula" },
  { label: "Length", key: "withinCaps" },
  { label: "Clean copy", key: "noDashesOrBannedOpeners" },
  { label: "NY/NJ spelled out", key: "statesSpelledOut" },
  { label: "Soft CTA", key: "softCta" },
  { label: "Sensitive tone", key: "sensitiveToneApplied" },
  { label: "No repeat this month", key: "noDuplicateThisMonth" },
];

export function SocialChecklistChips({
  checklist,
  className,
}: {
  checklist: SocialChecklistLike;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {ITEMS.map(({ label, key }) => {
        const ok = checklist[key];
        if (ok === null) return null; // not applicable — hide
        return (
          <span
            key={label}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
            title={ok ? `${label}: passes` : `${label}: review — the generated copy may not meet this rule`}
          >
            <span aria-hidden>{ok ? "✓" : "!"}</span>
            {label}
          </span>
        );
      })}
    </div>
  );
}
