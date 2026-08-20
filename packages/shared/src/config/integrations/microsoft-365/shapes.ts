import type { SchemaFields } from '../../../types/schema-registry.js';

/**
 * Field keys mirror the drizzle camelCase column names on the corresponding
 * vendors.* table so consumers (billing filters, table-data queries, etc.)
 * can use the key as the DB column identifier without extra mapping.
 */

export const M365IdentitiesShape: SchemaFields = {
  name: {
    label: 'Display Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'name',
    required: true
  },
  email: {
    label: 'Email',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'email',
    required: false
  },
  type: {
    label: 'Identity Type',
    type: 'enum',
    modality: 'single',
    trackable: true,
    ingestPath: 'type',
    required: true,
    options: [
      { value: 'member', label: 'Member' },
      { value: 'guest', label: 'Guest' },
      { value: 'service', label: 'Service' }
    ]
  },
  enabled: {
    label: 'Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'enabled',
    required: true
  },
  mfaEnforced: {
    label: 'MFA Enforced',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'mfaEnforced',
    required: false
  },
  lastSignInAt: {
    label: 'Last Sign-In',
    type: 'date',
    modality: 'single',
    trackable: true,
    ingestPath: 'lastSignInAt',
    required: false
  },
  lastNonInteractiveSignInAt: {
    label: 'Last System Sign-In',
    type: 'date',
    modality: 'single',
    trackable: true,
    ingestPath: 'lastNonInteractiveSignInAt',
    required: false
  },
  assignedLicenses: {
    label: 'Licenses',
    type: 'string',
    modality: 'array',
    trackable: true,
    ingestPath: 'assignedLicenses',
    required: false,
    reference: {
      table: 'm365Licenses',
      valueColumn: 'externalId',
      labelColumn: 'friendlyName'
    }
  },
  assignedRoleTemplateIds: {
    label: 'Assigned Roles',
    type: 'string',
    modality: 'array',
    trackable: true,
    ingestPath: 'assignedRoleTemplateIds',
    required: false,
    reference: {
      table: 'm365Roles',
      valueColumn: 'templateId',
      labelColumn: 'name'
    }
  },
  groupNames: {
    label: 'Groups',
    type: 'string',
    modality: 'array',
    trackable: false,
    ingestPath: 'groupNames',
    required: false
  },
  tenantName: {
    label: 'Tenant Name',
    type: 'string',
    modality: 'single',
    trackable: false,
    ingestPath: 'tenantName',
    required: false
  }
};

export const M365GroupsShape: SchemaFields = {
  name: {
    label: 'Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'name',
    required: true
  },
  description: {
    label: 'Description',
    type: 'string',
    modality: 'single',
    trackable: false,
    ingestPath: 'description',
    required: false
  },
  mailEnabled: {
    label: 'Mail Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'mailEnabled',
    required: true
  },
  securityEnabled: {
    label: 'Security Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'securityEnabled',
    required: true
  },
  memberExternalIds: {
    label: 'Member IDs',
    type: 'string',
    modality: 'array',
    trackable: false,
    ingestPath: 'memberExternalIds',
    required: false
  }
};

export const M365LicensesShape: SchemaFields = {
  skuId: {
    label: 'SKU ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'skuId',
    required: true
  },
  skuPartNumber: {
    label: 'SKU Part Number',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'skuPartNumber',
    required: true
  },
  friendlyName: {
    label: 'Friendly Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'friendlyName',
    required: true
  },
  isBloat: {
    label: 'Bloat License',
    type: 'boolean',
    modality: 'single',
    trackable: false,
    ingestPath: 'isBloat',
    required: true
  },
  enabled: {
    label: 'Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'enabled',
    required: true
  },
  totalUnits: {
    label: 'Total Units',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'totalUnits',
    required: true
  },
  consumedUnits: {
    label: 'Consumed Units',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'consumedUnits',
    required: true
  },
  lockedOutUnits: {
    label: 'Locked-Out Units',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'lockedOutUnits',
    required: true
  },
  warningUnits: {
    label: 'Warning Units',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'warningUnits',
    required: true
  },
  suspendedUnits: {
    label: 'Suspended Units',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'suspendedUnits',
    required: true
  },
  servicePlanNames: {
    label: 'Service Plans',
    type: 'string',
    modality: 'array',
    trackable: true,
    ingestPath: 'servicePlanNames',
    required: false
  }
};

