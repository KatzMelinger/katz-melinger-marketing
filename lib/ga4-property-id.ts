export function ga4PropertyResourceName(): string | null {
  const raw = process.env.GA4_PROPERTY_ID?.trim();
  if (!raw) return null;
  const id = raw.replace(/^properties\//i, "");
  if (!/^\d+$/.test(id)) return null;
  return `properties/${id}`;
}
