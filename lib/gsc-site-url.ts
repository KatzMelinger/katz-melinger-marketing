/** Search Console property URL (must match verified property). */
export function getGscSiteUrl(): string {
  return (
    process.env.GSC_SITE_URL?.trim() || "https://katzmelinger.com/"
  );
}

export function gscSiteUrlEncoded(): string {
  return encodeURIComponent(getGscSiteUrl());
}