export const M365DevicesShape: SchemaFields = {
  displayName: {
    label: 'Display Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'displayName',
    required: true
  },
  operatingSystem: {
    label: 'Operating System',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'operatingSystem',
    required: false
  },
  operatingSystemVersion: {
    label: 'Operating System Version',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'operatingSystemVersion',
    required: false
  },
  isCompliant: {
    label: 'Compliant',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'isCompliant',
    required: false
  },
  isManaged: {
    label: 'Managed',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'isManaged',
    required: false
  },
  deviceOwnership: {
    label: 'Ownership',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'deviceOwnership',
    required: false
  },
  approximateLastSignInAt: {
    label: 'Last Sign-In',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'approximateLastSignInAt',
    required: false
  },
  registeredAt: {
    label: 'Registered At',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'registeredAt',
    required: false
  }
};

export const M365ExchangeConfigsShape: SchemaFields = {
  rejectDirectSend: {
    label: 'Reject Direct Send',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'rejectDirectSend',
    required: true
  },
  autoForwardingMode: {
    label: 'Auto-Forwarding Mode',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'autoForwardingMode',
    required: false
  },
  allowBasicAuthSmtp: {
    label: 'Allow Basic Auth SMTP',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'allowBasicAuthSmtp',
    required: false
  },
  forwardingMailboxes: {
    label: 'Forwarding Mailboxes',
    type: 'object',
    modality: 'single',
    trackable: false,
    ingestPath: 'forwardingMailboxes',
    required: false
  }
};

export const M365OAuthGrantsShape: SchemaFields = {
  clientId: {
    label: 'Client ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'clientId',
    required: true
  },
  clientDisplayName: {
    label: 'Client Display Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'clientDisplayName',
    required: false
  },
  consentType: {
    label: 'Consent Type',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'consentType',
    required: true
  },
  principalId: {
    label: 'Principal ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'principalId',
    required: false
  },
  resourceId: {
    label: 'Resource ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'resourceId',
    required: true
  },
  resourceDisplayName: {
    label: 'Resource Display Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'resourceDisplayName',
    required: false
  },
  scope: {
    label: 'Scope',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'scope',
    required: false
  }
};

export const M365DomainConfigShape: SchemaFields = {
  domainName: {
    label: 'Domain Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'domainName',
    required: true
  },
  spfRecord: {
    label: 'SPF Record',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'spfRecord',
    required: false
  },
  spfIsPermissive: {
    label: 'SPF Is Permissive',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'spfIsPermissive',
    required: false
  },
  dmarcRecord: {
    label: 'DMARC Record',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'dmarcRecord',
    required: false
  },
  dmarcPolicy: {
    label: 'DMARC Policy',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'dmarcPolicy',
    required: false
  },
  dkimEnabled: {
    label: 'DKIM Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'dkimEnabled',
    required: false
  },
  dkimSelector1Present: {
    label: 'DKIM Selector 1 Present',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'dkimSelector1Present',
    required: false
  },
  dkimSelector2Present: {
    label: 'DKIM Selector 2 Present',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'dkimSelector2Present',
    required: false
  }
};

