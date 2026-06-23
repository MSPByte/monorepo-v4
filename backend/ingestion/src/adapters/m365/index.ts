import dns from 'node:dns';
import { M365Connector, SkuCatalogService, TenantCapabilityService } from '@mspbyte/connectors';
import { m365Roles } from '@mspbyte/drizzle';
import {
  CAPABILITY_PLANS,
  M365_BLOAT_LICENSES,
  type MSGraphCapabilities
} from '@mspbyte/shared/config/integrations/microsoft-365';
import { getM365RawSchema, PROVIDER_IDS, ProviderFacet } from '@mspbyte/shared';
import type {
  FetchPage,
  FetchResultCursor,
  IngestionAdapter,
  IngestionAdapterContext,
  RawRecordEnvelope,
  SyncMode
} from '@mspbyte/pipeline';
import { getMicrosoftCertPem, requireMicrosoftCredentials, env } from '../../env.js';
import { logger } from '../../logger.js';
import { serializeError } from '../../errors.js';
import {
  INBOX_RULES_BATCH_SIZE,
  runExchangeOnlineDomainConfig,
  runExchangeOnlineFull,
  runInboxRules,
  runMailboxForwardingFull,
  runMicrosoftTeams
} from './ps-runner.js';

const M365_IDENTITY_BASE_FIELDS = [
  'id',
  'displayName',
  'userType',
  'userPrincipalName',
  'accountEnabled',
  'assignedLicenses'
];
const M365_IDENTITY_DELTA_FIELDS = [
  'id',
  'displayName',
  'userType',
  'userPrincipalName',
  'accountEnabled'
].join(',');

export const m365Adapter: IngestionAdapter = {
  providerId: PROVIDER_IDS.M365,
  types: [
    ProviderFacet.M365Identities,
    ProviderFacet.M365Groups,
    ProviderFacet.M365Licenses,
    ProviderFacet.M365CAPolicies,
    ProviderFacet.M365Devices,
    ProviderFacet.M365OAuthGrants,
    ProviderFacet.M365RiskyUsers,
    ProviderFacet.M365ExchangeConfig,
    ProviderFacet.M365DomainConfig,
    ProviderFacet.M365TeamsConfig,
    ProviderFacet.M365MailboxForwarding,
    ProviderFacet.M365InboxRules
  ],

  async *fetch(type, mode, cursor, context): AsyncGenerator<FetchPage, FetchResultCursor> {
    const facet = type as ProviderFacet;
    const connector = createConnector(context);
    const capabilities = await getCapabilities(connector, context);

    switch (facet) {
      case ProviderFacet.M365Identities:
        return yield* fetchIdentities(connector, mode, cursor, capabilities, context);
      case ProviderFacet.M365Groups:
        return yield* fetchGroups(connector);
      case ProviderFacet.M365Licenses:
        return yield* fetchLicenses(connector);
      case ProviderFacet.M365CAPolicies:
        return yield* fetchConditionalAccessPolicies(connector, context, capabilities);
      case ProviderFacet.M365Devices:
        return yield* fetchDevices(connector);
      case ProviderFacet.M365OAuthGrants:
        return yield* fetchOAuthGrants(connector, context);
      case ProviderFacet.M365RiskyUsers:
        return yield* fetchRiskyUsers(connector, context, capabilities);
      case ProviderFacet.M365ExchangeConfig:
        return yield* fetchExchangeConfig(context);
      case ProviderFacet.M365DomainConfig:
        return yield* fetchDomainConfig(context);
      case ProviderFacet.M365TeamsConfig:
        return yield* fetchTeamsConfig(context);
      case ProviderFacet.M365MailboxForwarding:
        return yield* fetchMailboxForwarding(context);
      case ProviderFacet.M365InboxRules:
        return yield* fetchInboxRules(connector, context);
      default:
        throw new Error(`Unsupported M365 ingestion facet: ${type}`);
    }
  }
};

