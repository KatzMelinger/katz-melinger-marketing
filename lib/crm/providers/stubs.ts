/**
 * Stub adapters for the major legal intake/CRM systems. Each becomes "available"
 * the moment its API credentials are present in the environment — the wiring is
 * here; only the concrete API calls remain to be filled in per integration.
 *
 * This is the extensibility proof for "can this support numerous CRMs?": adding
 * Clio/Lawmatics/Litify/etc. is a self-contained file + one registry line, with
 * zero changes to the attribution funnel or lead-matching callers.
 *
 * To implement one: replace the throwing bodies with real fetches that map the
 * vendor's payload into SourceCount / SourceRevenue / IntakeRecord.
 */

import {
  CrmNotImplementedError,
  type CrmCapabilities,
  type CrmProvider,
  type CrmProviderId,
} from "@/lib/crm/types";

function makeStub(opts: {
  id: CrmProviderId;
  label: string;
  envKeys: string[]; // any one present => configured
  capabilities: CrmCapabilities;
}): CrmProvider {
  const isAvailable = () => opts.envKeys.some((k) => Boolean(process.env[k]?.trim()));
  return {
    id: opts.id,
    label: opts.label,
    capabilities: opts.capabilities,
    isAvailable,
    async getIntakesBySource() {
      throw new CrmNotImplementedError(opts.id, "getIntakesBySource");
    },
    async getMattersBySource() {
      throw new CrmNotImplementedError(opts.id, "getMattersBySource");
    },
    async getRevenueBySource() {
      throw new CrmNotImplementedError(opts.id, "getRevenueBySource");
    },
    // Most of these CRMs expose per-record intakes via REST, so we advertise the
    // capability and leave getIntakeRecords to the implementer.
    async getIntakeRecords() {
      throw new CrmNotImplementedError(opts.id, "getIntakeRecords");
    },
  };
}

export const clioProvider = makeStub({
  id: "clio",
  label: "Clio Grow / Manage",
  envKeys: ["CLIO_ACCESS_TOKEN", "CLIO_API_KEY"],
  capabilities: { bySource: true, intakeRecords: true },
});

export const lawmaticsProvider = makeStub({
  id: "lawmatics",
  label: "Lawmatics",
  envKeys: ["LAWMATICS_API_KEY", "LAWMATICS_ACCESS_TOKEN"],
  capabilities: { bySource: true, intakeRecords: true },
});

export const litifyProvider = makeStub({
  id: "litify",
  label: "Litify (Salesforce)",
  envKeys: ["LITIFY_ACCESS_TOKEN", "SALESFORCE_ACCESS_TOKEN"],
  capabilities: { bySource: true, intakeRecords: true },
});
