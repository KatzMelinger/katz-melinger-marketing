"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MarketingNav } from "@/components/marketing-nav";

const BG = "#0f1729";
const CARD = "#1a2540";
const BORDER = "#2a3f5f";
const ACCENT = "#185FA5";

const REFRESH_MS = 30_000;
const DISCOVERY_CACHE_TTL_MS = 10 * 60_000;
const GBP_ACCOUNTS_CACHE_KEY = "gbp:accounts:cache:v1";
const GBP_LOCATIONS_CACHE_PREFIX = "gbp:locations:cache:v1:";
const GBP_SELECTED_ACCOUNT_KEY = "gbp:selected-account:v1";
const GBP_SELECTED_LOCATION_KEY = "gbp:selected-location:v1";

export type LocalSeoTabId = "gbp" | "reviews" | "rankings" | "citations";

/** GET `/api/local-seo/google-business?action=dashboard` JSON (subset). */
/** Structured Google API error (when the Business Profile API returns non-2xx). */
export interface GoogleApiErrorDetail {
  message: string;
  httpStatus: number;
  httpStatusText?: string;
  googleCode?: number;
  googleStatus?: string;
  details?: unknown;
  rawBody?: string;
}

export interface GbpDashboardApiResponse {
  business?: LocalBusinessInfo;
  gbpReviews?: GbpReviewRow[];
  posts?: GbpPostRow[];
  photos?: GbpPhotoRow[];
  warnings?: string[];
  error?: string;
  googleError?: GoogleApiErrorDetail;
  accountId?: string;
  locationId?: string;
  needsAccountSelection?: boolean;
  needsLocationSelection?: boolean;
  locations?: Array<{ locationId: string; title: string; name: string }>;
  accounts?: Array<{ accountId: string; name: string }>;
  setupHints?: string[];
  discoveryError?: string | null;
  rateLimited?: boolean;
  retryAfterSeconds?: number | null;
  googleBusinessDebug?: unknown;
}

type TimedCache<T> = {
  savedAt: number;
  items: T;
};

function readTimedCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimedCache<T>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.savedAt !== "number" ||
      !("items" in parsed)
    ) {
      return null;
    }
    if (Date.now() - parsed.savedAt > DISCOVERY_CACHE_TTL_MS) return null;
    return parsed.items;
  } catch {
    return null;
  }
}

function writeTimedCache<T>(key: string, items: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    key,
    JSON.stringify({
      savedAt: Date.now(),
      items,
    } satisfies TimedCache<T>),
  );
}

export interface LocalBusinessInfo {
  name: string;
  address: string;
  phone: string;
  website: string;
  hoursSummary: string;
  categories: string[];
}

export interface GbpReviewRow {
  id: string;
  author: string;
  rating: number;
  comment: string;
  date: string;
  responded: boolean;
}

export interface GbpPostRow {
  id: string;
  type: "announcement" | "event" | "offer";
  title: string;
  status: "scheduled" | "live" | "ended";
  startsAt: string;
}

export interface GbpPhotoRow {
  id: string;
  label: string;
  kind: "logo" | "cover" | "interior" | "team";
  addedAt: string;
}

export type ReviewPlatform = "google" | "avvo" | "yelp" | "facebook";

export interface PlatformReviewRow {
  id: string;
  platform: ReviewPlatform;
  author: string;
  rating: number;
  maxRating: number;
  comment: string;
  date: string;
  needsResponse: boolean;
}

export interface ResponseTemplate {
  id: string;
  label: string;
  body: string;
}

export interface KeywordRankingRow {
  keyword: string;
  rank: number | null;
  change: number;
  url: string;
  lastChecked: string;
}

export interface CompetitorRow {
  id: string;
  name: string;
  avgRank: number;
  trend: "up" | "down" | "flat";
}

export type NapMatchLevel = "match" | "partial" | "mismatch";

export interface CitationRow {
  id: string;
  directory: string;
  url: string;
  napMatch: NapMatchLevel;
  issues: string[];
}

/** Full client dashboard state after merging GBP API + static placeholders. */
export interface LocalSeoDashboardData {
  business: LocalBusinessInfo;
  gbpReviews: GbpReviewRow[];
  posts: GbpPostRow[];
  photos: GbpPhotoRow[];
  platformReviews: PlatformReviewRow[];
  responseTemplates: ResponseTemplate[];
  keywordRankings: KeywordRankingRow[];
  competitors: CompetitorRow[];
  citations: CitationRow[];
  warnings: string[];
}

const isDev = process.env.NODE_ENV === "development";

