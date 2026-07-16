import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Cap the number of build workers used for page-data collection and
    // static generation. The default spawns one worker per CPU, which on
    // Windows can collectively exhaust memory and crash with
    // STATUS_STACK_BUFFER_OVERRUN (exit code 3221226505) during
    // "Generating static pages". Two workers keeps parallelism without
    // blowing past the heap we allocate via NODE_OPTIONS in package.json.
    cpus: 2,
  },
  // @napi-rs/canvas is a native addon (carousel slide compositing). Keep it out
  // of the server bundle so Next uses a native require instead of bundling it.
  // (`sharp` is already auto-externalized by Next.)
  serverExternalPackages: ["@napi-rs/canvas"],
  // The carousel renderer reads bundled TTFs at runtime via fs; @vercel/nft
  // can't see that statically, so include them in the route's server trace.
  outputFileTracingIncludes: {
    "/api/content-production/repurpose/carousel-images": ["assets/fonts/**/*"],
  },
  // The Production Board (/content-production) is now the single pipeline UI.
  // The old Content Studio pipeline view (/content/pipeline) was a duplicate of
  // the same records/lifecycle in a different layout; it's retired. Redirect any
  // lingering bookmarks to the board so they don't 404. (The /api/content/pipeline
  // API routes stay — many surfaces still read/write through them.)
  async redirects() {
    return [
      {
        source: "/content/pipeline",
        destination: "/content-production",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
