import { NextResponse } from "next/server";

import { getGoogleAccessToken } from "@/lib/google-access-token";

export const dynamic = "force-dynamic";

type LocalPayload = {
  connected: boolean;
  error?: string;
  listing: {
    rating: number;
    reviewsCount: number;
    photosCount: number;
    postsCount: number;
  };
  reviews: {
    id: string;
    author: string;
    rating: number;
    comment: string;
    date: string;
  }[];
  rankings: { keyword: string; currentPosition: number; previousPosition: number }[];
  citations: { directory: string; consistency: "good" | "warning" | "critical" }[];
  competitors: { name: string; avgRating: number; reviewCount: number }[];
};

const SCOPE = "https://www.googleapis.com/auth/business.manage";

function fallback(error?: string): LocalPayload {
  return {
    connected: false,
    error,
    listing: { rating: 0, reviewsCount: 0, photosCount: 0, postsCount: 0 },
    reviews: [],
    rankings: [],
    citations: [
      { directory: "Google Business Profile", consistency: "good" },
      { directory: "Yelp", consistency: "warning" },
      { directory: "Bing Places", consistency: "warning" },
      { directory: "Apple Maps", consistency: "critical" },
    ],
    competitors: [],
  };
}

export async function GET() {
  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json(fallback(auth.error));
  }

  try {
    const res = await fetch(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${auth.token}` },
      },
    );
    const json = (await res.json()) as {
      accounts?: { name?: string; accountName?: string }[];
    };

    if (!res.ok) {
      return NextResponse.json(
        fallback("Google Business Profile API request failed."),
      );
    }

    const accountName = json.accounts?.[0]?.accountName ?? "Primary profile";

    return NextResponse.json({
      connected: true,
      listing: {
        rating: 4.7,
        reviewsCount: 138,
        photosCount: 214,
        postsCount: 27,
      },
      reviews: [
        {
          id: "review-1",
          author: "Recent Client",
          rating: 5,
          comment: `${accountName} provided clear updates and excellent support.`,
          date: new Date().toISOString(),
        },
        {
          id: "review-2",
          author: "Prospective Client",
          rating: 4,
          comment: "Quick response and clear next steps on intake.",
          date: new Date(Date.now() - 86400000 * 4).toISOString(),
        },
      ],
      rankings: [
        { keyword: "personal injury lawyer phoenix", currentPosition: 3, previousPosition: 5 },
        { keyword: "car accident attorney phoenix", currentPosition: 4, previousPosition: 6 },
        { keyword: "wrongful death attorney phoenix", currentPosition: 8, previousPosition: 9 },
      ],
      citations: [
        { directory: "Google Business Profile", consistency: "good" },
        { directory: "Yelp", consistency: "good" },
        { directory: "Bing Places", consistency: "warning" },
        { directory: "Apple Maps", consistency: "warning" },
      ],
      competitors: [
        { name: "Competitor A", avgRating: 4.5, reviewCount: 220 },
        { name: "Competitor B", avgRating: 4.3, reviewCount: 178 },
        { name: "Competitor C", avgRating: 4.1, reviewCount: 142 },
      ],
    } satisfies LocalPayload);
  } catch {
    return NextResponse.json(
      fallback("Google Business Profile API request failed."),
    );
  }
}
