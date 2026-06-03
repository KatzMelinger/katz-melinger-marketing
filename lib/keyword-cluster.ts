/**
 * Keyword cluster classifier — groups employment-law keywords into practice-area
 * "clusters" so the competitor-opportunity table can be sorted/filtered by theme.
 *
 * Same shape as lib/keyword-geo.ts: a deterministic, rule-based substring match
 * (no AI cost, runs client-side, instant). First match wins, so more specific
 * topics are listed before the broad "general employment" fallback. Anything
 * that matches nothing lands in the "other" cluster.
 *
 * The taxonomy is tuned for a NY/NJ employment-law firm. Tune the term lists as
 * the keyword set evolves — the classifier is intentionally simple to read.
 */

export type ClusterKey =
  | "wage_hour"
  | "discrimination"
  | "harassment"
  | "retaliation"
  | "wrongful_termination"
  | "leave"
  | "severance_contract"
  | "class_action"
  | "workers_comp"
  | "general"
  | "other";

type ClusterDef = { key: ClusterKey; label: string; matches: string[] };

// Order matters: first match wins. Specific practice areas come before the
// broad "general employment" bucket so e.g. "employment lawyer for sexual
// harassment" classifies as Harassment, not General. Short/ambiguous tokens are
// space-padded (" sex ") to enforce word boundaries — the keyword is wrapped in
// spaces before matching, mirroring lib/keyword-geo.ts.
const CLUSTERS: ClusterDef[] = [
  {
    key: "harassment",
    label: "Harassment",
    matches: ["harass", "hostile work", "hostile workplace", "hostile environment"],
  },
  {
    key: "discrimination",
    label: "Discrimination",
    matches: [
      "discriminat",
      "ageism",
      "racial",
      " race ",
      "gender",
      " sex ",
      "sexual orientation",
      "pregnan",
      "national origin",
      "religious",
      "disability discrimination",
      "eeoc",
    ],
  },
  {
    key: "retaliation",
    label: "Retaliation & Whistleblower",
    matches: ["retaliat", "whistleblow", "whistle blow", "reprisal"],
  },
  {
    key: "wrongful_termination",
    label: "Wrongful Termination",
    matches: [
      "wrongful termination",
      "wrongful discharge",
      "wrongful dismissal",
      "unlawful termination",
      "illegally fired",
      "unfairly fired",
      "wrongfully fired",
      "wrongful firing",
    ],
  },
  {
    key: "leave",
    label: "Leave & FMLA",
    matches: [
      "fmla",
      "family leave",
      "medical leave",
      "maternity",
      "paternity",
      "parental leave",
      "sick leave",
      "paid leave",
      "disability leave",
      "leave of absence",
    ],
  },
  {
    key: "wage_hour",
    label: "Wage & Hour",
    matches: [
      "overtime",
      "minimum wage",
      "unpaid wage",
      "unpaid overtime",
      "wage theft",
      "off the clock",
      "off-the-clock",
      "prevailing wage",
      "back pay",
      "final paycheck",
      "unpaid commission",
      "tip pool",
      "tipped",
      "misclassif",
      "1099",
    ],
  },
  {
    key: "severance_contract",
    label: "Severance & Contracts",
    matches: [
      "severance",
      "non-compete",
      "noncompete",
      "non compete",
      "employment contract",
      "employment agreement",
      "non-disclosure",
      " nda ",
      "restrictive covenant",
      "non-solicit",
      "nonsolicit",
    ],
  },
  {
    key: "class_action",
    label: "Class Action",
    matches: ["class action", "collective action", "class-action"],
  },
  {
    key: "workers_comp",
    label: "Workers' Comp & Safety",
    matches: [
      "workers comp",
      "workers' comp",
      "workman",
      "workplace injury",
      "work injury",
      "injured at work",
      "osha",
      "workplace safety",
    ],
  },
  {
    key: "general",
    label: "General Employment",
    matches: [
      "employment lawyer",
      "employment attorney",
      "employment law",
      "labor lawyer",
      "labor law",
      "labor attorney",
      "employee rights",
      "workers rights",
      "worker rights",
      "employment dispute",
      "employment claim",
      "termination",
      " fired",
    ],
  },
];

export type KeywordCluster = { key: ClusterKey; label: string };

const OTHER: KeywordCluster = { key: "other", label: "Other" };

export function classifyKeywordCluster(keyword: string): KeywordCluster {
  // Pad with spaces so " sex " / " race " / " nda " word-boundary matches work
  // on the keyword's edges too.
  const lc = " " + keyword.toLowerCase() + " ";
  for (const c of CLUSTERS) {
    if (c.matches.some((m) => lc.includes(m))) {
      return { key: c.key, label: c.label };
    }
  }
  return OTHER;
}

// Filter options for the UI ("All clusters" + one per cluster, in display order).
export const CLUSTER_FILTER_OPTIONS = [
  { value: "all" as const, label: "All clusters" },
  ...CLUSTERS.map((c) => ({ value: c.key, label: c.label })),
  { value: "other" as const, label: OTHER.label },
];

export type ClusterFilter = ClusterKey | "all";
