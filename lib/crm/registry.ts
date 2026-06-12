/**
 * CRM provider registry — single source of truth for which intake/CRM systems
 * the app can talk to, and which one is active for the current tenant.
 *
 * Selection order:
 *   1. CRM_PROVIDER env var (explicit pin, e.g. "clio"), if that provider is available.
 *   2. The first registered provider that reports isAvailable().
 *   3. null — nothing configured (callers degrade gracefully, as today).
 *
 * Per-tenant selection (tenant_settings.crm_provider) can layer on top later;
 * the resolver already takes an optional preferred id so that change is local.
 */

import { katzCmsProvider } from "@/lib/crm/providers/katz-cms";
import { clioProvider, lawmaticsProvider, litifyProvider } from "@/lib/crm/providers/stubs";
import type { CrmProvider, CrmProviderId } from "@/lib/crm/types";

/** Registration order = default priority. Katz CMS first to preserve today's behavior. */
export const CRM_PROVIDERS: CrmProvider[] = [
  katzCmsProvider,
  clioProvider,
  lawmaticsProvider,
  litifyProvider,
];

export function getCrmProvider(id: CrmProviderId): CrmProvider | null {
  return CRM_PROVIDERS.find((p) => p.id === id) ?? null;
}

export function listCrmProviders(): Array<{
  id: CrmProviderId;
  label: string;
  available: boolean;
  capabilities: CrmProvider["capabilities"];
}> {
  return CRM_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    available: p.isAvailable(),
    capabilities: p.capabilities,
  }));
}

/**
 * Resolve the active provider. `preferredId` (e.g. from tenant_settings) wins
 * when it's available; otherwise fall back to the CRM_PROVIDER env pin, then the
 * first available provider.
 */
export function resolveCrmProvider(preferredId?: CrmProviderId | null): CrmProvider | null {
  if (preferredId) {
    const preferred = getCrmProvider(preferredId);
    if (preferred?.isAvailable()) return preferred;
  }
  const envPin = process.env.CRM_PROVIDER?.trim() as CrmProviderId | undefined;
  if (envPin) {
    const pinned = getCrmProvider(envPin);
    if (pinned?.isAvailable()) return pinned;
  }
  return CRM_PROVIDERS.find((p) => p.isAvailable()) ?? null;
}
