/**
 * Rules for the Radar's weekly discovery (Oct 6 spec, Task 16). Pure.
 *
 * Trend: from 12+ months of searches (oldest first), trend_3m is the last
 * three months' average over the three before, minus one; trend_yoy compares
 * the last three months with the same three a year earlier (needs 15 months;
 * DataForSEO usually returns 12, so it is often null). "Rising" when either is
 * over 30 percent with at least 30 searches a month.
 *
 * Firm facts: discovery drops terms the firm cannot act on (personal injury
 * and other practices it does not handle, employer-side employment, debtor-side
 * collections, places outside New York and New Jersey) and agency-intent
 * collections searches unless they ask for a lawyer.
 */
import { classifyKeywordGeo } from "./keyword-geo";

export type Trend = { trend3m: number | null; trendYoy: number | null; rising: boolean; avg3: number | null };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeTrend(monthly: number[]): Trend {
  const m = monthly.filter((x) => Number.isFinite(x));
  if (m.length < 6) return { trend3m: null, trendYoy: null, rising: false, avg3: m.length >= 3 ? avg(m.slice(-3)) : null };
  const last3 = avg(m.slice(-3));
  const prev3 = avg(m.slice(-6, -3));
  const trend3m = prev3 > 0 ? last3 / prev3 - 1 : null;
  const yearAgo = m.length >= 15 ? avg(m.slice(-15, -12)) : 0;
  const trendYoy = m.length >= 15 && yearAgo > 0 ? last3 / yearAgo - 1 : null;
  const rising = last3 >= 30 && ((trend3m ?? 0) > 0.3 || (trendYoy ?? 0) > 0.3);
  return { trend3m, trendYoy, rising, avg3: last3 };
}

const OFF_PRACTICE =
  /\b(personal injury|car accident|auto accident|slip and fall|workers'? comp(?:ensation)?|criminal|dui|dwi|immigration|family law|divorce|custody|bankruptcy|estate planning|probate|medical malpractice|real estate closing|patent|trademark|social security disability)\b/i;
const EMPLOYER_SIDE =
  /\b(for employers|employer defen[cs]e|defend(?:ing)? (?:an? )?(?:employment|discrimination|wage) (?:claim|lawsuit|case)s?|management[- ]side|hr compliance|employer (?:attorney|lawyer)|employer'?s? (?:attorney|lawyer)|(?:how to )?fire an employee|terminate an employee legally)\b/i;
const DEBTOR_SIDE =
  /\b(debt relief|debt settlement|stop (?:a )?(?:wage )?garnishment|get out of (?:a )?judgment|vacate (?:a )?(?:default )?judgment|dispute (?:a )?debt|sued (?:by|for) (?:a )?(?:debt|creditor)|being sued for debt|collection harassment|debt collector harassment|fdcpa (?:violation|lawsuit)|judgment proof|avoid paying)\b/i;
const AGENCY = /\b(collection agenc(?:y|ies)|debt collection agenc(?:y|ies)|collections agenc(?:y|ies)|debt collector)\b/i;
const LAWYER = /\b(lawyers?|attorneys?|law firms?)\b/i;

/** Why discovery drops this term, or null to keep it. */
export function radarExclusion(keyword: string): string | null {
  const k = keyword.toLowerCase();
  if (OFF_PRACTICE.test(k)) return "Practice the firm does not handle";
  if (EMPLOYER_SIDE.test(k)) return "Employer-side employment";
  if (DEBTOR_SIDE.test(k)) return "Debtor-side collections";
  if (AGENCY.test(k) && !LAWYER.test(k)) return "Collection agency intent (no lawyer in the search)";
  if (classifyKeywordGeo(k).state === "other_state") return "Location outside New York and New Jersey";
  return null;
}

/** The practice-area seed lists the spec names. */
export const RADAR_SEEDS: Record<"employment" | "collections", string[]> = {
  employment: [
    "discrimination lawyer",
    "retaliation lawyer",
    "wrongful termination",
    "wage and hour",
    "overtime",
    "fmla",
    "severance",
    "non compete",
    "harassment lawyer",
  ],
  collections: ["commercial collections", "judgment enforcement", "information subpoena", "restraining notice"],
};

/** "term | note" lines from the law-change list in Brand settings. */
export function parseLawChanges(value: string | null | undefined): { term: string; note: string }[] {
  return (value ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [term, ...rest] = l.split("|");
      return { term: term.trim().toLowerCase(), note: rest.join("|").trim() };
    })
    .filter((x) => x.term.length > 2);
}