function createConnector(context: IngestionAdapterContext): M365Connector {
  const tenantId = getTenantId(context);
  const { clientId, clientSecret } = requireMicrosoftCredentials();
  return new M365Connector(clientId, clientSecret, tenantId);
}

function getTenantId(context: IngestionAdapterContext): string {
  const tenantId = context.linkMeta?.externalId;
  if (typeof tenantId === 'string' && tenantId.length > 0) return tenantId;
  throw new Error(`M365 tenant ID missing for link ${context.linkId}`);
}

async function getCapabilities(
  connector: M365Connector,
  context: IngestionAdapterContext
): Promise<Record<MSGraphCapabilities, boolean>> {
  const configured = context.linkMeta?.capabilities;
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    return configured as Record<MSGraphCapabilities, boolean>;
  }

  try {
    return (await new TenantCapabilityService(connector).probe(CAPABILITY_PLANS)) as Record<
      MSGraphCapabilities,
      boolean
    >;
  } catch (error) {
    logger.warn('Failed to probe M365 tenant capabilities', {
      linkId: context.linkId,
      error: serializeError(error)
    });
    return {} as Record<MSGraphCapabilities, boolean>;
  }
}

async function* fetchIdentities(
  connector: M365Connector,
  mode: SyncMode,
  cursor: string | undefined,
  capabilities: Record<MSGraphCapabilities, boolean>,
  context: IngestionAdapterContext
): AsyncGenerator<FetchPage, FetchResultCursor> {
  const fields = [...M365_IDENTITY_BASE_FIELDS];
  if (capabilities.signInActivity) fields.push('signInActivity');

  if (mode === 'full' || !cursor) {
    const users = (await connector.users.listAll(fields.join(','))) as Array<
      Record<string, unknown>
    >;
    const roleTemplateIdsByUserId = await fetchRoleTemplateIdsByUserId(connector, context);
    const records = users.map((user) => {
      const userId = typeof user.id === 'string' ? user.id : '';
      const roleTemplateIds = roleTemplateIdsByUserId.get(userId) ?? [];
      return {
        ...user,
        _role_template_ids: roleTemplateIds
      };
    });
    yield page(ProviderFacet.M365Identities, records);

    const cursorResult = await connector.users.delta(M365_IDENTITY_DELTA_FIELDS);
    return cursorResult.cursor;
  }

  const result = await connector.users.delta(M365_IDENTITY_DELTA_FIELDS, cursor);
  yield page(ProviderFacet.M365Identities, result.items);
  return result.cursor;
}

type M365RoleTemplateRow = {
  templateId: string;
};

async function fetchRoleTemplateIdsByUserId(
  connector: M365Connector,
  context: IngestionAdapterContext
): Promise<Map<string, string[]>> {
  const roleRows = await m365RoleTemplates(context);
  const roleTemplateIdsByUserId = new Map<string, string[]>();

  for (const role of roleRows) {
    let members: Array<{ id?: string }>;
    try {
      members = await connector.directoryRoles.members(role.templateId);
    } catch (error) {
      logger.warn('Failed to fetch M365 directory role members during ingestion', {
        roleTemplateId: role.templateId,
        error: serializeError(error)
      });
      continue;
    }

    for (const member of members) {
      if (!member.id) continue;
      const roleTemplateIds = roleTemplateIdsByUserId.get(member.id) ?? [];
      roleTemplateIds.push(role.templateId);
      roleTemplateIdsByUserId.set(member.id, roleTemplateIds);
    }
  }

  return roleTemplateIdsByUserId;
}

async function m365RoleTemplates(context: IngestionAdapterContext): Promise<M365RoleTemplateRow[]> {
  if (!context.tenantDb) return [];
  const db = context.tenantDb as any;
  return db.select({ templateId: m365Roles.templateId }).from(m365Roles);
}

