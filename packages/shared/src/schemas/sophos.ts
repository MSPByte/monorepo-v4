import { z } from "zod";
import { ProviderFacet } from "../types/provider.js";

export const SophosEndpointSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  online: z.boolean(),
  hostname: z.string(),
  mdrManaged: z.boolean(),
  tamperProtectionEnabled: z.boolean(),
  lastSeenAt: z.string().nullable().optional(),
  os: z.looseObject({ name: z.string(), platform: z.string() }),
  health: z.looseObject({ overall: z.string() }),
  lockdown: z.looseObject({ status: z.string() }),
  packages: z
    .looseObject({
      protection: z.looseObject({ status: z.string() }).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const SophosFirewallSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  hostname: z.string(),
  serialNumber: z.string(),
  model: z.string().nullable().optional(),
  firmwareVersion: z.string().nullable().optional(),
  externalIpv4Addresses: z.array(z.string()).nullable().optional(),
  stateChangedAt: z.string().nullable().optional(),
  status: z
    .looseObject({
      managingStatus: z.string().nullable().optional(),
      reportingStatus: z.string().nullable().optional(),
      connected: z.boolean().nullable().optional(),
      suspended: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
  _upgrade_to_version: z.string().nullable().optional(),
});

export const SophosLicenseSchema = z.looseObject({
  id: z.string(),
  licenseIdentifier: z.string(),
  product: z.looseObject({
    code: z.string(),
    name: z.string().nullable().optional(),
  }),
  type: z.string(),
  perpetual: z.boolean(),
  unlimited: z.boolean(),
  quantity: z.number().nullable().optional().default(0),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  usage: z
    .looseObject({
      current: z
        .looseObject({ count: z.number().nullable().optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

export const SophosTamperProtectionSchema = z.looseObject({
  _endpoint_id: z.string(),
  _endpoint_external_id: z.string(),
  password: z.string(),
  previousPasswords: z
    .array(
      z.looseObject({
        password: z.string(),
        invalidatedAt: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

export const SophosRawSchemas = {
  [ProviderFacet.SophosEndpoints]: SophosEndpointSchema,
  [ProviderFacet.SophosFirewalls]: SophosFirewallSchema,
  [ProviderFacet.SophosLicenses]: SophosLicenseSchema,
  [ProviderFacet.SophosTamperProtection]: SophosTamperProtectionSchema,
} as const;

export type SophosRawFacet = keyof typeof SophosRawSchemas;
export type SophosEndpoint = z.infer<typeof SophosEndpointSchema>;
export type SophosFirewall = z.infer<typeof SophosFirewallSchema>;
export type SophosLicense = z.infer<typeof SophosLicenseSchema>;
export type SophosTamperProtection = z.infer<typeof SophosTamperProtectionSchema>;

export function getSophosRawSchema(facet: ProviderFacet | string) {
  return SophosRawSchemas[facet as SophosRawFacet];
}
