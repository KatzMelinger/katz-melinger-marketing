import { logger } from "./logger";

const METRICOOL_API_BASE = "https://app.metricool.com/api";

function getConfig() {
  const token = process.env.METRICOOL_API_TOKEN;
  const userId = process.env.METRICOOL_USER_ID;
  const blogId = process.env.METRICOOL_BLOG_ID;
  if (!token || !userId || !blogId) {
    throw new Error("METRICOOL_API_TOKEN, METRICOOL_USER_ID, and METRICOOL_BLOG_ID must be set");
  }
  return { token, userId, blogId };
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().split(".")[0],
    to: to.toISOString().split(".")[0],
  };
}

async function metricoolFetch(path: string, params?: Record<string, string>) {
  const { token, userId, blogId } = getConfig();
  const url = new URL(`${METRICOOL_API_BASE}${path}`);
  url.searchParams.set("userId", userId);
  url.searchParams.set("blogId", blogId);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      "X-Mc-Auth": token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error({ status: response.status, body: text, path }, "Metricool API error");
    throw new Error(`Metricool API returned ${response.status}: ${text}`);
  }

  return response.json();
}

export async function getBrandProfiles() {
  return metricoolFetch("/admin/simpleProfiles");
}

export async function getTimeline(network: string, metric: string, subject: string, options?: { from?: string; to?: string }) {
  const { from, to } = options?.from && options?.to ? { from: options.from, to: options.to } : defaultDateRange();
  return metricoolFetch("/v2/analytics/timelines", { from, to, network, metric, subject });
}

export async function getPosts(network: string, options?: { from?: string; to?: string }) {
  const { from, to } = options?.from && options?.to ? { from: options.from, to: options.to } : defaultDateRange();
  return metricoolFetch(`/v2/analytics/posts/${network}`, { from, to });
}

export async function getReels(network: string, options?: { from?: string; to?: string }) {
  const { from, to } = options?.from && options?.to ? { from: options.from, to: options.to } : defaultDateRange();
  return metricoolFetch(`/v2/analytics/reels/${network}`, { from, to });
}

export async function getStories(network: string, options?: { from?: string; to?: string }) {
  const { from, to } = options?.from && options?.to ? { from: options.from, to: options.to } : defaultDateRange();
  return metricoolFetch(`/v2/analytics/stories/${network}`, { from, to });
}

type NetworkConfig = {
  name: string;
  key: string;
  metrics: string[];
  hasFollowers: boolean;
};

const FOLLOWER_METRIC: Record<string, string> = {
  instagram: "followers",
  facebook: "likes",
  linkedin: "followers",
  tiktok: "followers_count",
};

const NETWORKS: NetworkConfig[] = [
  { name: "Instagram", key: "instagram", metrics: ["followers", "reach", "impressions"], hasFollowers: true },
  { name: "Facebook", key: "facebook", metrics: ["likes", "pageImpressions"], hasFollowers: true },
  { name: "LinkedIn", key: "linkedin", metrics: ["followers", "impressions"], hasFollowers: true },
  { name: "TikTok", key: "tiktok", metrics: ["followers_count", "video_views"], hasFollowers: true },
];

export async function getSocialOverview(options?: { from?: string; to?: string }) {
  const { from, to } = options?.from && options?.to ? { from: options.from, to: options.to } : defaultDateRange();

  const results: any[] = [];

  for (const network of NETWORKS) {
    const networkData: any = {
      network: network.name,
      key: network.key,
      followers: null,
      followersTrend: [],
      posts: [],
      totalPosts: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalImpressions: 0,
      totalReach: 0,
      totalEngagement: 0,
    };

    try {
      if (network.hasFollowers) {
        const metric = FOLLOWER_METRIC[network.key] || "followers";
        const followerData = await getTimeline(network.key, metric, "account", { from, to });
        const values = followerData?.data?.[0]?.values || [];
        if (values.length > 0) {
          networkData.followers = values[0].value;
          networkData.followersTrend = values.map((v: any) => ({
            date: v.dateTime.split("T")[0],
            value: v.value,
          })).reverse();
        }
      }
    } catch (e: any) {
      logger.warn({ network: network.key, error: e.message }, "Failed to fetch follower data");
    }

    try {
      const postsData = await getPosts(network.key, { from, to });
      const posts = postsData?.data || [];
      networkData.totalPosts = posts.length;

      for (const post of posts) {
        networkData.totalLikes += post.likes || 0;
        networkData.totalComments += post.comments || post.comment || 0;
        networkData.totalShares += post.shares || 0;
        networkData.totalImpressions += post.impressionsTotal || post.impressions || 0;
        networkData.totalReach += post.reach || 0;
        networkData.totalEngagement += post.engagement || 0;
      }

      networkData.posts = posts.slice(0, 10).map((post: any) => ({
        id: post.postId || post.id,
        content: (post.content || post.text || "").slice(0, 200),
        publishedAt: post.publishedAt || post.created,
        likes: post.likes || 0,
        comments: post.comments || post.comment || 0,
        shares: post.shares || 0,
        impressions: post.impressionsTotal || post.impressions || 0,
        reach: post.reach || 0,
        engagement: post.engagement || 0,
        url: post.url || null,
        imageUrl: post.imageUrl || post.picture || null,
        type: post.type || "post",
      }));
    } catch (e: any) {
      logger.warn({ network: network.key, error: e.message }, "Failed to fetch posts data");
    }

    results.push(networkData);
  }

  return results;
}
