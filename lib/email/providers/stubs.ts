/**
 * Stub email providers — registered + selectable, not yet implemented.
 *
 * Same approach as lib/crm/providers/stubs.ts: each reports availability from its
 * env keys so it shows up in the picker once a tenant adds credentials, but its
 * data methods return an empty "not implemented yet" dashboard. Implementing one
 * = replace the stub with a real provider file; no caller changes.
 */

import {
  emptyEmailDashboard,
  type EmailDashboard,
  type EmailList,
  type EmailProvider,
  type EmailProviderId,
} from "@/lib/email/types";

function makeStub(id: EmailProviderId, label: string, envKeys: string[]): EmailProvider {
  return {
    id,
    label,
    isAvailable: () => envKeys.some((k) => Boolean(process.env[k]?.trim())),
    isConnected: async () => false,
    listLists: async (): Promise<EmailList[]> => [],
    getDashboard: async (): Promise<EmailDashboard> =>
      emptyEmailDashboard(`${label} email integration isn't implemented yet.`),
  };
}

export const mailchimpProvider = makeStub("mailchimp", "Mailchimp", [
  "MAILCHIMP_API_KEY",
]);

export const sendgridProvider = makeStub("sendgrid", "SendGrid Marketing", [
  "SENDGRID_API_KEY",
]);
