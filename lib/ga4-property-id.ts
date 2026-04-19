/** GA4 property numeric ID or full resource name segment (e.g. 123456789). */
export function ga4PropertyResourceName(): string | null {
  const raw =
    process.env.GOOGLE_ANALYTICS_PROPERTY_ID?.trim() ??
    process.env.GA4_PROPERTY_ID?.trim() ??
    "";
  if (!raw) return null;
  const id = raw.replace(/^properties\//i, "");
  if (!/^\d+$/.test(id)) return null;
  return `properties/${id}`;
}