async function fetchLocalSeoDashboard(opts?: {
  accountId?: string | null;
  locationId?: string | null;
}): Promise<{
  data?: LocalSeoDashboardData;
  recovery?: GbpDashboardApiResponse;
  error?: string;
  rateLimited?: boolean;
  retryAfterSeconds?: number | null;
}> {
  const params = new URLSearchParams();
  params.set("action", "dashboard");
  if (isDev) params.set("debug", "1");
  if (opts?.accountId) params.set("accountId", opts.accountId);
  if (opts?.locationId) params.set("locationId", opts.locationId);

  const res = await fetch(`/api/local-seo/google-business?${params.toString()}`, {
    cache: "no-store",
  });
  const data = (await res.json()) as GbpDashboardApiResponse;
  if (data.needsAccountSelection || data.needsLocationSelection) {
    return {
      recovery: data,
      rateLimited: data.rateLimited === true,
      retryAfterSeconds: data.retryAfterSeconds ?? null,
    };
  }
  if (!res.ok) {
    console.warn("[Local SEO] GBP API error response:", {
      status: res.status,
      error: data.error,
      googleError: data.googleError,
      googleBusinessDebug: data.googleBusinessDebug,
    });
    const base = data.error ?? "Failed to load Google Business Profile data";
    const extra =
      data.googleError?.message && !base.includes(data.googleError.message)
        ? ` — ${data.googleError.message}`
        : "";
    return {
      error: `${base}${extra}`,
      rateLimited: data.rateLimited === true,
      retryAfterSeconds: data.retryAfterSeconds ?? null,
    };
  }
  if (!data.business) {
    return { error: "Google Business Profile dashboard payload is missing business data." };
  }
  const platformReviews: PlatformReviewRow[] = [
    ...(data.gbpReviews ?? []).map((r, i) => ({
      id: `google-${r.id}-${i}`,
      platform: "google" as const,
      author: r.author,
      rating: r.rating,
      maxRating: 5,
      comment: r.comment,
      date: r.date,
      needsResponse: !r.responded,
    })),
    ...MOCK_NON_GOOGLE_PLATFORM_REVIEWS,
  ];
  return {
    data: {
    business: data.business,
    gbpReviews: data.gbpReviews ?? [],
    posts: data.posts ?? [],
    photos: data.photos ?? [],
    platformReviews,
    responseTemplates: MOCK_TEMPLATES,
    keywordRankings: MOCK_KEYWORD_RANKINGS,
    competitors: MOCK_COMPETITORS,
    citations: MOCK_CITATIONS,
    warnings: data.warnings ?? [],
    },
  };
}

/** Other platforms remain sample data until additional integrations exist. */
const MOCK_NON_GOOGLE_PLATFORM_REVIEWS: PlatformReviewRow[] = [
  {
    id: "pr2",
    platform: "yelp",
    author: "J.D.",
    rating: 3,
    maxRating: 5,
    comment: "Good lawyers but parking was tough.",
    date: "2026-04-05",
    needsResponse: true,
  },
  {
    id: "pr3",
    platform: "avvo",
    author: "Former client",
    rating: 10,
    maxRating: 10,
    comment: "Excellent representation in FLSA matter.",
    date: "2026-03-20",
    needsResponse: false,
  },
  {
    id: "pr4",
    platform: "facebook",
    author: "Lisa M.",
    rating: 2,
    maxRating: 5,
    comment: "Still waiting for someone to return my message.",
    date: "2026-03-18",
    needsResponse: true,
  },
];

const MOCK_TEMPLATES: ResponseTemplate[] = [
  {
    id: "t1",
    label: "Thank you (5 stars)",
    body: "Thank you for taking the time to share your experience. We’re glad we could help and appreciate your trust in Katz & Melinger.",
  },
  {
    id: "t2",
    label: "Concern — invite offline",
    body: "We’re sorry your experience didn’t meet expectations. We’d like to understand more. Please call our office at (212) 555-0140 or reply with a good time to connect.",
  },
  {
    id: "t3",
    label: "Neutral — professional",
    body: "We appreciate your feedback and are always working to improve. Thank you for choosing Katz & Melinger.",
  },
];

const MOCK_KEYWORD_RANKINGS: KeywordRankingRow[] = [
  {
    keyword: "employment lawyer NYC",
    rank: 4,
    change: 2,
    url: "https://www.katzmelinger.com/employment-law",
    lastChecked: "2026-04-18T14:00:00Z",
  },
  {
    keyword: "wage hour attorney",
    rank: 7,
    change: -1,
    url: "https://www.katzmelinger.com/wage-hour",
    lastChecked: "2026-04-18T14:00:00Z",
  },
  {
    keyword: "wrongful termination lawyer Manhattan",
    rank: 12,
    change: 3,
    url: "https://www.katzmelinger.com/wrongful-termination",
    lastChecked: "2026-04-18T14:00:00Z",
  },
  {
    keyword: "FLSA lawyer New York",
    rank: null,
    change: 0,
    url: "https://www.katzmelinger.com/flsa",
    lastChecked: "2026-04-17T09:30:00Z",
  },
];

const MOCK_COMPETITORS: CompetitorRow[] = [
  { id: "c1", name: "Metro Employment Law Group", avgRank: 3.2, trend: "up" },
  { id: "c2", name: "Hudson Workplace Legal", avgRank: 5.1, trend: "flat" },
  { id: "c3", name: "Downtown Labor Advocates", avgRank: 8.4, trend: "down" },
];

const MOCK_CITATIONS: CitationRow[] = [
  {
    id: "ci1",
    directory: "Avvo",
    url: "https://www.avvo.com/attorneys/ny-new-york",
    napMatch: "match",
    issues: [],
  },
  {
    id: "ci2",
    directory: "FindLaw",
    url: "https://lawyers.findlaw.com/",
    napMatch: "partial",
    issues: ["Suite number differs from GBP"],
  },
  {
    id: "ci3",
    directory: "Justia",
    url: "https://www.justia.com/",
    napMatch: "match",
    issues: [],
  },
  {
    id: "ci4",
    directory: "Martindale-Hubbell",
    url: "https://www.martindale.com/",
    napMatch: "mismatch",
    issues: ["Old phone format", "Missing suite"],
  },
  {
    id: "ci5",
    directory: "NYC Bar Association",
    url: "https://www.nycbar.org/",
    napMatch: "partial",
    issues: ["Website URL not listed"],
  },
];