async function* fetchGroups(connector: M365Connector): AsyncGenerator<FetchPage> {
  const groups = (await connector.groups.listAll(
    'id,displayName,description,groupTypes,mailEnabled,securityEnabled'
  )) as Array<Record<string, unknown>>;
  const records = await Promise.all(
    groups.map(async (group) => ({
      ...group,
      _member_ids: await groupMemberIds(connector, group)
    }))
  );
  yield page(ProviderFacet.M365Groups, records);
}

async function groupMemberIds(
  connector: M365Connector,
  group: Record<string, unknown>
): Promise<string[]> {
  if (typeof group.id !== 'string') return [];

  try {
    const members = await connector.groups.members(group.id);
    return members
      .map((member) => member.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch (error) {
    logger.warn('Failed to fetch M365 group members during ingestion', {
      groupId: group.id,
      error: serializeError(error)
    });
    return [];
  }
}

async function* fetchLicenses(connector: M365Connector): AsyncGenerator<FetchPage> {
  const [skus, skuNames] = await Promise.all([
    connector.subscribedSkus.listAll(),
    SkuCatalogService.resolve()
  ]);
  const records = skus
    .filter((sku) => {
      const record = sku as Record<string, unknown>;
      return typeof record.skuPartNumber === 'string'
        ? !M365_BLOAT_LICENSES.includes(record.skuPartNumber)
        : true;
    })
    .map((sku) => {
      const record = sku as Record<string, unknown>;
      const skuPartNumber =
        typeof record.skuPartNumber === 'string' ? record.skuPartNumber : undefined;
      return {
        ...record,
        _friendlyName: skuPartNumber ? (skuNames.get(skuPartNumber) ?? skuPartNumber) : record.skuId
      };
    });

  yield page(ProviderFacet.M365Licenses, records);
}

async function* fetchConditionalAccessPolicies(
  connector: M365Connector,
  context: IngestionAdapterContext,
  capabilities: Record<MSGraphCapabilities, boolean>
): AsyncGenerator<FetchPage> {
  if (!capabilities.conditionalAccess) {
    logger.warn('Skipping M365 CA policies because conditionalAccess capability is unavailable', {
      linkId: context.linkId
    });
    return;
  }

  const policies = await connector.conditionalAccess.policies();
  yield page(ProviderFacet.M365CAPolicies, policies);
}

async function* fetchDevices(connector: M365Connector): AsyncGenerator<FetchPage> {
  const select =
    'id,displayName,operatingSystem,operatingSystemVersion,isCompliant,isManaged,deviceOwnership,approximateLastSignInDateTime,registrationDateTime';
  const devices = await connector.devices.listAll(select);
  yield page(ProviderFacet.M365Devices, devices);
}

async function* fetchOAuthGrants(
  connector: M365Connector,
  context: IngestionAdapterContext
): AsyncGenerator<FetchPage> {
  const grants = (await connector.oauthGrants.listAll()) as Array<Record<string, unknown>>;
  const servicePrincipalIds = new Set<string>();

  for (const grant of grants) {
    if (typeof grant.clientId === 'string') servicePrincipalIds.add(grant.clientId);
    if (typeof grant.resourceId === 'string') servicePrincipalIds.add(grant.resourceId);
  }

  const displayNames = new Map<string, string>();
  if (servicePrincipalIds.size > 0) {
    try {
      const servicePrincipals = await connector.directoryObjects.getByIds(
        [...servicePrincipalIds],
        ['servicePrincipal']
      );
      for (const servicePrincipal of servicePrincipals) {
        displayNames.set(servicePrincipal.id, servicePrincipal.displayName ?? '');
      }
    } catch (error) {
      logger.warn('Failed to resolve M365 OAuth grant service principal display names', {
        linkId: context.linkId,
        error: serializeError(error)
      });
    }
  }

  yield page(
    ProviderFacet.M365OAuthGrants,
    grants.map((grant) => ({
      ...grant,
      clientDisplayName:
        typeof grant.clientId === 'string' ? (displayNames.get(grant.clientId) ?? null) : null,
      resourceDisplayName:
        typeof grant.resourceId === 'string' ? (displayNames.get(grant.resourceId) ?? null) : null
    }))
  );
}

async function* fetchRiskyUsers(
  connector: M365Connector,
  context: IngestionAdapterContext,
  capabilities: Record<MSGraphCapabilities, boolean>
): AsyncGenerator<FetchPage> {
  if (!capabilities.identityProtection) {
    logger.warn('Skipping M365 risky users because identityProtection capability is unavailable', {
      linkId: context.linkId
    });
    return;
  }

  try {
    const filter =
      "riskState ne 'none' and riskState ne 'confirmedSafe' and riskState ne 'remediated' and riskState ne 'dismissed'";
    const users = await connector.identityProtection.riskyUsers(filter);
    yield page(ProviderFacet.M365RiskyUsers, users);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('403')) {
      logger.warn('Skipping M365 risky users because IdentityRiskyUser.Read.All is unavailable', {
        linkId: context.linkId
      });
      return;
    }

    throw error;
  }
}

type PowerShellRequirements = {
  clientId: string;
  certPem: string;
  defaultDomain: string;
  gdapTenantId: string;
};

function requirePowerShellRequirements(
  context: IngestionAdapterContext,
  requiredRoles: string[],
  facetLabel: string
): PowerShellRequirements | null {
  const roles = Array.isArray(context.linkMeta?.roles)
    ? (context.linkMeta?.roles as unknown[]).filter(
        (role): role is string => typeof role === 'string'
      )
    : [];
  const hasRequiredRole = requiredRoles.some((role) => roles.includes(role));
  if (!hasRequiredRole) {
    logger.warn(`Skipping M365 ${facetLabel}: required directory role not assigned`, {
      linkId: context.linkId,
      requiredRoles,
      assignedRoles: roles
    });
    return null;
  }

  const clientId = env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    logger.warn(`Skipping M365 ${facetLabel}: MICROSOFT_CLIENT_ID not configured`, {
      linkId: context.linkId
    });
    return null;
  }

  const certPem = getMicrosoftCertPem();
  if (!certPem) {
    logger.warn(`Skipping M365 ${facetLabel}: MICROSOFT_CERT_PEM not configured`, {
      linkId: context.linkId
    });
    return null;
  }

  const gdapTenantId = getTenantId(context);
  const linkDefaultDomain = context.linkMeta?.defaultDomain;
  const defaultDomain =
    typeof linkDefaultDomain === 'string' && linkDefaultDomain.length > 0
      ? linkDefaultDomain
      : gdapTenantId;

  return { clientId, certPem, defaultDomain, gdapTenantId };
}

