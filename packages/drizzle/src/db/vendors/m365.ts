import { uuid, text, boolean, integer, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { vendorsSchema } from '../schemas.js';
import { integrationLinks, sites } from '../public/index.js';

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: false });

export const m365Identities = vendorsSchema.table(
  'm365_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    type: text('type', { enum: ['member', 'guest', 'service'] }).notNull(),
    enabled: boolean('enabled').notNull(),
    mfaEnforced: boolean('mfa_enforced').notNull().default(false),
    assignedLicenses: text('assigned_licenses').array(),
    assignedRoleTemplateIds: text('assigned_role_template_ids').array(),
    lastSignInAt: timestamp('last_sign_in_at', {
      withTimezone: true,
      mode: 'string'
    }),
    lastNonInteractiveSignInAt: timestamp('last_non_interactive_sign_in_at', {
      withTimezone: true
    }),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365Groups = vendorsSchema.table(
  'm365_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
    name: text('name').notNull(),
    description: text('description'),
    mailEnabled: boolean('mail_enabled').notNull(),
    securityEnabled: boolean('security_enabled').notNull(),
    memberExternalIds: text('member_external_ids').array(),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365IdentityGroups = vendorsSchema.table(
  'm365_identity_groups',
  {
    identityId: uuid('identity_id')
      .notNull()
      .references(() => m365Identities.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => m365Groups.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [rls]
);

export const m365Roles = vendorsSchema.table(
  'm365_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: text('external_id').notNull(),
    templateId: text('template_id').notNull(),
    name: text('name').notNull(),
    description: text('description')
  },
  (t) => [unique().on(t.templateId), rls]
);

export const m365IdentityRoles = vendorsSchema.table(
  'm365_identity_roles',
  {
    identityId: uuid('identity_id')
      .notNull()
      .references(() => m365Identities.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => m365Roles.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [rls]
);

export const m365Policies = vendorsSchema.table(
  'm365_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
    name: text('name').notNull(),
    description: text('description'),
    policyState: text('policy_state', {
      enum: ['enabled', 'disabled', 'enabledForReportingButNotEnforced']
    }).notNull(),
    conditions: jsonb('conditions'),
    grantControls: jsonb('grant_controls'),
    sessionControls: jsonb('session_controls'),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365PolicyIdentities = vendorsSchema.table(
  'm365_policy_identities',
  {
    policyId: uuid('policy_id')
      .notNull()
      .references(() => m365Policies.id, { onDelete: 'cascade' }),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => m365Identities.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id').notNull(),
    included: boolean('included').notNull(),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [rls]
);

export const m365PolicyGroups = vendorsSchema.table(
  'm365_policy_groups',
  {
    policyId: uuid('policy_id')
      .notNull()
      .references(() => m365Policies.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => m365Groups.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id').notNull(),
    included: boolean('included').notNull(),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [rls]
);

export const m365PolicyRoles = vendorsSchema.table(
  'm365_policy_roles',
  {
    policyId: uuid('policy_id')
      .notNull()
      .references(() => m365Policies.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => m365Roles.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id').notNull(),
    included: boolean('included').notNull(),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [rls]
);

export const m365Licenses = vendorsSchema.table(
  'm365_licenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
    skuId: text('sku_id').notNull(),
    skuPartNumber: text('sku_part_number').notNull(),
    friendlyName: text('friendly_name').notNull(),
    enabled: boolean('enabled').notNull(),
    totalUnits: integer('total_units').notNull(),
    consumedUnits: integer('consumed_units').notNull(),
    lockedOutUnits: integer('locked_out_units').notNull().default(0),
    warningUnits: integer('warning_units').notNull().default(0),
    suspendedUnits: integer('suspended_units').notNull().default(0),
    servicePlanNames: text('service_plan_names').array(),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365ExchangeConfigs = vendorsSchema.table(
  'm365_exchange_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    rejectDirectSend: boolean('reject_direct_send').notNull(),
    autoForwardingMode: text('auto_forwarding_mode'),
    allowBasicAuthSmtp: boolean('allow_basic_auth_smtp'),
    forwardingMailboxes: jsonb('forwarding_mailboxes'),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365Devices = vendorsSchema.table(
  'm365_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
    displayName: text('display_name').notNull(),
    operatingSystem: text('operating_system'),
    operatingSystemVersion: text('operating_system_version'),
    isCompliant: boolean('is_compliant'),
    isManaged: boolean('is_managed'),
    deviceOwnership: text('device_ownership'),
    approximateLastSignInAt: timestamp('approximate_last_sign_in_at', {
      withTimezone: true,
      mode: 'string'
    }),
    registeredAt: timestamp('registered_at', {
      withTimezone: true,
      mode: 'string'
    }),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365OAuthGrants = vendorsSchema.table(
  'm365_oauth_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
    clientId: text('client_id').notNull(),
    clientDisplayName: text('client_display_name'),
    consentType: text('consent_type').notNull(),
    principalId: text('principal_id'),
    resourceId: text('resource_id').notNull(),
    resourceDisplayName: text('resource_display_name'),
    scope: text('scope'),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365DomainConfig = vendorsSchema.table(
  'm365_domain_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    domainName: text('domain_name').notNull(),
    spfRecord: text('spf_record'),
    spfIsPermissive: boolean('spf_is_permissive'),
    dmarcRecord: text('dmarc_record'),
    dmarcPolicy: text('dmarc_policy'),
    dkimEnabled: boolean('dkim_enabled'),
    dkimSelector1Present: boolean('dkim_selector1_present'),
    dkimSelector2Present: boolean('dkim_selector2_present'),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365TeamsConfig = vendorsSchema.table(
  'm365_teams_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    allowAnonymousUsersToJoinMeeting: boolean('allow_anonymous_users_to_join_meeting'),
    allowExternalParticipantGiveRequestControl: boolean(
      'allow_external_participant_give_request_control'
    ),
    allowPSTNUsersToBypassLobby: boolean('allow_pstn_users_to_bypass_lobby'),
    autoAdmittedUsers: text('auto_admitted_users'),
    allowFederatedUsers: boolean('allow_federated_users'),
    allowPublicUsers: boolean('allow_public_users'),
    allowTeamsConsumer: boolean('allow_teams_consumer'),
    allowedDomains: text('allowed_domains').array(),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365RiskyUsers = vendorsSchema.table(
  'm365_risky_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
    userPrincipalName: text('user_principal_name').notNull(),
    userDisplayName: text('user_display_name'),
    riskLevel: text('risk_level').notNull(),
    riskState: text('risk_state').notNull(),
    riskDetail: text('risk_detail'),
    riskLastUpdatedAt: timestamp('risk_last_updated_at', {
      withTimezone: true,
      mode: 'string'
    }),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365MailboxForwarding = vendorsSchema.table(
  'm365_mailbox_forwarding',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    userPrincipalName: text('user_principal_name').notNull(),
    forwardingAddress: text('forwarding_address'),
    forwardingSmtpAddress: text('forwarding_smtp_address'),
    deliverToMailboxAndForward: boolean('deliver_to_mailbox_and_forward'),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const m365InboxRules = vendorsSchema.table(
  'm365_inbox_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    mailboxUpn: text('mailbox_upn').notNull(),
    ruleName: text('rule_name').notNull(),
    ruleIdentity: text('rule_identity'),
    enabled: boolean('enabled'),
    deleteMessage: boolean('delete_message'),
    moveToFolder: text('move_to_folder'),
    forwardTo: text('forward_to').array(),
    forwardAsAttachmentTo: text('forward_as_attachment_to').array(),
    redirectTo: text('redirect_to').array(),
    markAsRead: boolean('mark_as_read'),
    subjectContainsWords: text('subject_contains_words').array(),
    isSuspicious: boolean('is_suspicious').notNull().default(false),
    suspicionReasons: text('suspicion_reasons').array().notNull().default([]),
    lastSeenAt: timestamp('last_seen_at', {
      withTimezone: true,
      mode: 'string'
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);
