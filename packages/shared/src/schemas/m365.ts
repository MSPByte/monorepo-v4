import { z } from 'zod';
import { ProviderFacet } from '../types/provider.js';

export const M365UserSchema = z.looseObject({
  id: z.string(),
  displayName: z.string().nullable().optional(),
  userType: z.string().nullable().optional(),
  userPrincipalName: z.string(),
  accountEnabled: z.boolean().optional(),
  assignedLicenses: z.array(z.object({ skuId: z.string() })).optional(),
  _role_template_ids: z.array(z.string()).optional(),
  signInActivity: z
    .object({
      lastSignInDateTime: z.string().nullable().optional(),
      lastNonInteractiveSignInDateTime: z.string().nullable().optional()
    })
    .optional()
});

export const M365GroupSchema = z.looseObject({
  id: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  groupTypes: z.array(z.string()).optional(),
  mailEnabled: z.boolean(),
  securityEnabled: z.boolean().optional(),
  _member_ids: z.array(z.string()).optional().default([])
});

export const M365SubscribedSkuSchema = z.looseObject({
  skuId: z.string(),
  skuPartNumber: z.string(),
  capabilityStatus: z.string(),
  consumedUnits: z.number().optional(),
  prepaidUnits: z
    .object({
      enabled: z.number().optional(),
      suspended: z.number().optional(),
      warning: z.number().optional(),
      lockedOut: z.number().optional()
    })
    .optional(),
  servicePlans: z
    .array(z.object({ servicePlanName: z.string() }))
    .optional()
    .default([]),
  _friendlyName: z.string().optional()
});

export const M365CAPolicySchema = z.looseObject({
  id: z.string(),
  displayName: z.string(),
  state: z.enum(['enabled', 'disabled', 'enabledForReportingButNotEnforced']),
  conditions: z.record(z.string(), z.unknown()).optional(),
  grantControls: z.record(z.string(), z.unknown()).nullable().optional(),
  sessionControls: z.record(z.string(), z.unknown()).nullable().optional()
});

export const M365DeviceSchema = z.looseObject({
  id: z.string(),
  displayName: z.string(),
  operatingSystem: z.string().nullable().optional(),
  operatingSystemVersion: z.string().nullable().optional(),
  isCompliant: z.boolean().nullable().optional(),
  isManaged: z.boolean().nullable().optional(),
  deviceOwnership: z.string().nullable().optional(),
  approximateLastSignInDateTime: z.string().nullable().optional(),
  registrationDateTime: z.string().nullable().optional()
});

export const M365OAuthGrantSchema = z.looseObject({
  id: z.string(),
  clientId: z.string(),
  consentType: z.string(),
  principalId: z.string().nullable().optional(),
  resourceId: z.string(),
  scope: z.string().nullable().optional(),
  clientDisplayName: z.string().nullable().optional(),
  resourceDisplayName: z.string().nullable().optional()
});

export const M365RiskyUserSchema = z.looseObject({
  id: z.string(),
  userPrincipalName: z.string(),
  userDisplayName: z.string().nullable().optional(),
  riskLevel: z.string(),
  riskState: z.string(),
  riskDetail: z.string().nullable().optional(),
  riskLastUpdatedDateTime: z.string().nullable().optional()
});

export const M365RawSchemas = {
  [ProviderFacet.M365Identities]: M365UserSchema,
  [ProviderFacet.M365Groups]: M365GroupSchema,
  [ProviderFacet.M365Licenses]: M365SubscribedSkuSchema,
  [ProviderFacet.M365CAPolicies]: M365CAPolicySchema,
  [ProviderFacet.M365Devices]: M365DeviceSchema,
  [ProviderFacet.M365OAuthGrants]: M365OAuthGrantSchema,
  [ProviderFacet.M365RiskyUsers]: M365RiskyUserSchema
} as const;

export type M365RawFacet = keyof typeof M365RawSchemas;
export type M365User = z.infer<typeof M365UserSchema>;
export type M365Group = z.infer<typeof M365GroupSchema>;
export type M365SubscribedSku = z.infer<typeof M365SubscribedSkuSchema>;
export type M365CAPolicy = z.infer<typeof M365CAPolicySchema>;
export type M365Device = z.infer<typeof M365DeviceSchema>;
export type M365OAuthGrant = z.infer<typeof M365OAuthGrantSchema>;
export type M365RiskyUser = z.infer<typeof M365RiskyUserSchema>;

export function getM365RawSchema(facet: ProviderFacet | string) {
  return M365RawSchemas[facet as M365RawFacet];
}