async function* fetchExchangeConfig(
  context: IngestionAdapterContext
): AsyncGenerator<FetchPage> {
  const requirements = requirePowerShellRequirements(
    context,
    ['Exchange Administrator'],
    'exchange_config'
  );
  if (!requirements) return;

  const result = await runExchangeOnlineFull(
    requirements.clientId,
    requirements.certPem,
    requirements.defaultDomain
  );
  if (result == null) return;

  yield {
    records: [{ externalId: 'org-config', op: 'upsert', payload: result }]
  };
}

async function* fetchDomainConfig(
  context: IngestionAdapterContext
): AsyncGenerator<FetchPage> {
  const requirements = requirePowerShellRequirements(
    context,
    ['Exchange Administrator'],
    'domain_config'
  );
  if (!requirements) return;

  const psResult = await runExchangeOnlineDomainConfig(
    requirements.clientId,
    requirements.certPem,
    requirements.defaultDomain
  );
  const psRecord = (psResult ?? {}) as Record<string, unknown>;

  const acceptedDomains: string[] = Array.isArray(psRecord.AcceptedDomains)
    ? (psRecord.AcceptedDomains as Array<Record<string, unknown>>)
        .map((domain) =>
          typeof domain.DomainName === 'string' ? domain.DomainName.toLowerCase() : ''
        )
        .filter(Boolean)
    : [];

  const dkimByDomain = new Map<string, Record<string, unknown>>();
  if (Array.isArray(psRecord.DkimConfigs)) {
    for (const dkim of psRecord.DkimConfigs as Array<Record<string, unknown>>) {
      if (typeof dkim.Domain === 'string') dkimByDomain.set(dkim.Domain.toLowerCase(), dkim);
    }
  }

  const dnsResults = await resolveDomainDns(acceptedDomains);

  const records: RawRecordEnvelope[] = acceptedDomains.map((domainName) => {
    const dkim = dkimByDomain.get(domainName);
    const dnsResult = dnsResults[domainName] ?? {};
    return {
      externalId: domainName,
      op: 'upsert',
      payload: {
        domainName,
        spfRecord: dnsResult.spfRecord ?? null,
        spfIsPermissive: dnsResult.spfIsPermissive ?? null,
        dmarcRecord: dnsResult.dmarcRecord ?? null,
        dmarcPolicy: dnsResult.dmarcPolicy ?? null,
        dkimEnabled: dkim ? ((dkim.Enabled as boolean | null) ?? null) : null,
        dkimSelector1Present: dkim ? Boolean(dkim.Selector1PublicKey) : null,
        dkimSelector2Present: dkim ? Boolean(dkim.Selector2PublicKey) : null
      }
    };
  });

  if (records.length > 0) yield { records };
}

