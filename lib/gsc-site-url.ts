/** Normalize to a Search Console property URL (URL-prefix properties usually end with /). */
function normalizeSiteUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "https://katzmelinger.com/";
  if (t.startsWith("sc-domain:")) return t;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.pathname === "/" || u.pathname === "") {
      return `${u.origin}/`;
    }
    return u.pathname.endsWith("/") ? u.href : `${u.href.replace(/\/?$/, "/")}`;
  } catch {
    return t.endsWith("/") ? t : `${t}/`;
  }
}

/** Search Console property URL (must match a verified property in GSC). */
export function getGscSiteUrl(): string {
  const fromEnv =
    process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim() ||
    process.env.GSC_SITE_URL?.trim() ||
    "";
  return normalizeSiteUrl(fromEnv || "https://katzmelinger.com/");
}

export function gscSiteUrlEncoded(): string {
  return encodeURIComponent(getGscSiteUrl());
}
