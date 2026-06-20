import {
  M365AuthMethodSchema,
  M365CAPolicySchema,
  M365DeviceSchema,
  M365GroupSchema,
  M365OAuthGrantSchema,
  M365RiskyUserSchema,
  M365SubscribedSkuSchema,
  M365UserSchema,
  ProviderFacet,
  type M365AuthMethod,
  type M365CAPolicy,
  type M365Device,
  type M365Group,
  type M365OAuthGrant,
  type M365RiskyUser,
  type M365SubscribedSku,
  type M365User
} from '@mspbyte/shared';

type RecordValue = Record<string, unknown>;

export function normalizeM365(facet: string, raw: unknown): RecordValue {
  switch (facet) {
    case ProviderFacet.M365Identities:
      return normalizeIdentity(M365UserSchema.parse(raw));
    case ProviderFacet.M365Groups:
      return normalizeGroup(M365GroupSchema.parse(raw));
    case ProviderFacet.M365Licenses:
      return normalizeLicense(M365SubscribedSkuSchema.parse(raw));
    case ProviderFacet.M365CAPolicies:
      return normalizePolicy(M365CAPolicySchema.parse(raw));
    case ProviderFacet.M365AuthMethods:
      return normalizeAuthMethod(M365AuthMethodSchema.parse(raw));
    case ProviderFacet.M365Devices:
      return normalizeDevice(M365DeviceSchema.parse(raw));
    case ProviderFacet.M365OAuthGrants:
      return normalizeOAuthGrant(M365OAuthGrantSchema.parse(raw));
    case ProviderFacet.M365RiskyUsers:
      return normalizeRiskyUser(M365RiskyUserSchema.parse(raw));
    default:
      throw new Error(`Unsupported M365 projection facet: ${facet}`);
  }
}

function normalizeIdentity(raw: M365User): RecordValue {
  const userType = raw.userType ?? 'service';

  const normalized: RecordValue = {
    externalId: raw.id,
    name: raw.displayName ?? raw.userPrincipalName,
    email: raw.userPrincipalName,
    type: userType,
    enabled: raw.accountEnabled ?? true,
    mfaEnforced: false,
    assignedLicenses: raw.assignedLicenses?.map((license) => license.skuId) ?? [],
    lastSignInAt: dateString(raw.signInActivity?.lastSignInDateTime),
    lastNonInteractiveSignInAt: dateString(raw.signInActivity?.lastNonInteractiveSignInDateTime)
  };

  if (Array.isArray(raw._role_template_ids)) {
    normalized.assignedRoleTemplateIds = raw._role_template_ids;
  }

  return normalized;
}

function normalizeGroup(raw: M365Group): RecordValue {
  return {
    externalId: raw.id,
    name: raw.displayName,
    description: raw.description ?? null,
    mailEnabled: raw.mailEnabled,
    securityEnabled: raw.securityEnabled ?? false,
    memberExternalIds: raw._member_ids
  };
}

function normalizeLicense(raw: M365SubscribedSku): RecordValue {
  return {
    externalId: raw.skuId,
    skuId: raw.skuId,
    skuPartNumber: raw.skuPartNumber,
    friendlyName: raw._friendlyName ?? raw.skuPartNumber,
    enabled: raw.capabilityStatus === 'Enabled',
    totalUnits: raw.prepaidUnits?.enabled ?? 0,
    consumedUnits: raw.consumedUnits ?? 0,
    suspendedUnits: raw.prepaidUnits?.suspended ?? 0,
    warningUnits: raw.prepaidUnits?.warning ?? 0,
    lockedOutUnits: raw.prepaidUnits?.lockedOut ?? 0,
    servicePlanNames: raw.servicePlans.map((plan) => plan.servicePlanName)
  };
}

function normalizePolicy(raw: M365CAPolicy): RecordValue {
  return {
    externalId: raw.id,
    name: raw.displayName,
    description: null,
    policyState: raw.state,
    conditions: raw.conditions ?? null,
    grantControls: raw.grantControls ?? null,
    sessionControls: raw.sessionControls ?? null
  };
}

function normalizeAuthMethod(raw: M365AuthMethod): RecordValue {
  return {
    externalId: `${raw._identity_external_id}_${raw.id}`,
    identityExternalId: raw._identity_external_id,
    type: raw._method_type,
    creationDateAt: dateString(raw.createdDateTime),
    meta: raw
  };
}

function normalizeDevice(raw: M365Device): RecordValue {
  return {
    externalId: raw.id,
    displayName: raw.displayName,
    operatingSystem: raw.operatingSystem ?? null,
    operatingSystemVersion: raw.operatingSystemVersion ?? null,
    isCompliant: raw.isCompliant ?? null,
    isManaged: raw.isManaged ?? null,
    deviceOwnership: raw.deviceOwnership ?? null,
    approximateLastSignInAt: dateString(raw.approximateLastSignInDateTime),
    registeredAt: dateString(raw.registrationDateTime)
  };
}

function normalizeOAuthGrant(raw: M365OAuthGrant): RecordValue {
  return {
    externalId: raw.id,
    clientId: raw.clientId,
    clientDisplayName: raw.clientDisplayName ?? null,
    consentType: raw.consentType,
    principalId: raw.principalId ?? null,
    resourceId: raw.resourceId,
    resourceDisplayName: raw.resourceDisplayName ?? null,
    scope: raw.scope ?? null
  };
}

function normalizeRiskyUser(raw: M365RiskyUser): RecordValue {
  return {
    externalId: raw.id,
    userPrincipalName: raw.userPrincipalName,
    userDisplayName: raw.userDisplayName ?? null,
    riskLevel: raw.riskLevel,
    riskState: raw.riskState,
    riskDetail: raw.riskDetail ?? null,
    riskLastUpdatedAt: dateString(raw.riskLastUpdatedDateTime)
  };
}

function dateString(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
