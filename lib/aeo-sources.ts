/**
 * Off-site gap list (Oct 6 spec, Task 19): the third-party pages the AI
 * answers cite in the latest sweep (directories, review sites, forums, news),
 * each checked for the firm and for competitors. A source that names a
 * competitor but not the firm is an off-site gap: a listing, review or mention
 * to go and earn.
 *
 * Each cited page is fetched through the SSRF guard (lib/url-safety.ts: the
 * URLs come from model output) with a short timeout; the result is cached per
 * run, since a sweep's citations do not change.
 */
import { getSupabaseAdmin } from "./supabase-server";
import { safeFetch } from "./url-safety";

export type SourceKind = "directory" | "review" | "forum" | "news" | "government" | "legal reference" | "other";

export type CitedSource = {
  domain: string;
  kind: SourceKind;
  citations: number;
  urls: string[];
  checked: number;
  firmPresent: boolean;
  competitorsPresent: string[];
  gap: boolean;
};

const KIND: [RegExp, SourceKind][] = [
  [/\b(avvo|justia|findlaw|lawyers\.com|martindale|superlawyers|bestlawyers|nolo|lawinfo|expertise\.com|threebestrated|attorneys\.com|legalmatch|upcounsel|chambers)\b/, "directory"],
  [/\b(yelp|google|trustpilot|bbb\.org|birdeye|lawyerratingz)\b/, "review"],
  [/\b(reddit|quora|stackexchange|avvo\.com\/legal-answers)\b/, "forum"],
  [/\.gov$|\.gov\b|nysenate|nycourts|njcourts/, "government"],
  [/\b(law\.cornell|casetext|courtlistener|leagle|law360)\b/, "legal reference"],
  [/\b(nytimes|reuters|bloomberg|forbes|cnbc|nbc|abc|cbs|crainsnewyork|amny|nj\.com|patch)\b/, "news"],
];

function kindOf(domain: string): SourceKind {
  for (const [re, k] of KIND) if (re.test(domain)) return k;
  return "other";
}

const cache = new Map<string, CitedSource[]>();
/** Domains whose pages are fetched and checked (two pages each). */
const MAX_DOMAINS = 20;

export async function offSiteSources(tenantId: string): Promise<{ runId: string | null; runAt: string | null; sources: CitedSource[] }> {
  const sb = getSupabaseAdmin();
  const { data: run } = await sb
    .from("aeo_runs")
    .select("id, started_at")
    .eq("tenant_id", tenantId)
    .eq("status", "done")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run) return { runId: null, runAt: null, sources: [] };
  const hit = cache.get(run.id as string);
  if (hit) return { runId: run.id as string, runAt: run.started_at as string, sources: hit };

  const [{ data: responses }, { data: targets }] = await Promise.all([
    sb.from("aeo_responses").select("citations").eq("run_id", run.id),
    sb.from("aeo_targets").select("name, type, domain, aliases").eq("tenant_id", tenantId),
  ]);
  const self = (targets ?? []).filter((t) => t.type === "self");
  const competitors = (targets ?? []).filter((t) => t.type === "competitor");
  const names = (t: { name: string; aliases: unknown }) =>
    [t.name, ...(Array.isArray(t.aliases) ? (t.aliases as string[]) : [])].map((x) => String(x).toLowerCase()).filter((x) => x.length > 3);
  const selfDomains = self.map((t) => String(t.domain ?? "").toLowerCase()).filter(Boolean);

  const byDomain = new Map<string, { citations: number; urls: Set<string> }>();
  for (const r of responses ?? []) {
    for (const c of (r.citations as { url?: string; domain?: string }[] | null) ?? []) {
      const domain = String(c.domain ?? "").toLowerCase().replace(/^www\./, "");
      if (!domain || selfDomains.some((d) => domain.endsWith(d.replace(/^www\./, "")))) continue;
      const e = byDomain.get(domain) ?? { citations: 0, urls: new Set<string>() };
      e.citations++;
      if (c.url) e.urls.add(c.url);
      byDomain.set(domain, e);
    }
  }

  const ranked = [...byDomain.entries()].sort((a, b) => b[1].citations - a[1].citations);
  // The top domains get their pages checked (two each), eight at a time; the
  // rest are listed with their citation count only.
  const checkPage = async (url: string) => {
    try {
      const res = await safeFetch(url, { timeoutMs: 8000, headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketOS AEO source check)" } });
      if (!res.ok) return null;
      return (await res.text()).slice(0, 600_000).toLowerCase();
    } catch {
      return null; // unreachable or blocked: not checked
    }
  };
  const sources: CitedSource[] = ranked.map(([domain, e]) => ({
    domain,
    kind: kindOf(domain),
    citations: e.citations,
    urls: [...e.urls].slice(0, 3),
    checked: 0,
    firmPresent: false,
    competitorsPresent: [],
    gap: false,
  }));
  const toCheck = sources.slice(0, MAX_DOMAINS);
  for (let i = 0; i < toCheck.length; i += 8) {
    await Promise.all(
      toCheck.slice(i, i + 8).map(async (src) => {
        const comps = new Set<string>();
        for (const url of src.urls.slice(0, 2)) {
          const text = await checkPage(url);
          if (text === null) continue;
          src.checked++;
          if (self.some((t) => names(t).some((n) => text.includes(n)))) src.firmPresent = true;
          for (const c of competitors) if (names(c).some((n) => text.includes(n))) comps.add(c.name);
        }
        src.competitorsPresent = [...comps];
        src.gap = src.checked > 0 && !src.firmPresent && comps.size > 0;
      }),
    );
  }
  cache.set(run.id as string, sources);
  return { runId: run.id as string, runAt: run.started_at as string, sources };
}