function platformLabel(p: ReviewPlatform): string {
  switch (p) {
    case "google":
      return "Google";
    case "avvo":
      return "Avvo";
    case "yelp":
      return "Yelp";
    case "facebook":
      return "Facebook";
    default:
      return p;
  }
}

function normalizeRating(row: PlatformReviewRow): number {
  return row.rating / row.maxRating;
}

function aggregateRating(reviews: PlatformReviewRow[]): number {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((s, r) => s + normalizeRating(r) * 5, 0);
  return sum / reviews.length;
}

function napTone(m: CitationRow["napMatch"]): { className: string; label: string } {
  if (m === "match") return { className: "text-emerald-400", label: "NAP match" };
  if (m === "partial")
    return { className: "text-amber-300", label: "Partial match" };
  return { className: "text-rose-400", label: "Mismatch" };
}

export default function LocalSeoPlatformPage() {
  const [activeTab, setActiveTab] = useState<LocalSeoTabId>("gbp");
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [business, setBusiness] = useState<LocalBusinessInfo | null>(null);
  const [gbpReviews, setGbpReviews] = useState<GbpReviewRow[]>([]);
  const [posts, setPosts] = useState<GbpPostRow[]>([]);
  const [photos, setPhotos] = useState<GbpPhotoRow[]>([]);
  const [platformReviews, setPlatformReviews] = useState<PlatformReviewRow[]>([]);
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [keywordRankings, setKeywordRankings] = useState<KeywordRankingRow[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([]);
  const [citations, setCitations] = useState<CitationRow[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [gbpWarnings, setGbpWarnings] = useState<string[]>([]);
  const [recoveryState, setRecoveryState] = useState<GbpDashboardApiResponse | null>(null);
  const [accounts, setAccounts] = useState<Array<{ accountId: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ locationId: string; title: string; name: string }>>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [discoveringAccounts, setDiscoveringAccounts] = useState(false);
  const [discoveringLocations, setDiscoveringLocations] = useState(false);
  const [useCachedDiscovery, setUseCachedDiscovery] = useState(true);
  const [rateLimitRetryAt, setRateLimitRetryAt] = useState<number | null>(null);
  const [retryCountdownSec, setRetryCountdownSec] = useState(0);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [saStatus, setSaStatus] = useState<unknown>(null);
  const [gbpTest, setGbpTest] = useState<unknown>(null);
  const [gbpTestLoading, setGbpTestLoading] = useState(false);

  useEffect(() => {
    console.log(
      "[Local SEO] Client: GOOGLE_SERVICE_ACCOUNT_JSON is only read on the server (API routes).",
    );
    void (async () => {
      try {
        const r = await fetch("/api/google-service-account/status", {
          cache: "no-store",
        });
        const j: unknown = await r.json();
        console.log("[Local SEO] GET /api/google-service-account/status →", j);
        setSaStatus(j);
      } catch (e) {
        console.error("[Local SEO] service account status failed:", e);
      }
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cachedAccount = localStorage.getItem(GBP_SELECTED_ACCOUNT_KEY) ?? "";
    const cachedLocation = localStorage.getItem(GBP_SELECTED_LOCATION_KEY) ?? "";
    if (cachedAccount) setSelectedAccountId(cachedAccount);
    if (cachedLocation) setSelectedLocationId(cachedLocation);

    const cachedAccounts = readTimedCache<Array<{ accountId: string; name: string }>>(
      GBP_ACCOUNTS_CACHE_KEY,
    );
    if (cachedAccounts?.length) setAccounts(cachedAccounts);

    if (cachedAccount) {
      const cachedLocations = readTimedCache<
        Array<{ locationId: string; title: string; name: string }>
      >(`${GBP_LOCATIONS_CACHE_PREFIX}${cachedAccount}`);
      if (cachedLocations?.length) setLocations(cachedLocations);
    }
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (silent && rateLimitRetryAt && Date.now() < rateLimitRetryAt) {
      return;
    }
    if (silent) setIsRefreshing(true);
    else {
      setLoading(true);
      setError(null);
      setGbpWarnings([]);
      setPostError(null);
    }
    try {
      const result = await fetchLocalSeoDashboard({
        accountId: selectedAccountId || null,
        locationId: selectedLocationId || null,
      });
      if (result.rateLimited && result.retryAfterSeconds) {
        setRateLimitRetryAt(Date.now() + result.retryAfterSeconds * 1000);
      } else if (!result.rateLimited) {
        setRateLimitRetryAt(null);
      }
      if (result.error) {
        setError(result.error);
        if (!silent) setBusiness(null);
      } else if (result.recovery) {
        setRecoveryState(result.recovery);
        setAccounts(result.recovery.accounts ?? []);
        setLocations(result.recovery.locations ?? []);
        if (result.recovery.accountId) {
          setSelectedAccountId(result.recovery.accountId);
        } else if (result.recovery.accounts?.length && !selectedAccountId) {
          setSelectedAccountId(result.recovery.accounts[0]?.accountId ?? "");
        }
        if (result.recovery.locations?.length) {
          const hasCurrent = result.recovery.locations.some(
            (row) => row.locationId === selectedLocationId,
          );
          if (!hasCurrent) {
            setSelectedLocationId(result.recovery.locations[0]?.locationId ?? "");
          }
        } else if (result.recovery.locationId) {
          setSelectedLocationId(result.recovery.locationId);
        }
        setError(result.recovery.error ?? "Choose a valid account and location.");
        if (!silent) setBusiness(null);
      } else if (result.data) {
        const data = result.data;
        setRecoveryState(null);
        setBusiness(data.business);
        setGbpReviews(data.gbpReviews);
        setPosts(data.posts);
        setPhotos(data.photos);
        setPlatformReviews(data.platformReviews);
        setTemplates(data.responseTemplates);
        setKeywordRankings(data.keywordRankings);
        setCompetitors(data.competitors);
        setCitations(data.citations);
        setGbpWarnings(data.warnings);
        setLastLoadedAt(new Date().toISOString());
        if (silent) setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load local SEO data");
      if (!silent) setBusiness(null);
    } finally {
      if (silent) setIsRefreshing(false);
      else setLoading(false);
    }
  }, [rateLimitRetryAt, selectedAccountId, selectedLocationId]);

  const discoverAccounts = useCallback(async (opts?: { forceNetwork?: boolean }) => {
    const forceNetwork = opts?.forceNetwork === true;
    if (useCachedDiscovery && !forceNetwork) {
      const cached = readTimedCache<Array<{ accountId: string; name: string }>>(
        GBP_ACCOUNTS_CACHE_KEY,
      );
      if (cached?.length) {
        setAccounts(cached);
        if (!selectedAccountId) setSelectedAccountId(cached[0]?.accountId ?? "");
        return;
      }
    }
    setDiscoveringAccounts(true);
    try {
      const params = new URLSearchParams();
      params.set("action", "accounts");
      if (isDev) params.set("debug", "1");
      const res = await fetch(`/api/local-seo/google-business?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        accounts?: Array<{ accountId: string; name: string }>;
        error?: string;
        rateLimited?: boolean;
        retryAfterSeconds?: number | null;
      };
      if (!res.ok) {
        setError(json.error ?? `Failed to discover accounts (${res.status})`);
        if (json.rateLimited && json.retryAfterSeconds) {
          setRateLimitRetryAt(Date.now() + json.retryAfterSeconds * 1000);
        }
        return;
      }
      const rows = Array.isArray(json.accounts) ? json.accounts : [];
      setAccounts(rows);
      writeTimedCache(GBP_ACCOUNTS_CACHE_KEY, rows);
      setRateLimitRetryAt(null);
      if (rows.length && !selectedAccountId) {
        setSelectedAccountId(rows[0]?.accountId ?? "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to discover accounts");
    } finally {
      setDiscoveringAccounts(false);
    }
  }, [selectedAccountId, useCachedDiscovery]);

  const discoverLocations = useCallback(async (accountId: string, opts?: { forceNetwork?: boolean }) => {
    if (!accountId) return;
    const forceNetwork = opts?.forceNetwork === true;
    if (useCachedDiscovery && !forceNetwork) {
      const cached = readTimedCache<Array<{ locationId: string; title: string; name: string }>>(
        `${GBP_LOCATIONS_CACHE_PREFIX}${accountId}`,
      );
      if (cached?.length) {
        setLocations(cached);
        if (!selectedLocationId) setSelectedLocationId(cached[0]?.locationId ?? "");
        return;
      }
    }
    setDiscoveringLocations(true);
    try {
      const params = new URLSearchParams();
      params.set("action", "locations");
      params.set("accountId", accountId);
      if (isDev) params.set("debug", "1");
      const res = await fetch(`/api/local-seo/google-business?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        locations?: Array<{ locationId: string; title: string; name: string }>;
        error?: string;
        rateLimited?: boolean;
        retryAfterSeconds?: number | null;
      };
      if (!res.ok) {
        setError(json.error ?? `Failed to discover locations (${res.status})`);
        if (json.rateLimited && json.retryAfterSeconds) {
          setRateLimitRetryAt(Date.now() + json.retryAfterSeconds * 1000);
        }
        setLocations([]);
        return;
      }
      const rows = Array.isArray(json.locations) ? json.locations : [];
      setLocations(rows);
      writeTimedCache(`${GBP_LOCATIONS_CACHE_PREFIX}${accountId}`, rows);
      setRateLimitRetryAt(null);
      if (rows.length && !selectedLocationId) {
        setSelectedLocationId(rows[0]?.locationId ?? "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to discover locations");
      setLocations([]);
    } finally {
      setDiscoveringLocations(false);
    }
  }, [selectedLocationId, useCachedDiscovery]);

  const createLocalPost = useCallback(
    async (topicType: "STANDARD" | "EVENT" | "OFFER") => {
      const kind =
        topicType === "STANDARD"
          ? "announcement"
          : topicType === "EVENT"
            ? "event"
            : "offer";
      const summary = window.prompt(`Enter the main text for your ${kind} post:`);
      if (!summary?.trim()) return;
      let title: string | undefined;
      if (topicType === "EVENT") {
        const t = window.prompt("Event title (optional):", summary.slice(0, 80));
        title = t?.trim() || summary.slice(0, 80);
      }
      setPosting(true);
      setPostError(null);
      try {
        const res = await fetch("/api/local-seo/google-business", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topicType,
            summary: summary.trim(),
            title,
            websiteUrl:
              business?.website && business.website !== "—"
                ? business.website
                : undefined,
            accountId: selectedAccountId || undefined,
            locationId: selectedLocationId || undefined,
          }),
        });
        const payload = (await res.json()) as {
          error?: string;
          rateLimited?: boolean;
          retryAfterSeconds?: number | null;
        };
        if (!res.ok) {
          if (payload.rateLimited && payload.retryAfterSeconds) {
            setRateLimitRetryAt(Date.now() + payload.retryAfterSeconds * 1000);
          }
          throw new Error(payload.error ?? "Failed to create post");
        }
        await load();
      } catch (e) {
        setPostError(e instanceof Error ? e.message : "Failed to create post");
      } finally {
        setPosting(false);
      }
    },
    [business?.website, load, selectedAccountId, selectedLocationId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedAccountId) localStorage.setItem(GBP_SELECTED_ACCOUNT_KEY, selectedAccountId);
  }, [selectedAccountId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedLocationId) localStorage.setItem(GBP_SELECTED_LOCATION_KEY, selectedLocationId);
  }, [selectedLocationId]);

  useEffect(() => {
    if ((recoveryState?.needsAccountSelection || !accounts.length) && !selectedAccountId) {
      void discoverAccounts();
    }
  }, [
    accounts.length,
    discoverAccounts,
    recoveryState?.needsAccountSelection,
    selectedAccountId,
  ]);

  useEffect(() => {
    if (selectedAccountId) {
      void discoverLocations(selectedAccountId);
    }
  }, [discoverLocations, selectedAccountId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!rateLimitRetryAt) {
      setRetryCountdownSec(0);
      return;
    }
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((rateLimitRetryAt - Date.now()) / 1000));
      setRetryCountdownSec(seconds);
      if (seconds <= 0) setRateLimitRetryAt(null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [rateLimitRetryAt]);

  const overallRating = useMemo(
    () => aggregateRating(platformReviews),
    [platformReviews],
  );

  const flaggedNegative = useMemo(
    () =>
      platformReviews.filter(
        (r) => r.needsResponse || normalizeRating(r) * 5 < 3.5,
      ),
    [platformReviews],
  );

  const tabBtn = (id: LocalSeoTabId, label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
        activeTab === id
          ? "bg-[#1a2540] text-white ring-1 ring-[#185FA5]/50"
          : "text-slate-400 hover:bg-[#1a2540]/60 hover:text-white"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="min-h-full text-white"
      style={{ backgroundColor: BG, fontFamily: "Arial, sans-serif" }}
    >
      <MarketingNav />
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Local SEO</h1>
            <p className="mt-1 text-sm text-slate-400">
              Google Business Profile data from the Business Profile API; rankings and
              citations use sample data until those sources are connected. Auto-refresh
              every {Math.round(REFRESH_MS / 1000)}s.
            </p>
            {lastLoadedAt ? (
              <p className="mt-1 text-xs text-slate-500">
                Last loaded: {new Date(lastLoadedAt).toLocaleString()}
                {isRefreshing ? (
                  <span className="ml-2 text-sky-400" aria-live="polite">
                    Updating…
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || isRefreshing}
            className="self-start rounded-md border border-[#2a3f5f] bg-[#0f1729] px-4 py-2 text-sm text-slate-200 hover:bg-[#1a2540] disabled:opacity-50"
          >
            {loading || isRefreshing ? "Refreshing…" : "Refresh data"}
          </button>
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={useCachedDiscovery}
            onChange={(e) => setUseCachedDiscovery(e.target.checked)}
            className="h-4 w-4 rounded border-[#2a3f5f] bg-[#0f1729] text-[#185FA5] focus:ring-[#185FA5]"
          />
          Use cached account/location discovery when available (reduces Google API calls)
        </label>

        <div className="flex flex-wrap gap-2 border-b border-[#2a3f5f] pb-3">
          {tabBtn("gbp", "Google Business Profile")}
          {tabBtn("reviews", "Reviews")}
          {tabBtn("rankings", "Rankings")}
          {tabBtn("citations", "Citations")}
        </div>

        {rateLimitRetryAt ? (
          <div
            className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-100"
            role="status"
          >
            Google Business Profile API quota is temporarily rate-limited. Retrying in{" "}
            <span className="font-semibold tabular-nums">{retryCountdownSec}s</span>.
            <span className="ml-2 text-amber-200/80">
              Tip: keep "Use cached account/location discovery" enabled to reduce calls.
            </span>
          </div>
        ) : null}

        {error ? (
          <div
            className="rounded-lg border border-amber-800/50 p-4 text-sm text-amber-100"
            style={{ backgroundColor: CARD }}
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {recoveryState?.needsAccountSelection || recoveryState?.needsLocationSelection ? (
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="text-lg font-semibold text-white">Select Business Profile location</h2>
            <p className="mt-1 text-sm text-slate-400">
              The configured location ID is missing or invalid. Choose an account and location from discovery.
            </p>
            {recoveryState?.discoveryError ? (
              <p className="mt-2 text-sm text-rose-300">{recoveryState.discoveryError}</p>
            ) : null}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="text-xs text-slate-400">Business account</span>
                <select
                  className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                  value={selectedAccountId}
                  onChange={(e) => {
                    setSelectedAccountId(e.target.value);
                    setSelectedLocationId("");
                  }}
                  disabled={discoveringAccounts}
                >
                  <option value="">Select account</option>
                  {accounts.map((a) => (
                    <option key={a.accountId} value={a.accountId}>
                      {a.name} ({a.accountId})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-xs text-slate-400">Location</span>
                <select
                  className="mt-1 w-full rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-white"
                  value={selectedLocationId}
                  onChange={(e) => setSelectedLocationId(e.target.value)}
                  disabled={!selectedAccountId || discoveringLocations}
                >
                  <option value="">
                    {discoveringLocations ? "Loading locations..." : "Select location"}
                  </option>
                  {locations.map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.title} ({l.locationId})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: ACCENT }}
                onClick={() => void load()}
                disabled={
                  !selectedAccountId ||
                  !selectedLocationId ||
                  loading ||
                  discoveringAccounts ||
                  discoveringLocations
                }
              >
                Apply selection
              </button>
              <button
                type="button"
                className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-200 hover:bg-[#1a2540]"
                onClick={() => void discoverAccounts({ forceNetwork: true })}
                disabled={discoveringAccounts || discoveringLocations}
              >
                {discoveringAccounts ? "Discovering accounts..." : "Rediscover accounts"}
              </button>
              <button
                type="button"
                className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2 text-sm text-slate-200 hover:bg-[#1a2540]"
                onClick={() => {
                  const cachedAccounts = readTimedCache<
                    Array<{ accountId: string; name: string }>
                  >(GBP_ACCOUNTS_CACHE_KEY);
                  const cachedLocations = selectedAccountId
                    ? readTimedCache<
                        Array<{ locationId: string; title: string; name: string }>
                      >(`${GBP_LOCATIONS_CACHE_PREFIX}${selectedAccountId}`)
                    : null;
                  if (cachedAccounts?.length) setAccounts(cachedAccounts);
                  if (cachedLocations?.length) setLocations(cachedLocations);
                }}
              >
                Use cached data
              </button>
            </div>
          </section>
        ) : null}

        {isDev ? (
          <section
            className="rounded-xl border border-dashed border-slate-600 p-4 text-sm"
            style={{ backgroundColor: "#0c1220" }}
          >
            <h2 className="font-semibold text-slate-200">
              Google Business Profile debug (dev only)
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Terminal logs (with GOOGLE_DEBUG_AUTH=1) show full GBP request URLs. Required
              OAuth scope for these APIs:{" "}
              <code className="text-slate-400">
                https://www.googleapis.com/auth/business.manage
              </code>
            </p>
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-slate-400">
                Service account JSON (server-side check)
              </p>
              <pre className="max-h-40 overflow-auto rounded border border-slate-700 bg-[#0a0f18] p-2 text-xs text-slate-300">
                {saStatus != null
                  ? JSON.stringify(saStatus, null, 2)
                  : "Loading…"}
              </pre>
              <button
                type="button"
                disabled={gbpTestLoading}
                className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600 disabled:opacity-50"
                onClick={() => {
                  void (async () => {
                    setGbpTestLoading(true);
                    try {
                      const r = await fetch("/api/local-seo/google-business/test", {
                        cache: "no-store",
                      });
                      const j: unknown = await r.json();
                      console.log(
                        "[Local SEO] GET /api/local-seo/google-business/test →",
                        j,
                      );
                      setGbpTest(j);
                    } catch (e) {
                      console.error("[Local SEO] GBP test failed:", e);
                      setGbpTest({ error: String(e) });
                    } finally {
                      setGbpTestLoading(false);
                    }
                  })();
                }}
              >
                {gbpTestLoading
                  ? "Running…"
                  : "Run GBP credential test (Account Management + v4 location)"}
              </button>
              {gbpTest != null ? (
                <pre className="max-h-64 overflow-auto rounded border border-slate-700 bg-[#0a0f18] p-2 text-xs text-slate-300">
                  {JSON.stringify(gbpTest, null, 2)}
                </pre>
              ) : null}
            </div>
          </section>
        ) : null}

        {!error && gbpWarnings.length > 0 ? (
          <div
            className="rounded-lg border border-[#185FA5]/40 p-4 text-sm text-slate-200"
            style={{ backgroundColor: CARD }}
            role="status"
          >
            <p className="font-medium" style={{ color: ACCENT }}>
              Partial Google data
            </p>
            <ul className="mt-2 list-inside list-disc text-slate-400">
              {gbpWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {loading && !business ? (
          <div
            className="rounded-xl border p-8 text-center text-slate-400"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <p className="text-sm" aria-live="polite">
              Loading local SEO dashboard…
            </p>
          </div>
        ) : null}

        {!loading && business && activeTab === "gbp" ? (
          <div className="space-y-6">
            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">Business information</h2>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium text-white">{business.name}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Phone</dt>
                  <dd className="text-slate-200">{business.phone}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Address</dt>
                  <dd className="text-slate-200">{business.address}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Website</dt>
                  <dd>
                    {business.website &&
                    business.website !== "—" &&
                    /^https?:\/\//i.test(business.website) ? (
                      <a
                        href={business.website}
                        className="hover:underline"
                        style={{ color: ACCENT }}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {business.website}
                      </a>
                    ) : (
                      <span className="text-slate-200">{business.website || "—"}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Hours</dt>
                  <dd className="text-slate-200">{business.hoursSummary}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Categories</dt>
                  <dd className="flex flex-wrap gap-2 pt-1">
                    {business.categories.map((c) => (
                      <span
                        key={c}
                        className="rounded-full border border-[#2a3f5f] bg-[#0f1729] px-2 py-0.5 text-xs text-slate-300"
                      >
                        {c}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </section>

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">Recent Google reviews</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#2a3f5f] text-slate-400">
                      <th className="pb-3 pr-4 font-medium">Rating</th>
                      <th className="pb-3 pr-4 font-medium">Author</th>
                      <th className="pb-3 pr-4 font-medium">Comment</th>
                      <th className="pb-3 pr-4 font-medium">Date</th>
                      <th className="pb-3 font-medium">Response</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-200">
                    {gbpReviews.map((r) => (
                      <tr key={r.id} className="border-b border-[#2a3f5f]/50">
                        <td className="py-2 pr-4 tabular-nums text-amber-300">
                          {"★".repeat(r.rating)}
                          <span className="text-slate-600">{"★".repeat(5 - r.rating)}</span>
                        </td>
                        <td className="py-2 pr-4">{r.author}</td>
                        <td className="max-w-md py-2 pr-4 text-slate-300">{r.comment}</td>
                        <td className="py-2 pr-4 text-slate-500">{r.date}</td>
                        <td className="py-2">
                          <span
                            className={
                              r.responded ? "text-emerald-400" : "text-rose-400"
                            }
                          >
                            {r.responded ? "Responded" : "Needs reply"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Posts</h2>
                <p className="mb-4 text-xs text-slate-500">
                  Create announcements, events, and offers via the Google Business Profile
                  API (same Google account as in environment variables).
                </p>
                {postError ? (
                  <p className="mb-3 text-xs text-rose-300" role="alert">
                    {postError}
                  </p>
                ) : null}
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={posting}
                    onClick={() => void createLocalPost("STANDARD")}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: ACCENT }}
                  >
                    {posting ? "Working…" : "New announcement"}
                  </button>
                  <button
                    type="button"
                    disabled={posting}
                    onClick={() => void createLocalPost("EVENT")}
                    className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#1a2540] disabled:opacity-50"
                  >
                    New event
                  </button>
                  <button
                    type="button"
                    disabled={posting}
                    onClick={() => void createLocalPost("OFFER")}
                    className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#1a2540] disabled:opacity-50"
                  >
                    New offer
                  </button>
                </div>
                <ul className="space-y-3">
                  {posts.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-lg border border-[#2a3f5f]/80 bg-[#0f1729]/60 p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-white">{p.title}</span>
                        <span className="rounded bg-[#1a2540] px-2 py-0.5 text-xs uppercase text-slate-400">
                          {p.type}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {p.status} · starts {p.startsAt}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>

              <section
                className="rounded-xl border p-6"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <h2 className="mb-4 text-lg font-semibold">Photos</h2>
                <p className="mb-4 text-xs text-slate-500">
                  Live media items from Google Business Profile (read-only here).
                </p>
                <button
                  type="button"
                  disabled
                  className="mb-4 rounded-md px-3 py-2 text-sm font-medium text-slate-400 ring-1 ring-[#2a3f5f]"
                >
                  Upload in Google Business Profile
                </button>
                {photos.length === 0 ? (
                  <p className="text-sm text-slate-500">No photos returned from the API.</p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {photos.map((ph) => (
                      <li
                        key={ph.id}
                        className="flex flex-col gap-1 rounded-lg border border-[#2a3f5f]/60 p-3 text-sm"
                        style={{ backgroundColor: BG }}
                      >
                        <span className="font-medium text-slate-200">{ph.label}</span>
                        <span className="text-xs capitalize text-slate-500">{ph.kind}</span>
                        <span className="text-xs text-slate-600">Added {ph.addedAt}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        ) : null}

        {!loading && business && activeTab === "reviews" ? (
          <div className="space-y-6">
            <p className="text-sm text-slate-400">
              Multi-platform review aggregation. Google reviews are live from Business Profile;
              Yelp, Avvo, and Facebook rows are sample data until those APIs are connected.
              Use templates below to draft responses, then reply in each platform.
            </p>
            <section
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
            >
              <article
                className="rounded-xl border p-5"
                style={{ backgroundColor: CARD, borderColor: BORDER }}
              >
                <p className="text-sm text-slate-400">Blended rating</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-white">
                  {overallRating.toFixed(2)}
                  <span className="text-lg text-slate-500"> /5</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">Across connected platforms</p>
              </article>
              {(["google", "yelp", "avvo", "facebook"] as const).map((p) => {
                const subset = platformReviews.filter((r) => r.platform === p);
                const avg =
                  subset.length === 0
                    ? 0
                    : subset.reduce((s, r) => s + normalizeRating(r) * 5, 0) /
                      subset.length;
                return (
                  <article
                    key={p}
                    className="rounded-xl border p-5"
                    style={{ backgroundColor: CARD, borderColor: BORDER }}
                  >
                    <p className="text-sm text-slate-400">{platformLabel(p)}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                      {subset.length ? avg.toFixed(1) : "—"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {subset.length} review{subset.length === 1 ? "" : "s"}
                    </p>
                  </article>
                );
              })}
            </section>

            {flaggedNegative.length > 0 ? (
              <div
                className="rounded-lg border border-rose-900/40 bg-rose-950/20 p-4 text-sm text-rose-100"
                role="status"
              >
                <p className="font-medium text-rose-200">
                  {flaggedNegative.length} review(s) need attention (low rating or no
                  response planned)
                </p>
              </div>
            ) : null}

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">All reviews</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#2a3f5f] text-slate-400">
                      <th className="pb-3 pr-4 font-medium">Platform</th>
                      <th className="pb-3 pr-4 font-medium">Rating</th>
                      <th className="pb-3 pr-4 font-medium">Author</th>
                      <th className="pb-3 pr-4 font-medium">Comment</th>
                      <th className="pb-3 pr-4 font-medium">Date</th>
                      <th className="pb-3 font-medium">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platformReviews.map((r) => {
                      const norm = normalizeRating(r) * 5;
                      const bad = norm < 3.5 || r.needsResponse;
                      return (
                        <tr key={r.id} className="border-b border-[#2a3f5f]/50">
                          <td className="py-2 pr-4 text-slate-300">
                            {platformLabel(r.platform)}
                          </td>
                          <td className="py-2 pr-4 tabular-nums text-slate-200">
                            {r.rating}/{r.maxRating}
                          </td>
                          <td className="py-2 pr-4">{r.author}</td>
                          <td className="max-w-xs py-2 pr-4 text-slate-400">
                            {r.comment}
                          </td>
                          <td className="py-2 pr-4 text-slate-500">{r.date}</td>
                          <td className="py-2">
                            {bad ? (
                              <span className="text-rose-400">Needs response</span>
                            ) : (
                              <span className="text-emerald-500/80">OK</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">Response templates</h2>
              <ul className="space-y-4">
                {templates.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-[#2a3f5f] bg-[#0f1729]/50 p-4"
                  >
                    <p className="font-medium" style={{ color: ACCENT }}>
                      {t.label}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">{t.body}</p>
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard.writeText(t.body).catch(() => undefined)
                      }
                      className="mt-3 text-xs hover:underline"
                      style={{ color: ACCENT }}
                    >
                      Copy to clipboard
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}

        {!loading && business && activeTab === "rankings" ? (
          <div className="space-y-6">
            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-2 text-lg font-semibold">Keyword positions</h2>
              <p className="mb-4 text-xs text-slate-500">
                NYC metro legal terms — mock rankings; trend vs prior snapshot.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#2a3f5f] text-slate-400">
                      <th className="pb-3 pr-4 font-medium">Keyword</th>
                      <th className="pb-3 pr-4 font-medium">Your rank</th>
                      <th className="pb-3 pr-4 font-medium">Change</th>
                      <th className="pb-3 pr-4 font-medium">Landing page</th>
                      <th className="pb-3 font-medium">Last checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keywordRankings.map((k) => (
                      <tr key={k.keyword} className="border-b border-[#2a3f5f]/50">
                        <td className="py-2 pr-4 font-medium text-white">{k.keyword}</td>
                        <td className="py-2 pr-4 tabular-nums text-slate-200">
                          {k.rank === null ? (
                            <span className="text-slate-500">Not in top 50</span>
                          ) : (
                            k.rank
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {k.change === 0 ? (
                            <span className="text-slate-500">—</span>
                          ) : k.change > 0 ? (
                            <span className="text-emerald-400">↑ {k.change}</span>
                          ) : (
                            <span className="text-rose-400">↓ {Math.abs(k.change)}</span>
                          )}
                        </td>
                        <td
                          className="max-w-xs truncate py-2 pr-4 text-xs"
                          style={{ color: ACCENT }}
                        >
                          {k.url}
                        </td>
                        <td className="py-2 text-xs text-slate-500">
                          {new Date(k.lastChecked).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section
              className="rounded-xl border p-6"
              style={{ backgroundColor: CARD, borderColor: BORDER }}
            >
              <h2 className="mb-4 text-lg font-semibold">Competitor snapshot</h2>
              <p className="mb-4 text-xs text-slate-500">
                Average rank across the same keyword set (mock).
              </p>
              <ul className="divide-y divide-[#2a3f5f]/60">
                {competitors.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0"
                  >
                    <span className="font-medium text-white">{c.name}</span>
                    <span className="tabular-nums text-slate-300">
                      Avg rank: {c.avgRank.toFixed(1)}
                      {c.trend === "up" ? (
                        <span className="ml-2 text-emerald-400">↑</span>
                      ) : c.trend === "down" ? (
                        <span className="ml-2 text-rose-400">↓</span>
                      ) : (
                        <span className="ml-2 text-slate-500">→</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}

        {!loading && business && activeTab === "citations" ? (
          <section
            className="rounded-xl border p-6"
            style={{ backgroundColor: CARD, borderColor: BORDER }}
          >
            <h2 className="mb-2 text-lg font-semibold">Citation & NAP monitor</h2>
            <p className="mb-4 text-xs text-slate-500">
              Legal directories and listings — verify name, address, and phone match Google
              Business Profile.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#2a3f5f] text-slate-400">
                    <th className="pb-3 pr-4 font-medium">Directory</th>
                    <th className="pb-3 pr-4 font-medium">NAP</th>
                    <th className="pb-3 pr-4 font-medium">Issues</th>
                    <th className="pb-3 font-medium">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {citations.map((c) => {
                    const tone = napTone(c.napMatch);
                    return (
                      <tr key={c.id} className="border-b border-[#2a3f5f]/50">
                        <td className="py-3 pr-4 font-medium text-white">{c.directory}</td>
                        <td className={`py-3 pr-4 font-medium ${tone.className}`}>
                          {tone.label}
                        </td>
                        <td className="py-3 pr-4 text-slate-400">
                          {c.issues.length ? (
                            <ul className="list-inside list-disc text-xs">
                              {c.issues.map((issue) => (
                                <li key={issue}>{issue}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-slate-600">None</span>
                          )}
                        </td>
                        <td className="py-3">
                          <a
                            href={c.url}
                            className="text-xs hover:underline"
                            style={{ color: ACCENT }}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View listing
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
