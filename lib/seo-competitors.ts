const DEFAULT_COMPETITORS = [
  "nilawfirm.com",
  "outtengolden.com",
  "nysplaw.com",
  "employeerightslaw.com",
];

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function envCompetitors(): string[] {
  const raw = process.env.SEO_COMPETITOR_DOMAINS ?? "";
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((domain) => normalizeDomain(domain))
    .filter(Boolean);
}

declare global {
  var __seoCompetitors: Set<string> | undefined;
}

function store(): Set<string> {
  if (!globalThis.__seoCompetitors) {
    const combined = [...DEFAULT_COMPETITORS, ...envCompetitors()];
    globalThis.__seoCompetitors = new Set(
      combined.map((domain) => normalizeDomain(domain)).filter(Boolean)
    );
  }
  return globalThis.__seoCompetitors;
}

export function listCompetitors(): string[] {
  return Array.from(store()).sort((a, b) => a.localeCompare(b));
}

export function addCompetitor(domain: string): {
  ok: boolean;
  domain: string;
  reason?: string;
} {
  const normalized = normalizeDomain(domain);
  if (!normalized || !normalized.includes(".")) {
    return { ok: false, domain: normalized, reason: "Invalid domain" };
  }
  store().add(normalized);
  return { ok: true, domain: normalized };
}