async function* fetchTeamsConfig(context: IngestionAdapterContext): AsyncGenerator<FetchPage> {
  const requirements = requirePowerShellRequirements(
    context,
    ['Teams Administrator', 'Global Administrator'],
    'teams_config'
  );
  if (!requirements) return;

  const result = await runMicrosoftTeams(
    requirements.clientId,
    requirements.certPem,
    requirements.gdapTenantId
  );
  if (result == null) return;

  yield {
    records: [{ externalId: 'teams-config', op: 'upsert', payload: result }]
  };
}

async function* fetchMailboxForwarding(
  context: IngestionAdapterContext
): AsyncGenerator<FetchPage> {
  const requirements = requirePowerShellRequirements(
    context,
    ['Exchange Administrator'],
    'mailbox_forwarding'
  );
  if (!requirements) return;

  const result = await runMailboxForwardingFull(
    requirements.clientId,
    requirements.certPem,
    requirements.defaultDomain
  );
  const forwardingMailboxes = ((result as Record<string, unknown>)?.ForwardingMailboxes ??
    []) as Array<Record<string, unknown>>;
  if (forwardingMailboxes.length === 0) return;

  yield {
    records: forwardingMailboxes
      .filter((mailbox) => typeof mailbox.UserPrincipalName === 'string')
      .map((mailbox) => ({
        externalId: (mailbox.UserPrincipalName as string).toLowerCase(),
        op: 'upsert' as const,
        payload: mailbox
      }))
  };
}

