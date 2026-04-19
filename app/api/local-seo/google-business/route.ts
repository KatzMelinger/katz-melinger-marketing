import { NextResponse } from "next/server";

import { getGoogleAccessToken } from "@/lib/google-access-token";

export const dynamic = "force-dynamic";

const SCOPE = "https://www.googleapis.com/auth/business.manage";
const BASE = "https://mybusiness.googleapis.com/v4";

type GoogleJsonError = {
  error?: { code?: number; message?: string; status?: string };
};

function stripAccountPrefix(id: string): string {
  const t = id.trim();
  return t.startsWith("accounts/") ? t.slice("accounts/".length) : t;
}

function stripLocationPrefix(id: string): string {
  const t = id.trim();
  if (t.includes("/locations/")) {
    const after = t.split("/locations/")[1] ?? t;
    return after.split("/")[0] ?? after;
  }
  return t.startsWith("locations/") ? t.slice("locations/".length) : t;
}

async function readGoogleErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as GoogleJsonError;
    const msg = j?.error?.message;
    if (msg) return msg;
    const status = j?.error?.status;
    if (status) return status;
  } catch {
    /* ignore */
  }
  return res.statusText || "Google API request failed";
}

function friendlyHttpError(status: number, message: string): string {
  if (status === 404) {
    return "Location not found. Check GOOGLE_BUSINESS_ACCOUNT_ID and GOOGLE_BUSINESS_LOCATION_ID.";
  }
  if (status === 403) {
    return `Access denied (${message}). Ensure the service account is granted access to this Business Profile location and has the business.manage scope.`;
  }
  if (status === 429) {
    return "Google rate limit reached. Wait a few minutes and try again.";
  }
  if (status === 401) {
    return "Google authentication failed. Verify GOOGLE_SERVICE_ACCOUNT_JSON.";
  }
  return message || `Google API error (${status})`;
}

function mapStarRating(starRating: unknown): number {
  if (typeof starRating === "number") {
    return Math.min(5, Math.max(0, starRating));
  }
  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
    STAR_RATING_UNSPECIFIED: 0,
  };
  if (typeof starRating === "string" && starRating in map) {
    return map[starRating] ?? 0;
  }
  return 0;
}

function formatAddress(addr: {
  addressLines?: string[];
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
} | null | undefined): string {
  if (!addr) return "";
  const lines = [...(addr.addressLines ?? [])];
  const tail = [addr.locality, addr.administrativeArea, addr.postalCode]
    .filter(Boolean)
    .join(", ");
  if (tail) lines.push(tail);
  return lines.join(", ");
}

function formatHoursSummary(location: {
  regularHours?: {
    periods?: Array<{
      openDay?: string;
      closeDay?: string;
      openTime?: { hours?: number; minutes?: number };
      closeTime?: { hours?: number; minutes?: number };
    }>;
  };
}): string {
  const periods = location.regularHours?.periods;
  if (!periods?.length) return "—";
  const fmt = (t: { hours?: number; minutes?: number } | undefined) => {
    if (!t) return "";
    const h = t.hours ?? 0;
    const m = t.minutes ?? 0;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: m ? "2-digit" : undefined,
    });
  };
  return periods
    .slice(0, 14)
    .map((p) => {
      const open = fmt(p.openTime);
      const close = fmt(p.closeTime);
      const day = (p.openDay ?? "?").replace("DAY_OF_WEEK_", "");
      return open && close ? `${day}: ${open}–${close}` : day;
    })
    .join(" · ");
}

function mediaKind(
  format: string | undefined,
  category: string | undefined,
): "logo" | "cover" | "interior" | "team" {
  const c = (category ?? "").toUpperCase();
  if (c.includes("LOGO") || c.includes("PROFILE")) return "logo";
  if (c.includes("COVER")) return "cover";
  if (c.includes("TEAM") || c.includes("STAFF")) return "team";
  if (format === "VIDEO") return "interior";
  return "interior";
}

async function authorizedFetch(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers,
  });
}

