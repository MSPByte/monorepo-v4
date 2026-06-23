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

export const M365ExchangeConfigRawSchema = z.looseObject({
  OrgConfig: z.object({ RejectDirectSend: z.boolean() }).nullable().optional(),
  AutoForwardingMode: z.string().nullable().optional(),
  AuthPolicies: z
    .array(z.object({ Name: z.string(), AllowBasicAuthSmtp: z.boolean().nullable().optional() }))
    .optional()
    .default([])
});

export const M365DomainItemRawSchema = z.looseObject({
  domainName: z.string(),
  spfRecord: z.string().nullable().optional(),
  spfIsPermissive: z.boolean().nullable().optional(),
  dmarcRecord: z.string().nullable().optional(),
  dmarcPolicy: z.string().nullable().optional(),
  dkimEnabled: z.boolean().nullable().optional(),
  dkimSelector1Present: z.boolean().nullable().optional(),
  dkimSelector2Present: z.boolean().nullable().optional()
});

export const M365TeamsConfigRawSchema = z.looseObject({
  MeetingPolicy: z
    .object({
      AllowAnonymousUsersToJoinMeeting: z.boolean().nullable().optional(),
      AllowExternalParticipantGiveRequestControl: z.boolean().nullable().optional(),
      AllowPSTNUsersToBypassLobby: z.boolean().nullable().optional(),
      AutoAdmittedUsers: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  FederationConfig: z
    .object({
      AllowFederatedUsers: z.boolean().nullable().optional(),
      AllowPublicUsers: z.boolean().nullable().optional(),
      AllowTeamsConsumer: z.boolean().nullable().optional(),
      AllowedDomains: z
        .union([z.array(z.string().nullable()), z.unknown()])
        .nullable()
        .optional()
    })
    .nullable()
    .optional()
});

export const M365MailboxForwardingRawSchema = z.looseObject({
  UserPrincipalName: z.string(),
  ForwardingAddress: z.string().nullable().optional(),
  ForwardingSmtpAddress: z.string().nullable().optional(),
  DeliverToMailboxAndForward: z.boolean().nullable().optional()
});

export const M365InboxRuleRawSchema = z.looseObject({
  Name: z.string(),
  Identity: z.string().nullable().optional(),
  MailboxUserPrincipalName: z.string(),
  Enabled: z.boolean().nullable().optional(),
  DeleteMessage: z.boolean().nullable().optional(),
  MoveToFolder: z.string().nullable().optional(),
  ForwardTo: z.array(z.string()).nullable().optional(),
  ForwardAsAttachmentTo: z.array(z.string()).nullable().optional(),
  RedirectTo: z.array(z.string()).nullable().optional(),
  MarkAsRead: z.boolean().nullable().optional(),
  SubjectContainsWords: z.array(z.string()).nullable().optional()
});

export const M365RawSchemas = {
  [ProviderFacet.M365Identities]: M365UserSchema,
  [ProviderFacet.M365Groups]: M365GroupSchema,
  [ProviderFacet.M365Licenses]: M365SubscribedSkuSchema,
  [ProviderFacet.M365CAPolicies]: M365CAPolicySchema,
  [ProviderFacet.M365Devices]: M365DeviceSchema,
  [ProviderFacet.M365OAuthGrants]: M365OAuthGrantSchema,
  [ProviderFacet.M365RiskyUsers]: M365RiskyUserSchema,
  [ProviderFacet.M365ExchangeConfig]: M365ExchangeConfigRawSchema,
  [ProviderFacet.M365DomainConfig]: M365DomainItemRawSchema,
  [ProviderFacet.M365TeamsConfig]: M365TeamsConfigRawSchema,
  [ProviderFacet.M365MailboxForwarding]: M365MailboxForwardingRawSchema,
  [ProviderFacet.M365InboxRules]: M365InboxRuleRawSchema
} as const;

export type M365RawFacet = keyof typeof M365RawSchemas;
export type M365User = z.infer<typeof M365UserSchema>;
export type M365Group = z.infer<typeof M365GroupSchema>;
export type M365SubscribedSku = z.infer<typeof M365SubscribedSkuSchema>;
export type M365CAPolicy = z.infer<typeof M365CAPolicySchema>;
export type M365Device = z.infer<typeof M365DeviceSchema>;
export type M365OAuthGrant = z.infer<typeof M365OAuthGrantSchema>;
export type M365RiskyUser = z.infer<typeof M365RiskyUserSchema>;
export type M365ExchangeConfigRaw = z.infer<typeof M365ExchangeConfigRawSchema>;
export type M365DomainItemRaw = z.infer<typeof M365DomainItemRawSchema>;
export type M365TeamsConfigRaw = z.infer<typeof M365TeamsConfigRawSchema>;
export type M365MailboxForwardingRaw = z.infer<typeof M365MailboxForwardingRawSchema>;
export type M365InboxRuleRaw = z.infer<typeof M365InboxRuleRawSchema>;

export function getM365RawSchema(facet: ProviderFacet | string) {
  return M365RawSchemas[facet as M365RawFacet];
}
