/**
 * Email provider registry — which email-distribution platforms the app can talk
 * to, and which is active for the current tenant.
 *
 * Selection order (mirrors lib/crm/registry.ts):
 *   1. preferredId (tenant_settings.email_provider), if available.
 *   2. EMAIL_PROVIDER env pin, if available.
 *   3. The first registered provider that reports isAvailable().
 *   4. null — nothing configured (callers show "connect a provider").
 */

import { constantContactProvider } from "@/lib/email/providers/constant-contact";
import { mailchimpProvider, sendgridProvider } from "@/lib/email/providers/stubs";
import type { EmailProvider, EmailProviderId } from "@/lib/email/types";

/** Registration order = default priority. Constant Contact first (today's behavior). */
export const EMAIL_PROVIDERS: EmailProvider[] = [
  constantContactProvider,
  mailchimpProvider,
  sendgridProvider,
];

export function getEmailProvider(id: EmailProviderId): EmailProvider | null {
  return EMAIL_PROVIDERS.find((p) => p.id === id) ?? null;
}

export function listEmailProviders(): Array<{
  id: EmailProviderId;
  label: string;
  available: boolean;
}> {
  return EMAIL_PROVIDERS.map((p) => ({ id: p.id, label: p.label, available: p.isAvailable() }));
}

export function resolveEmailProvider(preferredId?: EmailProviderId | null): EmailProvider | null {
  if (preferredId) {
    const preferred = getEmailProvider(preferredId);
    if (preferred?.isAvailable()) return preferred;
  }
  const envPin = process.env.EMAIL_PROVIDER?.trim() as EmailProviderId | undefined;
  if (envPin) {
    const pinned = getEmailProvider(envPin);
    if (pinned?.isAvailable()) return pinned;
  }
  return EMAIL_PROVIDERS.find((p) => p.isAvailable()) ?? null;
}