export async function GET(req: Request) {
  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") ?? "dashboard";
  const accountId = stripAccountPrefix(
    searchParams.get("accountId")?.trim() ??
      process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim() ??
      "",
  );
  const locationId = stripLocationPrefix(
    searchParams.get("locationId")?.trim() ??
      process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim() ??
      "",
  );

  if (!accountId) {
    return NextResponse.json(
      { error: "Missing GOOGLE_BUSINESS_ACCOUNT_ID (or accountId query)." },
      { status: 400 },
    );
  }

  const acc = encodeURIComponent(accountId);

  try {
    if (action === "locations") {
      const url = `${BASE}/accounts/${acc}/locations?pageSize=100`;
      const res = await authorizedFetch(url, auth.token);
      if (!res.ok) {
        const msg = await readGoogleErrorMessage(res);
        return NextResponse.json(
          { error: friendlyHttpError(res.status, msg) },
          { status: res.status >= 500 ? 502 : res.status },
        );
      }
      const data = (await res.json()) as { locations?: unknown[]; nextPageToken?: string };
      return NextResponse.json(data);
    }

    if (!locationId) {
      return NextResponse.json(
        { error: "Missing GOOGLE_BUSINESS_LOCATION_ID (or locationId query)." },
        { status: 400 },
      );
    }

    const loc = encodeURIComponent(locationId);
    const locationName = `${BASE}/accounts/${acc}/locations/${loc}`;

    if (action === "reviews") {
      const url = `${locationName}/reviews`;
      const res = await authorizedFetch(url, auth.token);
      if (!res.ok) {
        const msg = await readGoogleErrorMessage(res);
        return NextResponse.json(
          { error: friendlyHttpError(res.status, msg) },
          { status: res.status >= 500 ? 502 : res.status },
        );
      }
      return NextResponse.json(await res.json());
    }

    if (action === "media") {
      const url = `${locationName}/media`;
      const res = await authorizedFetch(url, auth.token);
      if (!res.ok) {
        const msg = await readGoogleErrorMessage(res);
        return NextResponse.json(
          { error: friendlyHttpError(res.status, msg) },
          { status: res.status >= 500 ? 502 : res.status },
        );
      }
      return NextResponse.json(await res.json());
    }

    if (action === "localPosts") {
      const url = `${locationName}/localPosts`;
      const res = await authorizedFetch(url, auth.token);
      if (!res.ok) {
        const msg = await readGoogleErrorMessage(res);
        return NextResponse.json(
          { error: friendlyHttpError(res.status, msg) },
          { status: res.status >= 500 ? 502 : res.status },
        );
      }
      return NextResponse.json(await res.json());
    }

    if (action === "dashboard") {
      const [locRes, revRes, mediaRes, postsRes] = await Promise.all([
        authorizedFetch(locationName, auth.token),
        authorizedFetch(`${locationName}/reviews?pageSize=50`, auth.token),
        authorizedFetch(`${locationName}/media?pageSize=50`, auth.token),
        authorizedFetch(`${locationName}/localPosts?pageSize=50`, auth.token),
      ]);

      if (!locRes.ok) {
        const msg = await readGoogleErrorMessage(locRes);
        return NextResponse.json(
          { error: friendlyHttpError(locRes.status, msg) },
          { status: locRes.status >= 500 ? 502 : locRes.status },
        );
      }

      const location = (await locRes.json()) as Record<string, unknown>;
      const primary = (location.categories as { primaryCategory?: { displayName?: string } })
        ?.primaryCategory?.displayName;
      const additional =
        (location.categories as { additionalCategories?: { displayName?: string }[] })
          ?.additionalCategories?.map((c) => c.displayName).filter(Boolean) ?? [];
      const categories = [primary, ...additional].filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      );

      const storefront = location.storefrontAddress as Parameters<
        typeof formatAddress
      >[0];
      const business = {
        name: String(
          (location.title as string | undefined) ||
            formatAddress(storefront) ||
            "Business",
        ),
        address: formatAddress(storefront),
        phone: String(
          (location.phoneNumbers as { primaryPhone?: string })?.primaryPhone ?? "—",
        ),
        website: String(location.websiteUri ?? "—"),
        hoursSummary: formatHoursSummary(
          location as Parameters<typeof formatHoursSummary>[0],
        ),
        categories: categories.length ? categories : ["—"],
      };

      let gbpReviews: Array<{
        id: string;
        author: string;
        rating: number;
        comment: string;
        date: string;
        responded: boolean;
      }> = [];
      if (revRes.ok) {
        const revJson = (await revRes.json()) as {
          reviews?: Array<{
            reviewId?: string;
            reviewer?: { displayName?: string };
            starRating?: unknown;
            comment?: string;
            createTime?: string;
            updateTime?: string;
            reviewReply?: { comment?: string };
          }>;
        };
        gbpReviews =
          revJson.reviews?.map((r) => ({
            id: String(r.reviewId ?? r.createTime ?? Math.random().toString(36)),
            author: String(r.reviewer?.displayName ?? "Google user"),
            rating: mapStarRating(r.starRating),
            comment: String(r.comment ?? ""),
            date: r.createTime
              ? String(r.createTime).slice(0, 10)
              : r.updateTime
                ? String(r.updateTime).slice(0, 10)
                : "",
            responded: Boolean(r.reviewReply?.comment),
          })) ?? [];
      }

      let photos: Array<{
        id: string;
        label: string;
        kind: "logo" | "cover" | "interior" | "team";
        addedAt: string;
      }> = [];
      if (mediaRes.ok) {
        const mediaJson = (await mediaRes.json()) as {
          mediaItems?: Array<{
            googleUrl?: string;
            mediaFormat?: string;
            locationAssociation?: { category?: string };
            createTime?: string;
            name?: string;
          }>;
        };
        photos =
          mediaJson.mediaItems?.map((m, i) => ({
            id: String(m.name ?? m.googleUrl ?? `media-${i}`),
            label: m.locationAssociation?.category
              ? String(m.locationAssociation.category).replace(/_/g, " ")
              : m.mediaFormat === "VIDEO"
                ? "Video"
                : "Photo",
            kind: mediaKind(m.mediaFormat, m.locationAssociation?.category),
            addedAt: m.createTime ? String(m.createTime).slice(0, 10) : "—",
          })) ?? [];
      }

      let posts: Array<{
        id: string;
        type: "announcement" | "event" | "offer";
        title: string;
        status: "scheduled" | "live" | "ended";
        startsAt: string;
      }> = [];
      if (postsRes.ok) {
        const postsJson = (await postsRes.json()) as {
          localPosts?: Array<{
            name?: string;
            summary?: string;
            topicType?: string;
            state?: string;
            createTime?: string;
            event?: { title?: string };
            searchUrl?: string;
          }>;
        };
        const mapTopic = (t: string | undefined): "announcement" | "event" | "offer" => {
          if (t === "EVENT") return "event";
          if (t === "OFFER") return "offer";
          return "announcement";
        };
        const mapState = (s: string | undefined): "scheduled" | "live" | "ended" => {
          if (s === "REJECTED" || s === "PROCESSING") return "scheduled";
          if (s === "LIVE") return "live";
          if (s === "EXPIRED" || s === "DELETED") return "ended";
          return "live";
        };
        posts =
          postsJson.localPosts?.map((p) => ({
            id: String(p.name ?? p.searchUrl ?? p.summary ?? Math.random().toString(36)),
            type: mapTopic(p.topicType),
            title: String(
              p.event?.title ?? p.summary?.slice(0, 120) ?? "Local post",
            ),
            status: mapState(p.state),
            startsAt: p.createTime
              ? String(p.createTime).slice(0, 10)
              : new Date().toISOString().slice(0, 10),
          })) ?? [];
      }

      const warnings: string[] = [];
      if (!revRes.ok) {
        warnings.push(`Reviews: ${friendlyHttpError(revRes.status, await readGoogleErrorMessage(revRes))}`);
      }
      if (!mediaRes.ok) {
        warnings.push(`Photos: ${friendlyHttpError(mediaRes.status, await readGoogleErrorMessage(mediaRes))}`);
      }
      if (!postsRes.ok) {
        warnings.push(`Posts: ${friendlyHttpError(postsRes.status, await readGoogleErrorMessage(postsRes))}`);
      }

      return NextResponse.json({
        business,
        gbpReviews,
        posts,
        photos,
        warnings,
      });
    }

    return NextResponse.json(
      { error: `Unknown action "${action}". Use locations, reviews, media, localPosts, or dashboard.` },
      { status: 400 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Google Business Profile request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

type PostBody = {
  topicType?: "STANDARD" | "EVENT" | "OFFER";
  summary?: string;
  title?: string;
  websiteUrl?: string;
};

export async function POST(req: Request) {
  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 500 });
  }

  const accountId = stripAccountPrefix(process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim() ?? "");
  const locationId = stripLocationPrefix(process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim() ?? "");
  if (!accountId || !locationId) {
    return NextResponse.json(
      { error: "GOOGLE_BUSINESS_ACCOUNT_ID and GOOGLE_BUSINESS_LOCATION_ID must be set." },
      { status: 400 },
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const topic = body.topicType ?? "STANDARD";
  const summary = body.summary?.trim();
  if (!summary) {
    return NextResponse.json({ error: "summary is required" }, { status: 400 });
  }

  const acc = encodeURIComponent(accountId);
  const loc = encodeURIComponent(locationId);
  const parent = `${BASE}/accounts/${acc}/locations/${loc}/localPosts`;

  const languageCode = "en";

  const basePayload: Record<string, unknown> = {
    languageCode,
    summary,
    topicType: topic,
  };

  if (topic === "EVENT") {
    const title = body.title?.trim() ?? summary.slice(0, 80);
    const start = new Date();
    start.setDate(start.getDate() + 1);
    basePayload.event = {
      title,
      schedule: {
        startDate: {
          year: start.getFullYear(),
          month: start.getMonth() + 1,
          day: start.getDate(),
        },
        startTime: { hours: 10, minutes: 0, seconds: 0, nanos: 0 },
        endDate: {
          year: start.getFullYear(),
          month: start.getMonth() + 1,
          day: start.getDate(),
        },
        endTime: { hours: 11, minutes: 0, seconds: 0, nanos: 0 },
      },
    };
  }

  if (topic === "OFFER") {
    const url = body.websiteUrl?.trim() || "https://www.google.com";
    basePayload.offer = {
      couponCode: "SEE_STORE",
      redeemOnlineUrl: url,
      termsConditions: "See business for details.",
    };
  }

  const res = await authorizedFetch(parent, auth.token, {
    method: "POST",
    body: JSON.stringify(basePayload),
  });

  if (!res.ok) {
    const msg = await readGoogleErrorMessage(res);
    return NextResponse.json(
      { error: friendlyHttpError(res.status, msg) },
      { status: res.status >= 500 ? 502 : res.status },
    );
  }

  const created = (await res.json()) as Record<string, unknown>;
  return NextResponse.json({ ok: true, localPost: created });
}
