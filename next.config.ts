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
};

export default nextConfig;