export const M365TeamsConfigShape: SchemaFields = {
  allowAnonymousUsersToJoinMeeting: {
    label: 'Allow Anonymous Users to Join Meetings',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'allowAnonymousUsersToJoinMeeting',
    required: false
  },
  allowExternalParticipantGiveRequestControl: {
    label: 'Allow External Participants to Request Control',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'allowExternalParticipantGiveRequestControl',
    required: false
  },
  allowPSTNUsersToBypassLobby: {
    label: 'Allow PSTN Users to Bypass Lobby',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'allowPSTNUsersToBypassLobby',
    required: false
  },
  autoAdmittedUsers: {
    label: 'Auto-Admitted Users',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'autoAdmittedUsers',
    required: false
  },
  allowFederatedUsers: {
    label: 'Allow Federated Users',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'allowFederatedUsers',
    required: false
  },
  allowPublicUsers: {
    label: 'Allow Public Users',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'allowPublicUsers',
    required: false
  },
  allowTeamsConsumer: {
    label: 'Allow Teams Consumer',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'allowTeamsConsumer',
    required: false
  },
  allowedDomains: {
    label: 'Allowed Domains',
    type: 'string',
    modality: 'array',
    trackable: true,
    ingestPath: 'allowedDomains',
    required: false
  }
};

export const M365RiskyUsersShape: SchemaFields = {
  userPrincipalName: {
    label: 'User Principal Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'userPrincipalName',
    required: true
  },
  userDisplayName: {
    label: 'User Display Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'userDisplayName',
    required: false
  },
  riskLevel: {
    label: 'Risk Level',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'riskLevel',
    required: true
  },
  riskState: {
    label: 'Risk State',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'riskState',
    required: true
  },
  riskDetail: {
    label: 'Risk Detail',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'riskDetail',
    required: false
  },
  riskLastUpdatedAt: {
    label: 'Risk Last Updated At',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'riskLastUpdatedAt',
    required: false
  }
};

export const M365MailboxForwardingShape: SchemaFields = {
  userPrincipalName: {
    label: 'User Principal Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'userPrincipalName',
    required: true
  },
  forwardingAddress: {
    label: 'Forwarding Address',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'forwardingAddress',
    required: false
  },
  forwardingSmtpAddress: {
    label: 'Forwarding SMTP Address',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'forwardingSmtpAddress',
    required: false
  },
  deliverToMailboxAndForward: {
    label: 'Deliver to Mailbox and Forward',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'deliverToMailboxAndForward',
    required: false
  }
};

export const M365InboxRulesShape: SchemaFields = {
  mailboxUpn: {
    label: 'Mailbox UPN',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'mailboxUpn',
    required: true
  },
  ruleName: {
    label: 'Rule Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'ruleName',
    required: true
  },
  ruleIdentity: {
    label: 'Rule Identity',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'ruleIdentity',
    required: false
  },
  enabled: {
    label: 'Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'enabled',
    required: false
  },
  deleteMessage: {
    label: 'Delete Message',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'deleteMessage',
    required: false
  },
  moveToFolder: {
    label: 'Move to Folder',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'moveToFolder',
    required: false
  },
  forwardTo: {
    label: 'Forward To',
    type: 'string',
    modality: 'array',
    trackable: true,
    ingestPath: 'forwardTo',
    required: false
  },
  forwardAsAttachmentTo: {
    label: 'Forward as Attachment To',
    type: 'string',
    modality: 'array',
    trackable: true,
    ingestPath: 'forwardAsAttachmentTo',
    required: false
  },
  redirectTo: {
    label: 'Redirect To',
    type: 'string',
    modality: 'array',
    trackable: true,
    ingestPath: 'redirectTo',
    required: false
  },
  markAsRead: {
    label: 'Mark as Read',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'markAsRead',
    required: false
  },
  subjectContainsWords: {
    label: 'Subject Contains Words',
    type: 'string',
    modality: 'array',
    trackable: true,
    ingestPath: 'subjectContainsWords',
    required: false
  },
  isSuspicious: {
    label: 'Suspicious',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'isSuspicious',
    required: true
  },
  suspicionReasons: {
    label: 'Suspicion Reasons',
    type: 'string',
    modality: 'array',
    trackable: true,
    ingestPath: 'suspicionReasons',
    required: true
  }
};
