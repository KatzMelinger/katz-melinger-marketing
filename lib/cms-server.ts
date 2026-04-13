/**
 * Server-side CMS API client (katz-melinger-cms).
 */
export function getCmsSecret(): string {
  return (
    process.env.CMS_API_SECRET_KEY?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

export function getCmsBaseUrl(): string | null {
  const base = process.env.CMS_API_URL?.replace(/\/$/, "").trim();
  return base || null;
}

export async function fetchCmsJson<T>(path: string): Promise<T | null> {
  const base = getCmsBaseUrl();
  const secret = getCmsSecret();
  if (!base) return null;
  const safePath = path.startsWith("/") ? path : `/${path}`;
  try {
    const res = await fetch(`${base}${safePath}`, {
      cache: "no-store",
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
