import {
  M365CAPolicySchema,
  M365DeviceSchema,
  M365DomainItemRawSchema,
  M365ExchangeConfigRawSchema,
  M365GroupSchema,
  M365InboxRuleRawSchema,
  M365MailboxForwardingRawSchema,
  M365OAuthGrantSchema,
  M365RiskyUserSchema,
  M365SubscribedSkuSchema,
  M365TeamsConfigRawSchema,
  M365UserSchema,
  ProviderFacet,
  externalInboxRuleRecipients,
  type M365CAPolicy,
  type M365Device,
  type M365DomainItemRaw,
  type M365ExchangeConfigRaw,
  type M365Group,
  type M365InboxRuleRaw,
  type M365MailboxForwardingRaw,
  type M365OAuthGrant,
  type M365RiskyUser,
  type M365SubscribedSku,
  type M365TeamsConfigRaw,
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
    case ProviderFacet.M365Devices:
      return normalizeDevice(M365DeviceSchema.parse(raw));
    case ProviderFacet.M365OAuthGrants:
      return normalizeOAuthGrant(M365OAuthGrantSchema.parse(raw));
    case ProviderFacet.M365RiskyUsers:
      return normalizeRiskyUser(M365RiskyUserSchema.parse(raw));
    case ProviderFacet.M365ExchangeConfig:
      return normalizeExchangeConfig(M365ExchangeConfigRawSchema.parse(raw));
    case ProviderFacet.M365DomainConfig:
      return normalizeDomainConfig(M365DomainItemRawSchema.parse(raw));
    case ProviderFacet.M365TeamsConfig:
      return normalizeTeamsConfig(M365TeamsConfigRawSchema.parse(raw));
    case ProviderFacet.M365MailboxForwarding:
      return normalizeMailboxForwarding(M365MailboxForwardingRawSchema.parse(raw));
    case ProviderFacet.M365InboxRules:
      return normalizeInboxRule(M365InboxRuleRawSchema.parse(raw));
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

function normalizeExchangeConfig(raw: M365ExchangeConfigRaw): RecordValue {
  const authPolicies = raw.AuthPolicies ?? [];
  const allowBasicAuthSmtp =
    authPolicies.length > 0
      ? authPolicies.some((policy) => policy.AllowBasicAuthSmtp === true)
      : null;

  return {
    externalId: 'org-config',
    rejectDirectSend: raw.OrgConfig?.RejectDirectSend ?? false,
    autoForwardingMode: raw.AutoForwardingMode ?? null,
    allowBasicAuthSmtp,
    forwardingMailboxes: null
  };
}

function normalizeDomainConfig(raw: M365DomainItemRaw): RecordValue {
  return {
    externalId: raw.domainName,
    domainName: raw.domainName,
    spfRecord: raw.spfRecord ?? null,
    spfIsPermissive: raw.spfIsPermissive ?? null,
    dmarcRecord: raw.dmarcRecord ?? null,
    dmarcPolicy: raw.dmarcPolicy ?? null,
    dkimEnabled: raw.dkimEnabled ?? null,
    dkimSelector1Present: raw.dkimSelector1Present ?? null,
    dkimSelector2Present: raw.dkimSelector2Present ?? null
  };
}

function normalizeTeamsConfig(raw: M365TeamsConfigRaw): RecordValue {
  const meeting = raw.MeetingPolicy;
  const federation = raw.FederationConfig;
  let allowedDomains: string[] | null = null;
  if (federation?.AllowedDomains != null && Array.isArray(federation.AllowedDomains)) {
    allowedDomains = (federation.AllowedDomains as Array<string | null>).filter(
      (domain): domain is string => domain !== null
    );
  }

  return {
    externalId: 'teams-config',
    allowAnonymousUsersToJoinMeeting: meeting?.AllowAnonymousUsersToJoinMeeting ?? null,
    allowExternalParticipantGiveRequestControl:
      meeting?.AllowExternalParticipantGiveRequestControl ?? null,
    allowPSTNUsersToBypassLobby: meeting?.AllowPSTNUsersToBypassLobby ?? null,
    autoAdmittedUsers: meeting?.AutoAdmittedUsers ?? null,
    allowFederatedUsers: federation?.AllowFederatedUsers ?? null,
    allowPublicUsers: federation?.AllowPublicUsers ?? null,
    allowTeamsConsumer: federation?.AllowTeamsConsumer ?? null,
    allowedDomains
  };
}

function normalizeMailboxForwarding(raw: M365MailboxForwardingRaw): RecordValue {
  const rawSmtp = raw.ForwardingSmtpAddress ?? null;
  const smtpAddress = rawSmtp?.toLowerCase().startsWith('smtp:')
    ? rawSmtp.slice(5)
    : rawSmtp;

  return {
    externalId: raw.UserPrincipalName.toLowerCase(),
    userPrincipalName: raw.UserPrincipalName,
    forwardingAddress: raw.ForwardingAddress ?? null,
    forwardingSmtpAddress: smtpAddress ?? null,
    deliverToMailboxAndForward: raw.DeliverToMailboxAndForward ?? null
  };
}

const INBOX_RULE_JUNK_FOLDERS = ['Deleted Items', 'Junk Email', 'RSS Feeds', 'Trash'];

function normalizeInboxRule(raw: M365InboxRuleRaw): RecordValue {
  const forwardTo = raw.ForwardTo?.filter(Boolean) ?? null;
  const forwardAsAttachmentTo = raw.ForwardAsAttachmentTo?.filter(Boolean) ?? null;
  const redirectTo = raw.RedirectTo?.filter(Boolean) ?? null;

  const externalForwardTo = externalInboxRuleRecipients(forwardTo, raw.MailboxUserPrincipalName);
  const externalForwardAsAttachmentTo = externalInboxRuleRecipients(
    forwardAsAttachmentTo,
    raw.MailboxUserPrincipalName
  );

  const suspicionReasons: string[] = [];
  if (raw.DeleteMessage === true) suspicionReasons.push('deletesMessages');
  if (externalForwardTo.length > 0 || externalForwardAsAttachmentTo.length > 0) {
    suspicionReasons.push('forwardsExternally');
  }
  if ((redirectTo?.length ?? 0) > 0) suspicionReasons.push('redirectsMessages');
  if (raw.MoveToFolder && INBOX_RULE_JUNK_FOLDERS.includes(raw.MoveToFolder)) {
    suspicionReasons.push('movesToJunk');
  }

  const dedupedReasons = [...new Set(suspicionReasons)];

  return {
    externalId: `${raw.MailboxUserPrincipalName.toLowerCase()}::${raw.Identity ?? raw.Name}`,
    mailboxUpn: raw.MailboxUserPrincipalName,
    ruleName: raw.Name,
    ruleIdentity: raw.Identity ?? null,
    enabled: raw.Enabled ?? null,
    deleteMessage: raw.DeleteMessage ?? null,
    moveToFolder: raw.MoveToFolder ?? null,
    forwardTo,
    forwardAsAttachmentTo,
    redirectTo,
    markAsRead: raw.MarkAsRead ?? null,
    subjectContainsWords: raw.SubjectContainsWords?.filter(Boolean) ?? null,
    isSuspicious: dedupedReasons.length > 0,
    suspicionReasons: dedupedReasons
  };
}

function dateString(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