async function* fetchInboxRules(
  connector: M365Connector,
  context: IngestionAdapterContext
): AsyncGenerator<FetchPage> {
  const requirements = requirePowerShellRequirements(
    context,
    ['Exchange Administrator'],
    'inbox_rules'
  );
  if (!requirements) return;

  let activeUpns: string[] = [];
  try {
    const allUsers = await connector.users.listForInboxRules();
    activeUpns = allUsers.filter((user) => user.accountEnabled).map((user) => user.userPrincipalName);
  } catch (error) {
    logger.warn('Failed to fetch UPN list for M365 inbox_rules; skipping', {
      linkId: context.linkId,
      error: serializeError(error)
    });
    return;
  }

  if (activeUpns.length === 0) {
    logger.warn('Skipping M365 inbox_rules: no active identities found', {
      linkId: context.linkId
    });
    return;
  }

  const totalBatches = Math.ceil(activeUpns.length / INBOX_RULES_BATCH_SIZE);
  logger.info('Starting M365 inbox_rules batched fetch', {
    linkId: context.linkId,
    users: activeUpns.length,
    batches: totalBatches
  });

  for (let i = 0; i < activeUpns.length; i += INBOX_RULES_BATCH_SIZE) {
    const batch = activeUpns.slice(i, i + INBOX_RULES_BATCH_SIZE);
    const batchNum = Math.floor(i / INBOX_RULES_BATCH_SIZE) + 1;

    let batchResult: unknown;
    try {
      batchResult = await runInboxRules(
        requirements.clientId,
        requirements.certPem,
        requirements.defaultDomain,
        batch
      );
    } catch (error) {
      logger.warn('M365 inbox_rules batch failed, continuing', {
        linkId: context.linkId,
        batch: batchNum,
        totalBatches,
        error: serializeError(error)
      });
      continue;
    }

    const rules = ((batchResult as Record<string, unknown>)?.InboxRules ?? []) as Array<
      Record<string, unknown>
    >;
    logger.info('M365 inbox_rules batch complete', {
      linkId: context.linkId,
      batch: batchNum,
      totalBatches,
      rules: rules.length
    });
    if (rules.length === 0) continue;

    yield {
      records: rules
        .filter(
          (rule) =>
            typeof rule.MailboxUserPrincipalName === 'string' &&
            (typeof rule.Identity === 'string' || typeof rule.Name === 'string')
        )
        .map((rule) => ({
          externalId: `${(rule.MailboxUserPrincipalName as string).toLowerCase()}::${
            (rule.Identity as string | undefined) ?? (rule.Name as string)
          }`,
          op: 'upsert' as const,
          payload: rule
        }))
    };
  }
}

type DnsResult = {
  spfRecord?: string;
  spfIsPermissive?: boolean;
  dmarcRecord?: string;
  dmarcPolicy?: string;
};

async function resolveDomainDns(domains: string[]): Promise<Record<string, DnsResult>> {
  const results: Record<string, DnsResult> = {};
  await Promise.all(
    domains.map(async (domain) => {
      const entry: DnsResult = {};
      try {
        const chunks = await dns.promises.resolveTxt(domain);
        const spf = chunks.map((chunk) => chunk.join('')).find((value) => value.startsWith('v=spf1'));
        if (spf) {
          entry.spfRecord = spf;
          entry.spfIsPermissive = !spf.includes('-all');
        }
      } catch {
        /* no SPF or DNS failure */
      }
      try {
        const chunks = await dns.promises.resolveTxt(`_dmarc.${domain}`);
        const dmarc = chunks
          .map((chunk) => chunk.join(''))
          .find((value) => value.startsWith('v=DMARC1'));
        if (dmarc) {
          entry.dmarcRecord = dmarc;
          const match = dmarc.match(/\bp=(\w+)/);
          entry.dmarcPolicy = match?.[1]?.toLowerCase();
        }
      } catch {
        /* no DMARC or DNS failure */
      }
      results[domain] = entry;
    })
  );
  return results;
}

function page(facet: ProviderFacet, records: unknown[]): FetchPage {
  return {
    records: records.map((record) => envelope(facet, record))
  };
}

function envelope(facet: ProviderFacet, record: unknown): RawRecordEnvelope {
  const raw = asRecord(record);
  const removed = raw['@removed'] != null;

  if (!removed) {
    const schema = getM365RawSchema(facet);
    if (schema) schema.parse(raw);
  }

  return {
    externalId: externalId(facet, raw),
    op: removed ? 'delete' : 'upsert',
    payload: raw
  };
}

function externalId(facet: ProviderFacet, record: Record<string, unknown>): string {
  if (facet === ProviderFacet.M365Licenses) return stringField(record, 'skuId');

  return stringField(record, 'id');
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`M365 record missing required string field ${key}`);
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('M365 record is not an object');
  }

  return value as Record<string, unknown>;
}
