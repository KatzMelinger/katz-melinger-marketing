import type { MetadataRoute } from "next";

// Every page in the app requires login — there's nothing here for a crawler
// to usefully index, and search engines have no business trying.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
