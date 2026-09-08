import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { eq, and, count, sql, inArray, desc, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { TRPCError } from '@trpc/server';
import { M365Connector } from '@mspbyte/connectors';
import { generateM365Password } from '@mspbyte/capabilities';
import {
  customerLogs,
  findings,
  findingsWithContext,
  integrations,
  integrationLinks,
  sites,
  users,
  m365Identities,
  m365Groups,
  m365Policies,
  m365PolicyIdentities,
  m365PolicyGroups,
  m365PolicyRoles,
  m365Licenses,
  m365ExchangeConfigs,
  m365Devices,
  m365OAuthGrants,
  m365DomainConfig,
  m365TeamsConfig,
  m365RiskyUsers,
  m365MailboxForwarding,
  m365InboxRules,
  m365Roles,
  m365IdentityRoles,
  m365IdentityGroups,
  sophosEndpoints,
  sophosEndpointMigrations,
  sophosFirewalls,
  sophosFirewallLicenses,
  sophosLicenses,
  sophosTamperProtection,
  sophosEndpointsWithSite,
  sophosFirewallsWithSite,
  sophosLicensesWithSite,
  coveEndpointsWithSite,
  dattoEndpoints,
  coveEndpoints
} from '@mspbyte/drizzle';
import { Encryption, SophosConnector, CoveConnector, HaloPSAConnector, ActionLabels } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { loadGroupTargets } from './group-targets.js';

const VENDOR_TABLE_MAP = {
  m365_identities: m365Identities,
  m365_groups: m365Groups,
  m365_policies: m365Policies,
  m365_licenses: m365Licenses,
  m365_exchange_configs: m365ExchangeConfigs,
  m365_devices: m365Devices,
  m365_oauth_grants: m365OAuthGrants,
  m365_domain_config: m365DomainConfig,
  m365_teams_config: m365TeamsConfig,
  m365_risky_users: m365RiskyUsers,
  m365_mailbox_forwarding: m365MailboxForwarding,
  m365_inbox_rules: m365InboxRules,
  sophos_endpoints: sophosEndpoints,
  sophos_firewalls: sophosFirewalls,
  sophos_licenses: sophosLicenses,
  sophos_endpoints_with_site: sophosEndpointsWithSite,
  sophos_firewalls_with_site: sophosFirewallsWithSite,
  sophos_licenses_with_site: sophosLicensesWithSite,
  datto_endpoints: dattoEndpoints,
  cove_endpoints: coveEndpoints,
  cove_endpoints_with_site: coveEndpointsWithSite
} as const;

type VendorTableKey = keyof typeof VENDOR_TABLE_MAP;

const VENDOR_TABLE_SCOPE_COLUMNS: Record<
  VendorTableKey,
  { siteId: boolean; linkId: boolean }
> = {
  // Microsoft 365 identities are tenant resources. Individual rows may carry
  // an optional site association for enrichment, but tenant selection must
  // always be driven by link_id.
  m365_identities: { siteId: false, linkId: true },
  m365_groups: { siteId: false, linkId: true },
  m365_policies: { siteId: false, linkId: true },
  m365_licenses: { siteId: false, linkId: true },
  m365_exchange_configs: { siteId: false, linkId: true },
  m365_devices: { siteId: false, linkId: true },
  m365_oauth_grants: { siteId: false, linkId: true },
  m365_domain_config: { siteId: false, linkId: true },
  m365_teams_config: { siteId: false, linkId: true },
  m365_risky_users: { siteId: false, linkId: true },
  m365_mailbox_forwarding: { siteId: false, linkId: true },
  m365_inbox_rules: { siteId: false, linkId: true },
  sophos_endpoints: { siteId: true, linkId: true },
  sophos_firewalls: { siteId: true, linkId: true },
  sophos_licenses: { siteId: true, linkId: true },
  sophos_endpoints_with_site: { siteId: true, linkId: true },
  sophos_firewalls_with_site: { siteId: true, linkId: true },
  sophos_licenses_with_site: { siteId: true, linkId: true },
  datto_endpoints: { siteId: true, linkId: true },
  cove_endpoints: { siteId: true, linkId: true },
  cove_endpoints_with_site: { siteId: true, linkId: true }
};

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function normalizeColumnIdentifier(column: string): string | null {
  const normalized = camelToSnake(column);
  return /^[a-z][a-z0-9_]*$/.test(normalized) ? normalized : null;
}

function buildFilterCondition(
  column: string,
  operator: string,
  value: string | boolean | undefined
) {
  const normalizedColumn = normalizeColumnIdentifier(column);
  if (!normalizedColumn) return null;

  const col = sql.identifier(normalizedColumn);
  switch (operator) {
    case 'eq':
      return sql`${col} = ${value ?? null}`;
    case 'neq':
      return sql`${col} != ${value ?? null}`;
    case 'contains':
      return sql`${col} ilike ${'%' + (value ?? '') + '%'}`;
    case 'gt':
      return sql`${col} > ${value ?? null}`;
    case 'gte':
      return sql`${col} >= ${value ?? null}`;
    case 'lt':
      return sql`${col} < ${value ?? null}`;
    case 'lte':
      return sql`${col} <= ${value ?? null}`;
    case 'is_null':
      return sql`${col} is null`;
    case 'is_not_null':
      return sql`${col} is not null`;
    default:
      return null;
  }
}

const filterSchema = z.object({
  column: z.string(),
  operator: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null']),
  value: z.union([z.string(), z.boolean()]).optional()
});

const SophosConfigSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional()
});

const M365ConfigSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  tenantId: z.string().optional()
});

type SophosEndpointDeleteResult = {
  id: string;
  externalId: string;
  hostname: string;
  linkId: string;
  siteId: string | null;
  success: boolean;
  error?: string;
};

type SophosEndpointTamperProtectionResult = SophosEndpointDeleteResult & {
  skipped?: boolean;
};

type SophosEndpointUpgradeResult = SophosEndpointDeleteResult & {
  skipped?: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function authMethodType(method: Record<string, unknown>): string {
  const odataType = typeof method['@odata.type'] === 'string' ? method['@odata.type'] : '';
  const typeMap: Record<string, string> = {
    '#microsoft.graph.emailAuthenticationMethod': 'Email',
    '#microsoft.graph.fido2AuthenticationMethod': 'FIDO2',
    '#microsoft.graph.microsoftAuthenticatorAuthenticationMethod': 'Microsoft Authenticator',
    '#microsoft.graph.phoneAuthenticationMethod': 'Phone',
    '#microsoft.graph.softwareOathAuthenticationMethod': 'Software OATH',
    '#microsoft.graph.windowsHelloForBusinessAuthenticationMethod': 'Windows Hello',
    '#microsoft.graph.temporaryAccessPassAuthenticationMethod': 'Temporary Access Pass',
    '#microsoft.graph.passwordAuthenticationMethod': 'Password'
  };

  return typeMap[odataType] ?? 'Unknown';
}

// Maps a Graph auth-method @odata.type to the URL segment used by
// `/users/{id}/authentication/{segment}/{methodId}`. Returns null for the
// password method (which cannot be deleted) and unknown types.
function authMethodSegment(odataType: string): string | null {
  const segmentMap: Record<string, string> = {
    '#microsoft.graph.emailAuthenticationMethod': 'emailMethods',
    '#microsoft.graph.fido2AuthenticationMethod': 'fido2Methods',
    '#microsoft.graph.microsoftAuthenticatorAuthenticationMethod': 'microsoftAuthenticatorMethods',
    '#microsoft.graph.phoneAuthenticationMethod': 'phoneMethods',
    '#microsoft.graph.softwareOathAuthenticationMethod': 'softwareOathMethods',
    '#microsoft.graph.windowsHelloForBusinessAuthenticationMethod':
      'windowsHelloForBusinessMethods',
    '#microsoft.graph.temporaryAccessPassAuthenticationMethod': 'temporaryAccessPassMethods'
  };
  return segmentMap[odataType] ?? null;
}

const AUTH_METHOD_SEGMENTS = new Set([
  'emailMethods',
  'fido2Methods',
  'microsoftAuthenticatorMethods',
  'phoneMethods',
  'softwareOathMethods',
  'windowsHelloForBusinessMethods',
  'temporaryAccessPassMethods'
]);

function m365IdentityConnector(
  ctx: {
    encryptionKey?: string;
    microsoftCredentials?: { clientId: string; clientSecret: string } | null;
  },
  integrationConfig: unknown,
  tenantId: string
): M365Connector {
  const credentials = m365ClientCredentials(
    integrationConfig,
    ctx.microsoftCredentials,
    ctx.encryptionKey
  );
  if (!credentials) throw new Error('Microsoft 365 credentials are not configured');
  return new M365Connector(credentials.clientId, credentials.clientSecret, tenantId);
}

type M365IdentityRow = {
  id: string;
  linkId: string;
  siteId: string | null;
  externalId: string;
  name: string;
  email: string;
  enabled: boolean;
  tenantId: string | null;
  tenantName: string | null;
  integrationConfig: unknown;
};

type M365IdentityActionResult = {
  id: string;
  externalId: string;
  name: string;
  email: string;
  linkId: string;
  siteId: string | null;
  success: boolean;
  skipped?: boolean;
  error?: string;
};

async function loadM365IdentityRows(ctx: { db: any }, ids: string[]): Promise<M365IdentityRow[]> {
  const uniqueIds = [...new Set(ids)];
  return ctx.db
    .select({
      id: m365Identities.id,
      linkId: m365Identities.linkId,
      siteId: m365Identities.siteId,
      externalId: m365Identities.externalId,
      name: m365Identities.name,
      email: m365Identities.email,
      enabled: m365Identities.enabled,
      tenantId: integrationLinks.externalId,
      tenantName: integrationLinks.name,
      integrationConfig: integrations.config
    })
    .from(m365Identities)
    .innerJoin(integrationLinks, eq(m365Identities.linkId, integrationLinks.id))
    .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
    .where(
      and(
        inArray(m365Identities.id, uniqueIds),
        eq(integrationLinks.integrationId, 'microsoft-365')
      )
    );
}

function assertM365IdentityScope(
  ctx: { scopeFor: (p: any) => any },
  row: { siteId: string | null }
) {
  const scope = ctx.scopeFor('Vendors.Write');
  if (scope === 'all') return;
  if (!row.siteId || !scope.includes(row.siteId)) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'M365 identity not found' });
  }
}

async function runM365IdentityAction(
  ctx: any,
  ids: string[],
  opts: {
    actionLabel: ActionLabels;
    auditAction: 'update' | 'delete';
    skipIf?: (row: M365IdentityRow) => boolean;
    auditMetadata?: (row: M365IdentityRow) => Record<string, unknown>;
    run: (connector: M365Connector, row: M365IdentityRow) => Promise<void>;
  }
): Promise<{
  batchId: string;
  requested: number;
  found: number;
  updated: number;
  skipped: number;
  failed: number;
  result: 'success' | 'failure' | 'partial';
  results: M365IdentityActionResult[];
}> {
  const uniqueIds = [...new Set(ids)];
  const rows = await loadM365IdentityRows(ctx, uniqueIds);

  if (rows.length === 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No M365 identities found' });
  }

  const scope = ctx.scopeFor('Vendors.Write');
  const scoped = scope === 'all' ? rows : rows.filter((r) => r.siteId && scope.includes(r.siteId));

  const batchId = randomUUID();
  const results: M365IdentityActionResult[] = [];
  const connectorCache = new Map<string, M365Connector>();

  for (const row of scoped) {
    if (opts.skipIf?.(row)) {
      results.push({
        id: row.id,
        externalId: row.externalId,
        name: row.name,
        email: row.email,
        linkId: row.linkId,
        siteId: row.siteId,
        success: true,
        skipped: true
      });
      continue;
    }

    let success = false;
    let error: string | undefined;

    try {
      if (!row.tenantId) throw new Error('M365 tenant id is missing');
      let connector = connectorCache.get(row.linkId);
      if (!connector) {
        connector = m365IdentityConnector(ctx, row.integrationConfig, row.tenantId);
        connectorCache.set(row.linkId, connector);
      }
      await opts.run(connector, row);
      success = true;
    } catch (err) {
      error = errorMessage(err);
    }

    results.push({
      id: row.id,
      externalId: row.externalId,
      name: row.name,
      email: row.email,
      linkId: row.linkId,
      siteId: row.siteId,
      success,
      error
    });

    await ctx.db.insert(customerLogs).values({
      siteId: row.siteId,
      actorType: 'user',
      actorId: ctx.user.id,
      actorLabel: ctx.user.name || ctx.user.email,
      action: opts.auditAction,
      actionLabel: opts.actionLabel,
      targetType: 'm365_identity',
      targetId: row.id,
      targetLabel: row.email || row.name,
      result: success ? 'success' : 'failure',
      errorMessage: error,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        batchId,
        vendor: 'microsoft-365',
        externalId: row.externalId,
        linkId: row.linkId,
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        ...(opts.auditMetadata?.(row) ?? {})
      }
    });
  }

  const updated = results.filter((r) => r.success && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    batchId,
    requested: uniqueIds.length,
    found: scoped.length,
    updated,
    skipped,
    failed,
    result: failed === 0 ? 'success' : updated === 0 ? 'failure' : 'partial',
    results
  };
}

function m365ClientCredentials(
  config: unknown,
  envCredentials?: { clientId: string; clientSecret: string } | null,
  encryptionKey?: string
): { clientId: string; clientSecret: string } | null {
  const parsed = M365ConfigSchema.safeParse(config);
  const clientId =
    parsed.success && parsed.data.clientId
      ? parsed.data.clientId
      : (envCredentials?.clientId ?? process.env.MICROSOFT_CLIENT_ID);
  const encryptedSecret = parsed.success ? parsed.data.clientSecret : undefined;
  const clientSecret = encryptedSecret
    ? (Encryption.decrypt(encryptedSecret, encryptionKey ?? process.env.ENCRYPTION_KEY ?? '') ??
      envCredentials?.clientSecret ??
      process.env.MICROSOFT_CLIENT_SECRET)
    : (envCredentials?.clientSecret ?? process.env.MICROSOFT_CLIENT_SECRET);

  if (!clientId || !clientSecret) return null;

  return { clientId, clientSecret };
}

type M365PairResult = {
  identityId: string;
  identityLabel: string;
  relationId: string;
  relationLabel: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
};

type M365PairResponse = {
  batchId: string;
  requested: number;
  found: number;
  updated: number;
  skipped: number;
  failed: number;
  result: 'success' | 'failure' | 'partial';
  results: M365PairResult[];
};

async function loadM365GroupRowsById(ctx: any, ids: string[]) {
  return ctx.db
    .select({
      id: m365Groups.id,
      linkId: m365Groups.linkId,
      externalId: m365Groups.externalId,
      name: m365Groups.name
    })
    .from(m365Groups)
    .where(inArray(m365Groups.id, [...new Set(ids)]));
}

async function loadM365LicenseRowsById(ctx: any, ids: string[]) {
  return ctx.db
    .select({
      id: m365Licenses.id,
      linkId: m365Licenses.linkId,
      skuId: m365Licenses.skuId,
      skuPartNumber: m365Licenses.skuPartNumber,
      friendlyName: m365Licenses.friendlyName,
      totalUnits: m365Licenses.totalUnits,
      consumedUnits: m365Licenses.consumedUnits
    })
    .from(m365Licenses)
    .where(
      and(inArray(m365Licenses.id, [...new Set(ids)]), eq(m365Licenses.isBloat, false))
    );
}

async function loadM365RoleRowsById(ctx: any, ids: string[]) {
  return ctx.db
    .select({
      id: m365Roles.id,
      templateId: m365Roles.templateId,
      name: m365Roles.name
    })
    .from(m365Roles)
    .where(inArray(m365Roles.id, [...new Set(ids)]));
}

function summarizeResults(results: M365PairResult[]): {
  updated: number;
  skipped: number;
  failed: number;
  result: 'success' | 'failure' | 'partial';
} {
  const updated = results.filter((r) => r.success && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.success).length;
  return {
    updated,
    skipped,
    failed,
    result: failed === 0 ? 'success' : updated === 0 ? 'failure' : 'partial'
  };
}

async function auditPair(
  ctx: any,
  batchId: string,
  actionLabel: ActionLabels,
  auditAction: 'update' | 'delete',
  identity: M365IdentityRow,
  relationType: 'group' | 'license' | 'role',
  relationId: string,
  relationExternalId: string,
  relationLabel: string,
  direction: 'add' | 'remove',
  success: boolean,
  error?: string
) {
  await ctx.db.insert(customerLogs).values({
    siteId: identity.siteId,
    actorType: 'user',
    actorId: ctx.user.id,
    actorLabel: ctx.user.name || ctx.user.email,
    action: auditAction,
    actionLabel,
    targetType: 'm365_identity',
    targetId: identity.id,
    targetLabel: identity.email || identity.name,
    result: success ? 'success' : 'failure',
    errorMessage: error,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      batchId,
      vendor: 'microsoft-365',
      externalId: identity.externalId,
      linkId: identity.linkId,
      tenantId: identity.tenantId,
      tenantName: identity.tenantName,
      relationType,
      relationId,
      relationExternalId,
      relationLabel,
      direction
    }
  });
}

async function runM365GroupPairAction(
  ctx: any,
  identityIds: string[],
  groupIds: string[],
  direction: 'add' | 'remove'
): Promise<M365PairResponse> {
  const [identityRows, groupRows] = await Promise.all([
    loadM365IdentityRows(ctx, identityIds),
    loadM365GroupRowsById(ctx, groupIds)
  ]);
  const scope = ctx.scopeFor('Vendors.Write');
  const scopedIdentities =
    scope === 'all'
      ? identityRows
      : identityRows.filter((r) => r.siteId && scope.includes(r.siteId));

  if (scopedIdentities.length === 0 || groupRows.length === 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No matching identities or groups found' });
  }

  const batchId = randomUUID();
  const results: M365PairResult[] = [];
  const actionLabel =
    direction === 'add' ? ActionLabels.M365IdentityGroupAdd : ActionLabels.M365IdentityGroupRemove;
  const auditAction: 'update' | 'delete' = direction === 'add' ? 'update' : 'delete';
  const connectorCache = new Map<string, M365Connector>();
  const changed: Array<{ identityId: string; groupId: string; linkId: string }> = [];

  for (const identity of scopedIdentities) {
    for (const group of groupRows) {
      if (group.linkId !== identity.linkId) {
        results.push({
          identityId: identity.id,
          identityLabel: identity.email || identity.name,
          relationId: group.id,
          relationLabel: group.name,
          success: false,
          error: 'Group belongs to a different tenant'
        });
        continue;
      }

      let success = false;
      let error: string | undefined;

      try {
        if (!identity.tenantId) throw new Error('M365 tenant id is missing');
        let connector = connectorCache.get(identity.linkId);
        if (!connector) {
          connector = m365IdentityConnector(ctx, identity.integrationConfig, identity.tenantId);
          connectorCache.set(identity.linkId, connector);
        }
        if (direction === 'add') {
          await connector.groups.addMember(group.externalId, identity.externalId);
        } else {
          await connector.groups.removeMember(group.externalId, identity.externalId);
        }
        success = true;
      } catch (err) {
        error = errorMessage(err);
      }

      results.push({
        identityId: identity.id,
        identityLabel: identity.email || identity.name,
        relationId: group.id,
        relationLabel: group.name,
        success,
        error
      });

      if (success) changed.push({ identityId: identity.id, groupId: group.id, linkId: group.linkId });

      await auditPair(
        ctx,
        batchId,
        actionLabel,
        auditAction,
        identity,
        'group',
        group.id,
        group.externalId,
        group.name,
        direction,
        success,
        error
      );
    }
  }

  if (changed.length > 0) {
    if (direction === 'add') {
      await ctx.db
        .insert(m365IdentityGroups)
        .values(changed.map((c) => ({ identityId: c.identityId, groupId: c.groupId, linkId: c.linkId })))
        .onConflictDoNothing();
    } else {
      for (const c of changed) {
        await ctx.db
          .delete(m365IdentityGroups)
          .where(
            and(
              eq(m365IdentityGroups.identityId, c.identityId),
              eq(m365IdentityGroups.groupId, c.groupId)
            )
          );
      }
    }
  }

  const summary = summarizeResults(results);
  return {
    batchId,
    requested: identityIds.length * groupIds.length,
    found: scopedIdentities.length * groupRows.length,
    ...summary,
    results
  };
}

async function runM365LicensePairAction(
  ctx: any,
  identityIds: string[],
  licenseIds: string[],
  direction: 'add' | 'remove'
): Promise<M365PairResponse> {
  const [identityRows, licenseRows] = await Promise.all([
    loadM365IdentityRows(ctx, identityIds),
    loadM365LicenseRowsById(ctx, licenseIds)
  ]);
  const scope = ctx.scopeFor('Vendors.Write');
  const scopedIdentities =
    scope === 'all'
      ? identityRows
      : identityRows.filter((r) => r.siteId && scope.includes(r.siteId));

  if (scopedIdentities.length === 0 || licenseRows.length === 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No matching identities or licenses found' });
  }

  const batchId = randomUUID();
  const results: M365PairResult[] = [];
  const actionLabel =
    direction === 'add'
      ? ActionLabels.M365IdentityLicenseAdd
      : ActionLabels.M365IdentityLicenseRemove;
  const auditAction: 'update' | 'delete' = direction === 'add' ? 'update' : 'delete';
  const connectorCache = new Map<string, M365Connector>();

  // Live availability check per (link,sku). Fetched lazily on first use per link.
  const availabilityByLink = new Map<string, Map<string, { enabled: number; consumed: number }>>();
  async function getAvailability(link: string, connector: M365Connector) {
    let map = availabilityByLink.get(link);
    if (!map) {
      map = new Map();
      try {
        const skus = await connector.subscribedSkus.listAll();
        for (const sku of skus) {
          map.set(sku.skuId, {
            enabled: sku.prepaidUnits?.enabled ?? 0,
            consumed: sku.consumedUnits ?? 0
          });
        }
      } catch {
        // Fall through — no live data means we skip pre-check.
      }
      availabilityByLink.set(link, map);
    }
    return map;
  }

  // Track skuIds per (link, identity) so we can also refresh assignedLicenses.
  const perIdentityDelta = new Map<string, { added: Set<string>; removed: Set<string> }>();
  function deltaFor(identityId: string) {
    let d = perIdentityDelta.get(identityId);
    if (!d) {
      d = { added: new Set(), removed: new Set() };
      perIdentityDelta.set(identityId, d);
    }
    return d;
  }

  for (const identity of scopedIdentities) {
    for (const license of licenseRows) {
      if (license.linkId !== identity.linkId) {
        results.push({
          identityId: identity.id,
          identityLabel: identity.email || identity.name,
          relationId: license.id,
          relationLabel: license.friendlyName || license.skuPartNumber,
          success: false,
          error: 'License belongs to a different tenant'
        });
        continue;
      }

      let success = false;
      let error: string | undefined;
      let skipped = false;

      try {
        if (!identity.tenantId) throw new Error('M365 tenant id is missing');
        let connector = connectorCache.get(identity.linkId);
        if (!connector) {
          connector = m365IdentityConnector(ctx, identity.integrationConfig, identity.tenantId);
          connectorCache.set(identity.linkId, connector);
        }

        if (direction === 'add') {
          const avail = await getAvailability(identity.linkId, connector);
          const live = avail.get(license.skuId);
          if (live && live.enabled - live.consumed <= 0) {
            throw new Error(
              `No available units for ${license.skuPartNumber} (${live.consumed}/${live.enabled})`
            );
          }
          await connector.users_licenses.modify(identity.externalId, [license.skuId], []);
          // Optimistically bump consumed so the next pair sees updated availability.
          if (live) live.consumed += 1;
        } else {
          await connector.users_licenses.modify(identity.externalId, [], [license.skuId]);
          const avail = availabilityByLink.get(identity.linkId);
          const live = avail?.get(license.skuId);
          if (live && live.consumed > 0) live.consumed -= 1;
        }
        success = true;
      } catch (err) {
        error = errorMessage(err);
      }

      results.push({
        identityId: identity.id,
        identityLabel: identity.email || identity.name,
        relationId: license.id,
        relationLabel: license.friendlyName || license.skuPartNumber,
        success,
        skipped,
        error
      });

      if (success && !skipped) {
        const delta = deltaFor(identity.id);
        if (direction === 'add') delta.added.add(license.skuId);
        else delta.removed.add(license.skuId);
      }

      await auditPair(
        ctx,
        batchId,
        actionLabel,
        auditAction,
        identity,
        'license',
        license.id,
        license.skuId,
        license.friendlyName || license.skuPartNumber,
        direction,
        success,
        error
      );
    }
  }

  // Refresh m365_identities.assigned_licenses and m365_licenses.consumed_units.
  if (perIdentityDelta.size > 0) {
    const identityMap = new Map(scopedIdentities.map((i) => [i.id, i]));
    for (const [identityId, delta] of perIdentityDelta.entries()) {
      const identity = identityMap.get(identityId);
      if (!identity) continue;
      const [row] = await ctx.db
        .select({ assignedLicenses: m365Identities.assignedLicenses })
        .from(m365Identities)
        .where(eq(m365Identities.id, identityId))
        .limit(1);
      const current = new Set<string>(row?.assignedLicenses ?? []);
      for (const s of delta.added) current.add(s);
      for (const s of delta.removed) current.delete(s);
      await ctx.db
        .update(m365Identities)
        .set({ assignedLicenses: [...current], updatedAt: new Date().toISOString() })
        .where(eq(m365Identities.id, identityId));
    }

    // Sync consumedUnits from live availability where we fetched it.
    for (const [linkId, avail] of availabilityByLink.entries()) {
      for (const license of licenseRows) {
        if (license.linkId !== linkId) continue;
        const live = avail.get(license.skuId);
        if (!live) continue;
        await ctx.db
          .update(m365Licenses)
          .set({
            consumedUnits: live.consumed,
            totalUnits: live.enabled,
            updatedAt: new Date().toISOString()
          })
          .where(eq(m365Licenses.id, license.id));
      }
    }
  }

  const summary = summarizeResults(results);
  return {
    batchId,
    requested: identityIds.length * licenseIds.length,
    found: scopedIdentities.length * licenseRows.length,
    ...summary,
    results
  };
}

async function runM365RolePairAction(
  ctx: any,
  identityIds: string[],
  roleIds: string[],
  direction: 'add' | 'remove'
): Promise<M365PairResponse> {
  const [identityRows, roleRows] = await Promise.all([
    loadM365IdentityRows(ctx, identityIds),
    loadM365RoleRowsById(ctx, roleIds)
  ]);
  const scope = ctx.scopeFor('Vendors.Write');
  const scopedIdentities =
    scope === 'all'
      ? identityRows
      : identityRows.filter((r) => r.siteId && scope.includes(r.siteId));

  if (scopedIdentities.length === 0 || roleRows.length === 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No matching identities or roles found' });
  }

  const batchId = randomUUID();
  const results: M365PairResult[] = [];
  const actionLabel =
    direction === 'add' ? ActionLabels.M365IdentityRoleAdd : ActionLabels.M365IdentityRoleRemove;
  const auditAction: 'update' | 'delete' = direction === 'add' ? 'update' : 'delete';
  const connectorCache = new Map<string, M365Connector>();
  const changed: Array<{ identityId: string; roleId: string; linkId: string }> = [];

  for (const identity of scopedIdentities) {
    for (const role of roleRows) {
      let success = false;
      let error: string | undefined;

      try {
        if (!identity.tenantId) throw new Error('M365 tenant id is missing');
        let connector = connectorCache.get(identity.linkId);
        if (!connector) {
          connector = m365IdentityConnector(ctx, identity.integrationConfig, identity.tenantId);
          connectorCache.set(identity.linkId, connector);
        }
        if (direction === 'add') {
          await connector.roleManagement.directory.roleAssignments.create(
            identity.externalId,
            role.templateId
          );
        } else {
          const assignments = await connector.roleManagement.directory.roleAssignments.list({
            principalId: identity.externalId,
            roleDefinitionId: role.templateId
          });
          for (const a of assignments) {
            await connector.roleManagement.directory.roleAssignments.delete(a.id);
          }
        }
        success = true;
      } catch (err) {
        error = errorMessage(err);
      }

      results.push({
        identityId: identity.id,
        identityLabel: identity.email || identity.name,
        relationId: role.id,
        relationLabel: role.name,
        success,
        error
      });

      if (success) changed.push({ identityId: identity.id, roleId: role.id, linkId: identity.linkId });

      await auditPair(
        ctx,
        batchId,
        actionLabel,
        auditAction,
        identity,
        'role',
        role.id,
        role.templateId,
        role.name,
        direction,
        success,
        error
      );
    }
  }

  if (changed.length > 0) {
    if (direction === 'add') {
      await ctx.db
        .insert(m365IdentityRoles)
        .values(changed.map((c) => ({ identityId: c.identityId, roleId: c.roleId, linkId: c.linkId })))
        .onConflictDoNothing();
    } else {
      for (const c of changed) {
        await ctx.db
          .delete(m365IdentityRoles)
          .where(
            and(
              eq(m365IdentityRoles.identityId, c.identityId),
              eq(m365IdentityRoles.roleId, c.roleId)
            )
          );
      }
    }
  }

  const summary = summarizeResults(results);
  return {
    batchId,
    requested: identityIds.length * roleIds.length,
    found: scopedIdentities.length * roleRows.length,
    ...summary,
    results
  };
}

async function toggleSophosEndpointTamperProtection(
  ctx: Context,
  ids: string[],
  enable: boolean
) {
  const uniqueIds = [...new Set(ids)];
  const rows = await ctx.db
    .select({
      id: sophosEndpoints.id,
      linkId: sophosEndpoints.linkId,
      siteId: sophosEndpoints.siteId,
      externalId: sophosEndpoints.externalId,
      hostname: sophosEndpoints.hostname,
      tamperProtectionEnabled: sophosEndpoints.tamperProtectionEnabled,
      tenantId: integrationLinks.externalId,
      tenantName: integrationLinks.name,
      linkMeta: integrationLinks.meta,
      integrationConfig: integrations.config
    })
    .from(sophosEndpoints)
    .innerJoin(integrationLinks, eq(sophosEndpoints.linkId, integrationLinks.id))
    .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
    .where(
      and(
        inArray(sophosEndpoints.id, uniqueIds),
        eq(integrationLinks.integrationId, 'sophos-partner')
      )
    );

  if (rows.length === 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No Sophos endpoints found' });
  }

  const batchId = randomUUID();
  const results: SophosEndpointTamperProtectionResult[] = [];
  const actionLabel = enable
    ? ActionLabels.SophosEndpointTamperEnable
    : ActionLabels.SophosEndpointTamperDisable;

  for (const row of rows) {
    if (row.tamperProtectionEnabled === enable) {
      results.push({
        id: row.id,
        externalId: row.externalId,
        hostname: row.hostname,
        linkId: row.linkId,
        siteId: row.siteId,
        success: true,
        skipped: true
      });
      continue;
    }

    const config = SophosConfigSchema.safeParse(row.integrationConfig);
    const apiHost =
      row.linkMeta && typeof row.linkMeta === 'object' && !Array.isArray(row.linkMeta)
        ? (row.linkMeta as Record<string, unknown>).apiHost
        : undefined;

    let success = false;
    let error: string | undefined;

    try {
      if (!config.success || !config.data.clientId || !config.data.clientSecret) {
        throw new Error('Sophos integration credentials are missing');
      }
      if (!row.tenantId) throw new Error('Sophos tenant id is missing');
      if (typeof apiHost !== 'string' || !apiHost) throw new Error('Sophos API host is missing');

      const encryptionKey = ctx.encryptionKey ?? process.env.ENCRYPTION_KEY;
      if (!encryptionKey) throw new Error('Encryption key is not configured');

      const clientSecret = Encryption.decrypt(config.data.clientSecret, encryptionKey);
      if (!clientSecret) throw new Error('Sophos client secret could not be decrypted');

      const connector = new SophosConnector(config.data.clientId, clientSecret);
      await connector.endpoint.tamperProtection.toggle(apiHost, row.tenantId, row.externalId, enable);
      success = true;
    } catch (err) {
      error = errorMessage(err);
    }

    results.push({
      id: row.id,
      externalId: row.externalId,
      hostname: row.hostname,
      linkId: row.linkId,
      siteId: row.siteId,
      success,
      error
    });

    await ctx.db.insert(customerLogs).values({
      siteId: row.siteId,
      actorType: 'user',
      actorId: ctx.user.id,
      actorLabel: ctx.user.name || ctx.user.email,
      action: 'update',
      actionLabel,
      targetType: 'sophos_endpoint',
      targetId: row.id,
      targetLabel: row.hostname,
      result: success ? 'success' : 'failure',
      errorMessage: error,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        batchId,
        vendor: 'sophos',
        field: 'tamperProtectionEnabled',
        previousValue: !enable,
        newValue: enable,
        externalId: row.externalId,
        linkId: row.linkId,
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        apiHost: typeof apiHost === 'string' ? apiHost : null
      }
    });
  }

  const updatedIds = results
    .filter((result) => result.success && !result.skipped)
    .map((result) => result.id);
  if (updatedIds.length > 0) {
    await ctx.db
      .update(sophosEndpoints)
      .set({ tamperProtectionEnabled: enable, updatedAt: new Date().toISOString() })
      .where(inArray(sophosEndpoints.id, updatedIds));
  }

  const updated = updatedIds.length;
  const skipped = results.filter((result) => result.skipped).length;
  const failed = results.filter((result) => !result.success).length;
  return {
    batchId,
    requested: uniqueIds.length,
    found: rows.length,
    updated,
    skipped,
    failed,
    result: failed === 0 ? 'success' : updated === 0 ? 'failure' : 'partial',
    results
  };
}

export const vendorRouter = t.router({
  sophosFirewallLicenses: authProcedure
    .input(z.object({ firewallId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Read permission required' });
      }

      // License pulls run at the partner level, so their integration link can
      // differ from the firewall's. Authorize access to the firewall first,
      // then use its serial number as the licensing identity.
      const [firewall] = await ctx.db
        .select({
          siteId: sophosFirewalls.siteId,
          linkId: sophosFirewalls.linkId,
          serialNumber: sophosFirewalls.serialNumber
        })
        .from(sophosFirewalls)
        .where(eq(sophosFirewalls.id, input.firewallId))
        .limit(1);

      if (!firewall) return null;

      const siteScope = ctx.scopeFor('Vendors.Read');
      const linkScope = ctx.linkScopeFor('Vendors.Read');
      const hasSiteAccess =
        siteScope === 'all'
          ? firewall.siteId !== null
          : firewall.siteId !== null && siteScope.includes(firewall.siteId);
      const hasLinkAccess = linkScope === 'all' || linkScope.includes(firewall.linkId);
      if (!hasSiteAccess && !hasLinkAccess) throw new TRPCError({ code: 'NOT_FOUND' });

      const licenseRows = await ctx.db
        .select({
          id: sophosFirewallLicenses.id,
          licenseIdentifier: sophosFirewallLicenses.licenseIdentifier,
          productName: sophosFirewallLicenses.productName,
          productCode: sophosFirewallLicenses.productCode,
          productGenericCode: sophosFirewallLicenses.productGenericCode,
          type: sophosFirewallLicenses.type,
          perpetual: sophosFirewallLicenses.perpetual,
          quantity: sophosFirewallLicenses.quantity,
          usageCount: sophosFirewallLicenses.usageCount,
          usageDate: sophosFirewallLicenses.usageDate,
          usageCollectedAt: sophosFirewallLicenses.usageCollectedAt,
          startedAt: sophosFirewallLicenses.startedAt,
          endsAt: sophosFirewallLicenses.endsAt
        })
        .from(sophosFirewallLicenses)
        .where(eq(sophosFirewallLicenses.serialNumber, firewall.serialNumber))
        .orderBy(sophosFirewallLicenses.productName);

      return licenseRows;
    }),

  tableData: authProcedure
    .input(
      z.object({
        table: z.string(),
        linkId: z.uuid().optional(),
        groupId: z.uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(1000).default(25),
        sortColumn: z.string().optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
        filters: z.array(filterSchema).optional(),
        globalSearch: z.string().optional(),
        globalSearchColumns: z.array(z.string()).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Read permission required' });
      }
      if (!(input.table in VENDOR_TABLE_MAP)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unknown vendor table: ${input.table}`
        });
      }

      const tableKey = input.table as VendorTableKey;
      const table = VENDOR_TABLE_MAP[tableKey] as any;
      const scopeColumns = VENDOR_TABLE_SCOPE_COLUMNS[tableKey];
      const offset = (input.page - 1) * input.pageSize;

      // Build base filter: explicit link/site scope can be further narrowed by group.
      const baseConditions: ReturnType<typeof sql>[] = [];
      if (tableKey === 'm365_licenses') {
        baseConditions.push(eq(m365Licenses.isBloat, false));
      }
      if (input.linkId) {
        baseConditions.push(sql`${sql.identifier('link_id')} = ${input.linkId}`);
      }
      if (input.groupId) {
        const targets = await loadGroupTargets(ctx.db, input.groupId);
        if (targets.siteIds.length === 0 && targets.linkIds.length === 0) {
          return {
            rows: [] as unknown[],
            total: 0,
            page: input.page,
            pageSize: input.pageSize,
            pageCount: 0
          };
        }
        const groupParts: ReturnType<typeof sql>[] = [];
        if (scopeColumns.siteId && targets.siteIds.length > 0) {
          const siteParams = sql.join(
            targets.siteIds.map((id) => sql`${id}::uuid`),
            sql`, `
          );
          groupParts.push(sql`${sql.identifier('site_id')} IN (${siteParams})`);
        }
        if (scopeColumns.linkId && targets.linkIds.length > 0) {
          const linkParams = sql.join(
            targets.linkIds.map((id) => sql`${id}::uuid`),
            sql`, `
          );
          groupParts.push(sql`${sql.identifier('link_id')} IN (${linkParams})`);
        }
        if (groupParts.length === 0) {
          return {
            rows: [] as unknown[],
            total: 0,
            page: input.page,
            pageSize: input.pageSize,
            pageCount: 0
          };
        }
        baseConditions.push(
          groupParts.length === 1 ? groupParts[0]! : sql`(${groupParts.reduce((acc, c) => sql`${acc} or ${c}`)})`
        );
      }

      const siteScope = ctx.scopeFor('Vendors.Read');
      const linkScope = ctx.linkScopeFor('Vendors.Read');
      if (siteScope !== 'all' || linkScope !== 'all') {
        if (
          siteScope !== 'all' &&
          linkScope !== 'all' &&
          siteScope.length === 0 &&
          linkScope.length === 0
        ) {
          return {
            rows: [] as unknown[],
            total: 0,
            page: input.page,
            pageSize: input.pageSize,
            pageCount: 0
          };
        }
        const scopeParts: ReturnType<typeof sql>[] = [];
        if (scopeColumns.siteId && siteScope === 'all') {
          scopeParts.push(sql`${sql.identifier('site_id')} is not null`);
        } else if (scopeColumns.siteId && siteScope !== 'all' && siteScope.length > 0) {
          const siteParams = sql.join(
            siteScope.map((id) => sql`${id}::uuid`),
            sql`, `
          );
          scopeParts.push(sql`${sql.identifier('site_id')} IN (${siteParams})`);
        }
        if (scopeColumns.linkId && linkScope === 'all') {
          scopeParts.push(sql`${sql.identifier('link_id')} is not null`);
        } else if (scopeColumns.linkId && linkScope !== 'all' && linkScope.length > 0) {
          const linkParams = sql.join(
            linkScope.map((id) => sql`${id}::uuid`),
            sql`, `
          );
          scopeParts.push(sql`${sql.identifier('link_id')} IN (${linkParams})`);
        }
        if (scopeParts.length > 0) {
          baseConditions.push(
            scopeParts.length === 1 ? scopeParts[0]! : sql`(${scopeParts.reduce((acc, c) => sql`${acc} or ${c}`)})`
          );
        }
      }

      // Apply user-supplied filters
      const userConditions: ReturnType<typeof sql>[] = [];
      for (const f of input.filters ?? []) {
        const cond = buildFilterCondition(f.column, f.operator, f.value);
        if (cond) userConditions.push(cond);
      }

      // Apply global search as OR across specified columns
      const globalSearchConditions: ReturnType<typeof sql>[] = [];
      if (input.globalSearch && input.globalSearchColumns?.length) {
        const term = '%' + input.globalSearch + '%';
        const orParts = input.globalSearchColumns
          .map(camelToSnake)
          .filter((col) => /^[a-z][a-z0-9_]*$/.test(col))
          .map((col) => sql`${sql.identifier(col)} ilike ${term}`);
        if (orParts.length > 0) {
          const orClause = orParts.reduce((acc, c) => sql`${acc} or ${c}`);
          globalSearchConditions.push(sql`(${orClause})`);
        }
      }

      const allConditions = [...baseConditions, ...userConditions, ...globalSearchConditions];
      const whereClause =
        allConditions.length > 0
          ? sql`${allConditions.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} and ${c}`))}`
          : undefined;

      // Sort
      let orderClause: ReturnType<typeof sql> | undefined;
      const sortColumn = input.sortColumn ? normalizeColumnIdentifier(input.sortColumn) : null;
      if (sortColumn) {
        const colId = sql.identifier(sortColumn);
        orderClause =
          input.sortDirection === 'desc'
            ? sql`${colId} desc nulls last`
            : sql`${colId} asc nulls first`;
      } else if ('createdAt' in table) {
        orderClause = sql`${sql.identifier('created_at')} desc`;
      }

      const baseQuery = ctx.db.select().from(table).where(whereClause);
      const sortedQuery = orderClause ? baseQuery.orderBy(orderClause) : baseQuery;

      const [rows, [countRow]] = await Promise.all([
        sortedQuery.limit(input.pageSize).offset(offset),
        ctx.db.select({ count: count() }).from(table).where(whereClause)
      ]);

      const total = Number(countRow?.count ?? 0);
      const pageCount = Math.ceil(total / input.pageSize);

      return {
        rows: rows as Record<string, unknown>[],
        total,
        page: input.page,
        pageSize: input.pageSize,
        pageCount
      };
    }),

  sophosEndpointTamperProtection: authProcedure
    .input(z.object({ endpointId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Read permission required' });
      }

      const [row] = await ctx.db
        .select({
          id: sophosTamperProtection.id,
          endpointId: sophosTamperProtection.endpointId,
          linkId: sophosTamperProtection.linkId,
          siteId: sophosTamperProtection.siteId,
          password: sophosTamperProtection.password,
          previous: sophosTamperProtection.previous,
          lastSeenAt: sophosTamperProtection.lastSeenAt
        })
        .from(sophosTamperProtection)
        .innerJoin(sophosEndpoints, eq(sophosTamperProtection.endpointId, sophosEndpoints.id))
        .where(eq(sophosTamperProtection.endpointId, input.endpointId))
        .limit(1);

      if (row) {
        const scope = ctx.scopeFor('Vendors.Read');
        if (scope !== 'all' && (!row.siteId || !scope.includes(row.siteId))) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
      }

      return row ?? null;
    }),

  deleteSophosEndpoints: authProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Delete permission required' });
      }

      const uniqueIds = [...new Set(input.ids)];
      const rows = await ctx.db
        .select({
          id: sophosEndpoints.id,
          linkId: sophosEndpoints.linkId,
          siteId: sophosEndpoints.siteId,
          externalId: sophosEndpoints.externalId,
          hostname: sophosEndpoints.hostname,
          tenantId: integrationLinks.externalId,
          tenantName: integrationLinks.name,
          linkMeta: integrationLinks.meta,
          integrationConfig: integrations.config
        })
        .from(sophosEndpoints)
        .innerJoin(integrationLinks, eq(sophosEndpoints.linkId, integrationLinks.id))
        .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
        .where(
          and(
            inArray(sophosEndpoints.id, uniqueIds),
            eq(integrationLinks.integrationId, 'sophos-partner')
          )
        );

      if (rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No Sophos endpoints found' });
      }

      const batchId = randomUUID();
      const results: SophosEndpointDeleteResult[] = [];

      for (const row of rows) {
        const config = SophosConfigSchema.safeParse(row.integrationConfig);
        const apiHost =
          row.linkMeta && typeof row.linkMeta === 'object' && !Array.isArray(row.linkMeta)
            ? (row.linkMeta as Record<string, unknown>).apiHost
            : undefined;

        let success = false;
        let error: string | undefined;

        try {
          if (!config.success || !config.data.clientId || !config.data.clientSecret) {
            throw new Error('Sophos integration credentials are missing');
          }
          if (!row.tenantId) throw new Error('Sophos tenant id is missing');
          if (typeof apiHost !== 'string' || !apiHost)
            throw new Error('Sophos API host is missing');

          const encryptionKey = ctx.encryptionKey ?? process.env.ENCRYPTION_KEY;
          if (!encryptionKey) throw new Error('Encryption key is not configured');

          const clientSecret = Encryption.decrypt(config.data.clientSecret, encryptionKey);
          if (!clientSecret) throw new Error('Sophos client secret could not be decrypted');

          const connector = new SophosConnector(config.data.clientId, clientSecret);
          await connector.endpoint.delete(apiHost, row.tenantId, row.externalId);
          success = true;
        } catch (err) {
          error = errorMessage(err);
        }

        results.push({
          id: row.id,
          externalId: row.externalId,
          hostname: row.hostname,
          linkId: row.linkId,
          siteId: row.siteId,
          success,
          error
        });

        await ctx.db.insert(customerLogs).values({
          siteId: row.siteId,
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: 'delete',
          actionLabel: ActionLabels.SophosEndpointDelete,
          targetType: 'sophos_endpoint',
          targetId: row.id,
          targetLabel: row.hostname,
          result: success ? 'success' : 'failure',
          errorMessage: error,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: {
            batchId,
            vendor: 'sophos',
            externalId: row.externalId,
            linkId: row.linkId,
            tenantId: row.tenantId,
            tenantName: row.tenantName,
            apiHost: typeof apiHost === 'string' ? apiHost : null
          }
        });
      }

      const successfulIds = results.filter((r) => r.success).map((r) => r.id);
      if (successfulIds.length > 0) {
        await ctx.db.delete(sophosEndpoints).where(inArray(sophosEndpoints.id, successfulIds));
      }

      const deleted = successfulIds.length;
      const failed = results.length - deleted;
      return {
        batchId,
        requested: uniqueIds.length,
        found: rows.length,
        deleted,
        failed,
        result: failed === 0 ? 'success' : deleted === 0 ? 'failure' : 'partial',
        results
      };
    }),

  enableSophosEndpointTamperProtection: authProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      return toggleSophosEndpointTamperProtection(ctx, input.ids, true);
    }),

  disableSophosEndpointTamperProtection: authProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      return toggleSophosEndpointTamperProtection(ctx, input.ids, false);
    }),

  upgradeSophosEndpointSoftware: authProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(10_000) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }

      const uniqueIds = [...new Set(input.ids)];
      const rows = await ctx.db
        .select({
          id: sophosEndpoints.id,
          linkId: sophosEndpoints.linkId,
          siteId: sophosEndpoints.siteId,
          externalId: sophosEndpoints.externalId,
          hostname: sophosEndpoints.hostname,
          needsUpgrade: sophosEndpoints.needsUpgrade,
          tenantId: integrationLinks.externalId,
          tenantName: integrationLinks.name,
          linkMeta: integrationLinks.meta,
          integrationConfig: integrations.config
        })
        .from(sophosEndpoints)
        .innerJoin(integrationLinks, eq(sophosEndpoints.linkId, integrationLinks.id))
        .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
        .where(and(inArray(sophosEndpoints.id, uniqueIds), eq(integrationLinks.integrationId, 'sophos-partner')));

      if (rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No Sophos endpoints found' });
      }

      const batchId = randomUUID();
      const results: SophosEndpointUpgradeResult[] = [];
      const upgradeableByLink = new Map<string, typeof rows>();
      for (const row of rows) {
        if (!row.needsUpgrade) {
          results.push({ id: row.id, externalId: row.externalId, hostname: row.hostname, linkId: row.linkId, siteId: row.siteId, success: true, skipped: true });
          continue;
        }
        const group = upgradeableByLink.get(row.linkId) ?? [];
        group.push(row);
        upgradeableByLink.set(row.linkId, group);
      }

      for (const siteRows of upgradeableByLink.values()) {
        const first = siteRows[0]!;
        const config = SophosConfigSchema.safeParse(first.integrationConfig);
        const apiHost = first.linkMeta && typeof first.linkMeta === 'object' && !Array.isArray(first.linkMeta)
          ? (first.linkMeta as Record<string, unknown>).apiHost : undefined;
        let error: string | undefined;
        try {
          if (!config.success || !config.data.clientId || !config.data.clientSecret) throw new Error('Sophos integration credentials are missing');
          if (!first.tenantId) throw new Error('Sophos tenant id is missing');
          if (typeof apiHost !== 'string' || !apiHost) throw new Error('Sophos API host is missing');
          const encryptionKey = ctx.encryptionKey ?? process.env.ENCRYPTION_KEY;
          if (!encryptionKey) throw new Error('Encryption key is not configured');
          const clientSecret = Encryption.decrypt(config.data.clientSecret, encryptionKey);
          if (!clientSecret) throw new Error('Sophos client secret could not be decrypted');
          const connector = new SophosConnector(config.data.clientId, clientSecret);
          // The settings endpoint is tenant-scoped, so one PATCH is sent for every site.
          await connector.endpoint.upgradeDeviceSoftware(apiHost, first.tenantId, siteRows.map((row) => row.externalId));
        } catch (err) {
          error = errorMessage(err);
        }

        for (const row of siteRows) {
          const success = !error;
          results.push({ id: row.id, externalId: row.externalId, hostname: row.hostname, linkId: row.linkId, siteId: row.siteId, success, error });
          await ctx.db.insert(customerLogs).values({
            siteId: row.siteId, actorType: 'user', actorId: ctx.user.id,
            actorLabel: ctx.user.name || ctx.user.email, action: 'update',
            actionLabel: ActionLabels.SophosEndpointUpgrade, targetType: 'sophos_endpoint',
            targetId: row.id, targetLabel: row.hostname, result: success ? 'success' : 'failure',
            errorMessage: error, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
            metadata: { batchId, vendor: 'sophos', operation: 'deviceSoftwareUpgrade', externalId: row.externalId, linkId: row.linkId, tenantId: row.tenantId, tenantName: row.tenantName, apiHost: typeof apiHost === 'string' ? apiHost : null }
          });
        }
      }

      const upgraded = results.filter((result) => result.success && !result.skipped).length;
      const upgradedIds = results
        .filter((result) => result.success && !result.skipped)
        .map((result) => result.id);
      if (upgradedIds.length > 0) {
        await ctx.db
          .update(sophosEndpoints)
          .set({ needsUpgrade: false, updatedAt: new Date().toISOString() })
          .where(inArray(sophosEndpoints.id, upgradedIds));
      }
      const skipped = results.filter((result) => result.skipped).length;
      const failed = results.filter((result) => !result.success).length;
      return { batchId, requested: uniqueIds.length, found: rows.length, upgraded, skipped, failed, result: failed === 0 ? 'success' : upgraded === 0 ? 'failure' : 'partial', results };
    }),

  revokeM365IdentitySessions: authProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      return runM365IdentityAction(ctx, input.ids, {
        actionLabel: ActionLabels.M365IdentityRevokeSessions,
        auditAction: 'update',
        run: async (connector, row) => {
          await connector.users.revokeSignInSessions(row.externalId);
        }
      });
    }),

  setM365IdentityEnabled: authProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(1000), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      const result = await runM365IdentityAction(ctx, input.ids, {
        actionLabel: input.enabled
          ? ActionLabels.M365IdentityEnable
          : ActionLabels.M365IdentityDisable,
        auditAction: 'update',
        auditMetadata: (row) => ({
          field: 'accountEnabled',
          previousValue: row.enabled,
          newValue: input.enabled
        }),
        skipIf: (row) => row.enabled === input.enabled,
        run: async (connector, row) => {
          await connector.users.update(row.externalId, { accountEnabled: input.enabled });
        }
      });

      const changedIds = result.results.filter((r) => r.success && !r.skipped).map((r) => r.id);
      if (changedIds.length > 0) {
        await ctx.db
          .update(m365Identities)
          .set({ enabled: input.enabled, updatedAt: new Date().toISOString() })
          .where(inArray(m365Identities.id, changedIds));
      }
      return result;
    }),

  resetM365IdentityPassword: authProcedure
    .input(
      z
        .object({
          ids: z.array(z.uuid()).min(1).max(1000),
          // 'random': generate one shared password used across all ids.
          // 'custom': admin-provided password used across all ids.
          // 'none': skip password write; only apply forceChangeNextSignIn.
          mode: z.enum(['random', 'custom', 'none']),
          password: z.string().min(8).max(256).optional(),
          forceChangeNextSignIn: z.boolean()
        })
        .refine((v) => v.mode !== 'custom' || (v.password?.length ?? 0) >= 8, {
          message: 'Password is required when mode is custom',
          path: ['password']
        })
        .refine((v) => v.mode !== 'none' || v.forceChangeNextSignIn, {
          message: 'Nothing to do — enable force change at next sign-in',
          path: ['forceChangeNextSignIn']
        })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }

      const password =
        input.mode === 'random'
          ? generateM365Password()
          : input.mode === 'custom'
            ? input.password!
            : null;

      const actionLabel =
        input.mode === 'none'
          ? ActionLabels.M365IdentityForcePasswordChange
          : ActionLabels.M365IdentityResetPassword;

      const result = await runM365IdentityAction(ctx, input.ids, {
        actionLabel,
        auditAction: 'update',
        auditMetadata: () => ({
          mode: input.mode,
          forceChangeNextSignIn: input.forceChangeNextSignIn
        }),
        run: async (connector, row) => {
          const passwordProfile: Record<string, unknown> = {
            forceChangePasswordNextSignInWithMfa: input.forceChangeNextSignIn
          };
          if (password !== null) passwordProfile.password = password;
          await connector.users.update(row.externalId, { passwordProfile });
        }
      });

      // Return the generated random password once, only if at least one row
      // succeeded and mode is 'random'. Custom passwords are known to the
      // admin already; 'none' has no password to surface.
      const surfacePassword = input.mode === 'random' && result.updated > 0 ? password : null;

      return { ...result, password: surfacePassword };
    }),

  requireM365IdentityMfaReset: authProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }

      const rows = await loadM365IdentityRows(ctx, [input.id]);
      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'M365 identity not found' });
      }
      assertM365IdentityScope(ctx, row);
      if (!row.tenantId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'M365 tenant id is missing' });
      }

      const batchId = randomUUID();
      const connector = m365IdentityConnector(ctx, row.integrationConfig, row.tenantId);

      const methods = (await connector.users.authMethods(row.externalId)).value;
      const perMethod: Array<{
        methodId: string;
        segment: string | null;
        odataType: string;
        success: boolean;
        skipped?: boolean;
        error?: string;
      }> = [];

      for (const method of methods) {
        const odataType =
          typeof method['@odata.type'] === 'string' ? (method['@odata.type'] as string) : '';
        const methodId = typeof method.id === 'string' ? (method.id as string) : '';
        const segment = authMethodSegment(odataType);

        if (!segment || !methodId) {
          // Password method or unknown type — skip silently.
          perMethod.push({ methodId, segment, odataType, success: true, skipped: true });
          continue;
        }

        try {
          await connector.users.deleteAuthMethod(row.externalId, segment, methodId);
          perMethod.push({ methodId, segment, odataType, success: true });
        } catch (err) {
          perMethod.push({
            methodId,
            segment,
            odataType,
            success: false,
            error: errorMessage(err)
          });
        }
      }

      const deleted = perMethod.filter((m) => m.success && !m.skipped).length;
      const skipped = perMethod.filter((m) => m.skipped).length;
      const failed = perMethod.filter((m) => !m.success).length;

      await ctx.db.insert(customerLogs).values({
        siteId: row.siteId,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'delete',
        actionLabel: ActionLabels.M365IdentityRequireMfaReset,
        targetType: 'm365_identity',
        targetId: row.id,
        targetLabel: row.email || row.name,
        result: failed === 0 ? 'success' : deleted === 0 ? 'failure' : 'partial',
        errorMessage: failed > 0 ? perMethod.find((m) => m.error)?.error : undefined,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          batchId,
          vendor: 'microsoft-365',
          externalId: row.externalId,
          linkId: row.linkId,
          tenantId: row.tenantId,
          tenantName: row.tenantName,
          methods: perMethod
        }
      });

      return {
        batchId,
        deleted,
        skipped,
        failed,
        result: failed === 0 ? 'success' : deleted === 0 ? 'failure' : 'partial',
        methods: perMethod
      };
    }),

  deleteM365IdentityAuthMethod: authProcedure
    .input(
      z.object({
        id: z.uuid(),
        methodId: z.string().min(1),
        methodSegment: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      if (!AUTH_METHOD_SEGMENTS.has(input.methodSegment)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown auth method type' });
      }

      const rows = await loadM365IdentityRows(ctx, [input.id]);
      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'M365 identity not found' });
      }
      assertM365IdentityScope(ctx, row);
      if (!row.tenantId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'M365 tenant id is missing' });
      }

      const batchId = randomUUID();
      let success = false;
      let error: string | undefined;

      try {
        const connector = m365IdentityConnector(ctx, row.integrationConfig, row.tenantId);
        await connector.users.deleteAuthMethod(row.externalId, input.methodSegment, input.methodId);
        success = true;
      } catch (err) {
        error = errorMessage(err);
      }

      await ctx.db.insert(customerLogs).values({
        siteId: row.siteId,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'delete',
        actionLabel: ActionLabels.M365IdentityDeleteAuthMethod,
        targetType: 'm365_identity',
        targetId: row.id,
        targetLabel: row.email || row.name,
        result: success ? 'success' : 'failure',
        errorMessage: error,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          batchId,
          vendor: 'microsoft-365',
          externalId: row.externalId,
          linkId: row.linkId,
          tenantId: row.tenantId,
          tenantName: row.tenantName,
          methodSegment: input.methodSegment,
          methodId: input.methodId
        }
      });

      return { batchId, success, error: error ?? null };
    }),

  addM365IdentitiesToGroups: authProcedure
    .input(
      z.object({
        identityIds: z.array(z.uuid()).min(1).max(1000),
        groupIds: z.array(z.uuid()).min(1).max(100)
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      return runM365GroupPairAction(ctx, input.identityIds, input.groupIds, 'add');
    }),

  removeM365IdentitiesFromGroups: authProcedure
    .input(
      z.object({
        identityIds: z.array(z.uuid()).min(1).max(1000),
        groupIds: z.array(z.uuid()).min(1).max(100)
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      return runM365GroupPairAction(ctx, input.identityIds, input.groupIds, 'remove');
    }),

  assignM365LicensesToIdentities: authProcedure
    .input(
      z.object({
        identityIds: z.array(z.uuid()).min(1).max(1000),
        licenseIds: z.array(z.uuid()).min(1).max(50)
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      return runM365LicensePairAction(ctx, input.identityIds, input.licenseIds, 'add');
    }),

  removeM365LicensesFromIdentities: authProcedure
    .input(
      z.object({
        identityIds: z.array(z.uuid()).min(1).max(1000),
        licenseIds: z.array(z.uuid()).min(1).max(50)
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      return runM365LicensePairAction(ctx, input.identityIds, input.licenseIds, 'remove');
    }),

  assignM365RolesToIdentities: authProcedure
    .input(
      z.object({
        identityIds: z.array(z.uuid()).min(1).max(1000),
        roleIds: z.array(z.uuid()).min(1).max(50)
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      return runM365RolePairAction(ctx, input.identityIds, input.roleIds, 'add');
    }),

  removeM365RolesFromIdentities: authProcedure
    .input(
      z.object({
        identityIds: z.array(z.uuid()).min(1).max(1000),
        roleIds: z.array(z.uuid()).min(1).max(50)
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }
      return runM365RolePairAction(ctx, input.identityIds, input.roleIds, 'remove');
    }),

  m365LicenseAvailability: authProcedure
    .input(z.object({ linkId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Read permission required' });
      }
      const [link] = await ctx.db
        .select({
          externalId: integrationLinks.externalId,
          integrationConfig: integrations.config
        })
        .from(integrationLinks)
        .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
        .where(
          and(
            eq(integrationLinks.id, input.linkId),
            eq(integrationLinks.integrationId, 'microsoft-365')
          )
        )
        .limit(1);
      if (!link?.externalId) return [] as Array<{ skuId: string; enabled: number; consumed: number }>;
      try {
        const connector = m365IdentityConnector(ctx, link.integrationConfig, link.externalId);
        const skus = await connector.subscribedSkus.listAll();
        return skus.map((s) => ({
          skuId: s.skuId,
          enabled: s.prepaidUnits?.enabled ?? 0,
          consumed: s.consumedUnits ?? 0
        }));
      } catch {
        return [] as Array<{ skuId: string; enabled: number; consumed: number }>;
      }
    }),

  identityDetails: authProcedure
    .input(z.object({ linkId: z.string().uuid(), identityId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [
        identityRows,
        linkRows,
        roles,
        groups,
        licenses,
        directAssignments,
        groupAssignments,
        roleAssignments,
        allUsersPolicies
      ] = await Promise.all([
        ctx.db
          .select({
            externalId: m365Identities.externalId,
            assignedLicenses: m365Identities.assignedLicenses
          })
          .from(m365Identities)
          .where(
            and(eq(m365Identities.id, input.identityId), eq(m365Identities.linkId, input.linkId))
          )
          .limit(1),
        ctx.db
          .select({
            externalId: integrationLinks.externalId,
            integrationConfig: integrations.config
          })
          .from(integrationLinks)
          .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
          .where(
            and(
              eq(integrationLinks.id, input.linkId),
              eq(integrationLinks.integrationId, 'microsoft-365')
            )
          )
          .limit(1),
        ctx.db
          .select({ id: m365Roles.id, name: m365Roles.name })
          .from(m365IdentityRoles)
          .innerJoin(m365Roles, eq(m365IdentityRoles.roleId, m365Roles.id))
          .where(
            and(
              eq(m365IdentityRoles.identityId, input.identityId),
              eq(m365IdentityRoles.linkId, input.linkId)
            )
          ),
        ctx.db
          .select({ id: m365Groups.id, name: m365Groups.name })
          .from(m365IdentityGroups)
          .innerJoin(m365Groups, eq(m365IdentityGroups.groupId, m365Groups.id))
          .where(
            and(
              eq(m365IdentityGroups.identityId, input.identityId),
              eq(m365IdentityGroups.linkId, input.linkId)
            )
          ),
        ctx.db
          .select({
            id: m365Licenses.id,
            skuId: m365Licenses.skuId,
            skuPartNumber: m365Licenses.skuPartNumber,
            friendlyName: m365Licenses.friendlyName
          })
          .from(m365Licenses)
          .where(
            and(
              eq(m365Licenses.linkId, input.linkId),
              sql`${m365Licenses.skuId} = ANY(
                SELECT unnest(assigned_licenses) FROM vendors.m365_identities
                WHERE id = ${input.identityId}
              )`
            )
          ),
        ctx.db
          .select({
            id: m365Policies.id,
            name: m365Policies.name,
            policyState: m365Policies.policyState,
            included: m365PolicyIdentities.included
          })
          .from(m365PolicyIdentities)
          .innerJoin(m365Policies, eq(m365PolicyIdentities.policyId, m365Policies.id))
          .where(
            and(
              eq(m365PolicyIdentities.identityId, input.identityId),
              eq(m365PolicyIdentities.linkId, input.linkId)
            )
          ),
        ctx.db
          .select({
            id: m365Policies.id,
            name: m365Policies.name,
            policyState: m365Policies.policyState,
            included: m365PolicyGroups.included
          })
          .from(m365IdentityGroups)
          .innerJoin(
            m365PolicyGroups,
            and(
              eq(m365PolicyGroups.groupId, m365IdentityGroups.groupId),
              eq(m365PolicyGroups.linkId, m365IdentityGroups.linkId)
            )
          )
          .innerJoin(m365Policies, eq(m365PolicyGroups.policyId, m365Policies.id))
          .where(
            and(
              eq(m365IdentityGroups.identityId, input.identityId),
              eq(m365IdentityGroups.linkId, input.linkId)
            )
          ),
        ctx.db
          .select({
            id: m365Policies.id,
            name: m365Policies.name,
            policyState: m365Policies.policyState,
            included: m365PolicyRoles.included
          })
          .from(m365IdentityRoles)
          .innerJoin(
            m365PolicyRoles,
            and(
              eq(m365PolicyRoles.roleId, m365IdentityRoles.roleId),
              eq(m365PolicyRoles.linkId, m365IdentityRoles.linkId)
            )
          )
          .innerJoin(m365Policies, eq(m365PolicyRoles.policyId, m365Policies.id))
          .where(
            and(
              eq(m365IdentityRoles.identityId, input.identityId),
              eq(m365IdentityRoles.linkId, input.linkId)
            )
          ),
        ctx.db
          .select({
            id: m365Policies.id,
            name: m365Policies.name,
            policyState: m365Policies.policyState
          })
          .from(m365Policies)
          .where(
            and(
              eq(m365Policies.linkId, input.linkId),
              sql`${m365Policies.conditions} @> '{"users":{"includeUsers":["All"]}}'::jsonb`
            )
          )
      ]);

      const identity = identityRows[0];
      const link = linkRows[0];
      if (!identity) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'M365 identity not found' });
      }
      if (!link?.externalId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'M365 integration link not found' });
      }

      type PolicyRow = { id: string; name: string; policyState: string; included: boolean };
      const policyMap = new Map<string, PolicyRow>();
      for (const p of allUsersPolicies) policyMap.set(p.id, { ...p, included: true });
      for (const p of roleAssignments) {
        const ex = policyMap.get(p.id);
        if (!ex || ex.included) policyMap.set(p.id, p);
      }
      for (const p of groupAssignments) {
        const ex = policyMap.get(p.id);
        if (!ex || ex.included) policyMap.set(p.id, p);
      }
      for (const p of directAssignments) policyMap.set(p.id, p);

      let authMethods: Array<{
        id: string;
        type: string;
        segment: string | null;
        createdDateTime: string | null;
      }> = [];
      let authMethodsError: string | null = null;
      const credentials = m365ClientCredentials(
        link.integrationConfig,
        ctx.microsoftCredentials,
        ctx.encryptionKey
      );

      if (!credentials) {
        authMethodsError = 'Microsoft 365 credentials are not configured for live Graph lookup.';
      } else {
        try {
          const connector = new M365Connector(
            credentials.clientId,
            credentials.clientSecret,
            link.externalId
          );
          authMethods = (await connector.users.authMethods(identity.externalId)).value
            .filter(
              (method: Record<string, unknown>) =>
                method['@odata.type'] !== '#microsoft.graph.passwordAuthenticationMethod'
            )
            .map((method: Record<string, unknown>) => ({
              id: typeof method.id === 'string' ? method.id : randomUUID(),
              type: authMethodType(method),
              segment:
                typeof method['@odata.type'] === 'string'
                  ? authMethodSegment(method['@odata.type'] as string)
                  : null,
              createdDateTime:
                typeof method.createdDateTime === 'string' ? method.createdDateTime : null
            }));
        } catch (error) {
          authMethodsError = errorMessage(error);
        }
      }

      return {
        roles,
        groups,
        licenses,
        policies: Array.from(policyMap.values()),
        authMethods,
        authMethodsError
      };
    }),

  groupMembers: authProcedure
    .input(z.object({ linkId: z.string().uuid(), groupId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: m365Identities.id,
          name: m365Identities.name,
          email: m365Identities.email,
          enabled: m365Identities.enabled
        })
        .from(m365IdentityGroups)
        .innerJoin(
          m365Identities,
          and(
            eq(m365IdentityGroups.identityId, m365Identities.id),
            eq(m365IdentityGroups.linkId, m365Identities.linkId)
          )
        )
        .where(
          and(
            eq(m365IdentityGroups.groupId, input.groupId),
            eq(m365IdentityGroups.linkId, input.linkId)
          )
        );
    }),

  licenseUsers: authProcedure
    .input(z.object({ linkId: z.string().uuid(), skuId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: m365Identities.id,
          name: m365Identities.name,
          email: m365Identities.email,
          enabled: m365Identities.enabled
        })
        .from(m365Identities)
        .where(
          and(
            eq(m365Identities.linkId, input.linkId),
            sql`${m365Identities.assignedLicenses} @> ARRAY[${input.skuId}]::text[]`
          )
        );
    }),

  roleAssignees: authProcedure
    .input(z.object({ linkId: z.string().uuid(), roleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: m365Identities.id,
          name: m365Identities.name,
          email: m365Identities.email,
          enabled: m365Identities.enabled
        })
        .from(m365IdentityRoles)
        .innerJoin(m365Identities, eq(m365IdentityRoles.identityId, m365Identities.id))
        .where(
          and(
            eq(m365IdentityRoles.roleId, input.roleId),
            eq(m365IdentityRoles.linkId, input.linkId)
          )
        );
    }),

  assignedRoles: authProcedure
    .input(z.object({ linkId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: m365Roles.id,
          name: m365Roles.name,
          templateId: m365Roles.templateId,
          description: m365Roles.description,
          assigneeCount: count(m365IdentityRoles.identityId)
        })
        .from(m365Roles)
        .innerJoin(m365IdentityRoles, eq(m365IdentityRoles.roleId, m365Roles.id))
        .where(eq(m365IdentityRoles.linkId, input.linkId))
        .groupBy(m365Roles.id)
        .orderBy(m365Roles.name);

      return rows;
    }),

  m365GroupOptions: authProcedure
    .input(z.object({ linkId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: m365Groups.id,
          name: m365Groups.name,
          externalId: m365Groups.externalId,
          mailEnabled: m365Groups.mailEnabled,
          securityEnabled: m365Groups.securityEnabled
        })
        .from(m365Groups)
        .where(eq(m365Groups.linkId, input.linkId))
        .orderBy(m365Groups.name);
    }),

  m365LicenseOptions: authProcedure
    .input(z.object({ linkId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: m365Licenses.id,
          skuId: m365Licenses.skuId,
          skuPartNumber: m365Licenses.skuPartNumber,
          friendlyName: m365Licenses.friendlyName,
          totalUnits: m365Licenses.totalUnits,
          consumedUnits: m365Licenses.consumedUnits,
          enabled: m365Licenses.enabled
        })
        .from(m365Licenses)
        .where(
          and(
            eq(m365Licenses.linkId, input.linkId),
            eq(m365Licenses.enabled, true),
            eq(m365Licenses.isBloat, false)
          )
        )
        .orderBy(m365Licenses.friendlyName);
    }),

  // Live fetch of verified domains for a tenant. Skips the DB entirely so the
  // caller sees exactly what Graph knows right now — new domains verified in
  // the M365 admin portal show up on the next dialog open.
  m365DomainOptions: authProcedure
    .input(z.object({ linkId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [link] = await ctx.db
        .select({
          externalId: integrationLinks.externalId,
          integrationConfig: integrations.config
        })
        .from(integrationLinks)
        .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
        .where(
          and(
            eq(integrationLinks.id, input.linkId),
            eq(integrationLinks.integrationId, 'microsoft-365')
          )
        )
        .limit(1);
      if (!link?.externalId) {
        return [] as Array<{ domain: string; isDefault: boolean; isVerified: boolean }>;
      }
      try {
        const connector = m365IdentityConnector(ctx, link.integrationConfig, link.externalId);
        const domains = await connector.domains.listAll();
        return domains
          .filter((d) => d.isVerified)
          .map((d) => ({
            domain: d.id,
            isDefault: d.isDefault,
            isVerified: d.isVerified
          }))
          .sort((a, b) => {
            if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
            return a.domain.localeCompare(b.domain);
          });
      } catch {
        return [] as Array<{ domain: string; isDefault: boolean; isVerified: boolean }>;
      }
    }),

  m365RoleOptions: authProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      return ctx.db
        .select({
          id: m365Roles.id,
          templateId: m365Roles.templateId,
          name: m365Roles.name,
          description: m365Roles.description
        })
        .from(m365Roles)
        .orderBy(m365Roles.name);
    }),

  m365IdentityOptions: authProcedure
    .input(z.object({ linkId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: m365Identities.id,
          name: m365Identities.name,
          email: m365Identities.email,
          enabled: m365Identities.enabled
        })
        .from(m365Identities)
        .where(eq(m365Identities.linkId, input.linkId))
        .orderBy(m365Identities.name);
    }),

  policyDetails: authProcedure
    .input(z.object({ linkId: z.string().uuid(), policyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [identities, groups, roles] = await Promise.all([
        ctx.db
          .select({
            name: m365Identities.name,
            email: m365Identities.email,
            included: m365PolicyIdentities.included
          })
          .from(m365PolicyIdentities)
          .innerJoin(m365Identities, eq(m365PolicyIdentities.identityId, m365Identities.id))
          .where(
            and(
              eq(m365PolicyIdentities.policyId, input.policyId),
              eq(m365PolicyIdentities.linkId, input.linkId)
            )
          ),
        ctx.db
          .select({ name: m365Groups.name, included: m365PolicyGroups.included })
          .from(m365PolicyGroups)
          .innerJoin(m365Groups, eq(m365PolicyGroups.groupId, m365Groups.id))
          .where(
            and(
              eq(m365PolicyGroups.policyId, input.policyId),
              eq(m365PolicyGroups.linkId, input.linkId)
            )
          ),
        ctx.db
          .select({ name: m365Roles.name, included: m365PolicyRoles.included })
          .from(m365PolicyRoles)
          .innerJoin(m365Roles, eq(m365PolicyRoles.roleId, m365Roles.id))
          .where(
            and(
              eq(m365PolicyRoles.policyId, input.policyId),
              eq(m365PolicyRoles.linkId, input.linkId)
            )
          )
      ]);
      return { identities, groups, roles };
    }),

  m365TenantStats: authProcedure
    .input(z.object({ linkId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

      const [identityRows, licenseRows, policyRows] = await Promise.all([
        ctx.db
          .select({
            total: count(),
            noMfa: sql<number>`count(*) filter (where ${m365Identities.mfaEnforced} = false)`,
            stale: sql<number>`count(*) filter (where ${m365Identities.lastSignInAt} is null or ${m365Identities.lastSignInAt} < ${thirtyDaysAgo})`
          })
          .from(m365Identities)
          .where(eq(m365Identities.linkId, input.linkId)),
        ctx.db
          .select({
            skus: count(),
            unused: sql<number>`coalesce(sum(greatest(0, ${m365Licenses.totalUnits} - ${m365Licenses.consumedUnits})), 0)`
          })
          .from(m365Licenses)
          .where(
            and(eq(m365Licenses.linkId, input.linkId), eq(m365Licenses.isBloat, false))
          ),
        ctx.db
          .select({
            total: count(),
            enabled: sql<number>`count(*) filter (where ${m365Policies.policyState} in ('enabled', 'enabledForReportingButNotEnforced'))`
          })
          .from(m365Policies)
          .where(eq(m365Policies.linkId, input.linkId))
      ]);

      const id = identityRows[0] ?? { total: 0, noMfa: 0, stale: 0 };
      const lic = licenseRows[0] ?? { skus: 0, unused: 0 };
      const pol = policyRows[0] ?? { total: 0, enabled: 0 };

      return {
        identities: { total: Number(id.total), noMfa: Number(id.noMfa), stale: Number(id.stale) },
        licenses: { skus: Number(lic.skus), unused: Number(lic.unused) },
        policies: { total: Number(pol.total), enabled: Number(pol.enabled) }
      };
    }),

  linkOverview: authProcedure
    .input(z.object({ integrationId: z.string(), groupId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const groupTargets = input.groupId ? await loadGroupTargets(ctx.db, input.groupId) : null;
      const links = await ctx.db
        .select({
          id: integrationLinks.id,
          siteId: integrationLinks.siteId,
          name: integrationLinks.name,
          externalId: integrationLinks.externalId,
          status: integrationLinks.status,
          disposition: integrationLinks.disposition,
          note: integrationLinks.note,
          updatedAt: integrationLinks.updatedAt
        })
        .from(integrationLinks)
        .where(
          and(
            eq(integrationLinks.integrationId, input.integrationId),
            groupTargets
              ? groupTargets.siteIds.length > 0 && groupTargets.linkIds.length > 0
                ? or(
                    inArray(integrationLinks.siteId, groupTargets.siteIds),
                    inArray(integrationLinks.id, groupTargets.linkIds)
                  )
                : groupTargets.siteIds.length > 0
                  ? inArray(integrationLinks.siteId, groupTargets.siteIds)
                  : groupTargets.linkIds.length > 0
                    ? inArray(integrationLinks.id, groupTargets.linkIds)
                    : sql`false`
              : undefined
          )
        )
        .orderBy(integrationLinks.name);

      const siteIds = links.map((link) => link.siteId).filter((id): id is string => !!id);

      const siteRows = siteIds.length
        ? await ctx.db
            .select({ id: sites.id, name: sites.name })
            .from(sites)
            .where(inArray(sites.id, siteIds))
        : [];
      const siteNameById = new Map(siteRows.map((row) => [row.id, row.name]));

      const findingRows = await ctx.db
        .select({
          linkId: findings.linkId,
          count: sql<number>`count(*)::int`,
          maxSeverity: sql<number>`max(${findings.severity})::int`
        })
        .from(findings)
        .where(
          and(
            eq(findings.providerId, input.integrationId),
            inArray(findings.status, ['open', 'acknowledged', 'regressed'])
          )
        )
        .groupBy(findings.linkId)
        .catch(() => [] as { linkId: string | null; count: number; maxSeverity: number }[]);

      const findingsByLink = new Map(
        findingRows.filter((row) => row.linkId).map((row) => [row.linkId as string, row])
      );

      return links.map((link) => {
        const f = findingsByLink.get(link.id);
        const siteName = link.siteId ? (siteNameById.get(link.siteId) ?? null) : null;
        return {
          linkId: link.id,
          siteId: link.siteId,
          siteName: siteName ?? link.name ?? link.externalId ?? 'Unlinked',
          linkName: link.name,
          externalId: link.externalId,
          status: link.status,
          disposition: link.disposition,
          dispositioned: link.status === 'dispositioned' || !!link.disposition,
          note: link.note,
          updatedAt: link.updatedAt,
          findingCount: f?.count ?? 0,
          maxSeverity: f?.maxSeverity ?? null
        };
      });
    }),

  linkFindings: authProcedure
    .input(
      z.object({
        linkId: z.string().uuid(),
        limit: z.number().int().min(1).max(500).default(200),
        status: z
          .array(z.enum(['open', 'acknowledged', 'suppressed', 'resolved', 'regressed']))
          .optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const statusFilter = input.status?.length
        ? input.status
        : (['open', 'acknowledged', 'regressed'] as const);

      const rows = await ctx.db
        .select({
          id: findingsWithContext.id,
          title: findingsWithContext.title,
          severity: findingsWithContext.severity,
          status: findingsWithContext.status,
          siteId: findingsWithContext.siteId,
          siteName: findingsWithContext.siteName,
          linkId: findingsWithContext.linkId,
          linkName: findingsWithContext.linkName,
          resourceType: findingsWithContext.resourceType,
          resourceTable: findingsWithContext.resourceTable,
          resourceId: findingsWithContext.resourceId,
          resourceName: findingsWithContext.resourceName,
          policyId: findingsWithContext.policyId,
          policyName: findingsWithContext.policyName,
          evidenceSummary: findingsWithContext.evidenceSummary,
          recommendation: findingsWithContext.recommendation,
          firstSeenAt: findingsWithContext.firstSeenAt,
          lastSeenAt: findingsWithContext.lastSeenAt
        })
        .from(findingsWithContext)
        .where(
          and(
            eq(findingsWithContext.linkId, input.linkId),
            inArray(findingsWithContext.status, [...statusFilter])
          )
        )
        .orderBy(desc(findingsWithContext.severity), desc(findingsWithContext.lastSeenAt))
        .limit(input.limit)
        .catch(() => []);

      return rows;
    }),

  sophosLicenseTiers: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        linkId: sophosLicenses.linkId,
        code: sophosLicenses.code,
        endsAt: sophosLicenses.endsAt
      })
      .from(sophosLicenses)
      .innerJoin(integrationLinks, eq(integrationLinks.id, sophosLicenses.linkId))
      .where(
        and(
          eq(integrationLinks.integrationId, 'sophos-partner'),
          eq(integrationLinks.status, 'active')
        )
      );

    const now = Date.now();
    const serverRank = { 'SVRCIXAMTR-STD-MSP': 1, SVRCIXAXDR: 2, 'SVRCLOUDADV-MSP': 3 } as const;
    const endpointRank = { 'CIXAMTR-STD-MSP': 1, CIXAXDR: 2, 'CIXA-MSP': 3 } as const;
    const rankLabel = ['MDR', 'XDR', 'Endpoint'] as const;

    const byLink = new Map<string, { serverRank: number | null; endpointRank: number | null }>();
    for (const row of rows) {
      if (row.endsAt && new Date(row.endsAt).getTime() <= now) continue;
      const entry = byLink.get(row.linkId) ?? { serverRank: null, endpointRank: null };
      const sr = serverRank[row.code as keyof typeof serverRank];
      const er = endpointRank[row.code as keyof typeof endpointRank];
      if (sr && (entry.serverRank === null || sr < entry.serverRank)) entry.serverRank = sr;
      if (er && (entry.endpointRank === null || er < entry.endpointRank)) entry.endpointRank = er;
      byLink.set(row.linkId, entry);
    }

    return Array.from(byLink.entries()).map(([linkId, { serverRank, endpointRank }]) => ({
      linkId,
      serverTier: serverRank ? rankLabel[serverRank - 1] : null,
      endpointTier: endpointRank ? rankLabel[endpointRank - 1] : null
    }));
  }),

  startSophosEndpointMigration: authProcedure
    .input(
      z.object({
        ids: z.array(z.uuid()).min(1).max(1000),
        toSiteId: z.uuid()
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write permission required' });
      }

      const uniqueIds = [...new Set(input.ids)];

      const endpointRows = await ctx.db
        .select({
          id: sophosEndpoints.id,
          linkId: sophosEndpoints.linkId,
          siteId: sophosEndpoints.siteId,
          externalId: sophosEndpoints.externalId,
          hostname: sophosEndpoints.hostname,
          fromTenantId: integrationLinks.externalId,
          fromLinkMeta: integrationLinks.meta,
          integrationConfig: integrations.config
        })
        .from(sophosEndpoints)
        .innerJoin(integrationLinks, eq(sophosEndpoints.linkId, integrationLinks.id))
        .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
        .where(
          and(
            inArray(sophosEndpoints.id, uniqueIds),
            eq(integrationLinks.integrationId, 'sophos-partner')
          )
        );

      if (endpointRows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No Sophos endpoints found' });
      }
      if (endpointRows.length !== uniqueIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Some selected endpoints are missing or not Sophos-managed'
        });
      }

      const fromLinkIds = new Set(endpointRows.map((r) => r.linkId));
      if (fromLinkIds.size > 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'All endpoints must belong to the same source site'
        });
      }
      const source = endpointRows[0]!;
      if (source.siteId === input.toSiteId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Target site is the same as the source site'
        });
      }

      const scope = ctx.scopeFor('Vendors.Write');
      if (scope !== 'all') {
        const scopeSet = new Set(scope);
        if (!source.siteId || !scopeSet.has(source.siteId) || !scopeSet.has(input.toSiteId)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Both source and target sites must be within your scope'
          });
        }
      }

      const [targetLink] = await ctx.db
        .select({
          id: integrationLinks.id,
          siteId: integrationLinks.siteId,
          externalId: integrationLinks.externalId,
          meta: integrationLinks.meta,
          status: integrationLinks.status
        })
        .from(integrationLinks)
        .where(
          and(
            eq(integrationLinks.integrationId, 'sophos-partner'),
            eq(integrationLinks.siteId, input.toSiteId)
          )
        )
        .limit(1);

      if (!targetLink || !targetLink.externalId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Target site has no active Sophos Partner integration'
        });
      }
      if (targetLink.status === 'disabled') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Target Sophos Partner link is disabled'
        });
      }

      const toApiHost =
        targetLink.meta && typeof targetLink.meta === 'object' && !Array.isArray(targetLink.meta)
          ? (targetLink.meta as Record<string, unknown>).apiHost
          : undefined;

      const fromApiHost =
        source.fromLinkMeta &&
        typeof source.fromLinkMeta === 'object' &&
        !Array.isArray(source.fromLinkMeta)
          ? (source.fromLinkMeta as Record<string, unknown>).apiHost
          : undefined;

      const config = SophosConfigSchema.safeParse(source.integrationConfig);
      if (!config.success || !config.data.clientId || !config.data.clientSecret) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Sophos integration credentials are missing'
        });
      }
      if (!source.fromTenantId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Sophos source tenant id is missing'
        });
      }
      if (typeof toApiHost !== 'string' || !toApiHost) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Sophos target API host is missing'
        });
      }
      if (typeof fromApiHost !== 'string' || !fromApiHost) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Sophos source API host is missing'
        });
      }

      const encryptionKey = ctx.encryptionKey ?? process.env.ENCRYPTION_KEY;
      if (!encryptionKey) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Encryption key is not configured'
        });
      }
      const clientSecret = Encryption.decrypt(config.data.clientSecret, encryptionKey);
      if (!clientSecret) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Sophos client secret could not be decrypted'
        });
      }

      const connector = new SophosConnector(config.data.clientId, clientSecret);

      const endpointExternalIds = endpointRows.map((r) => r.externalId);
      let created;
      try {
        created = await connector.endpoint.migrations.create(
          toApiHost,
          source.fromTenantId,
          targetLink.externalId,
          endpointExternalIds
        );
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: `Sophos migration create failed: ${errorMessage(err)}`
        });
      }

      try {
        await connector.endpoint.migrations.trigger(
          fromApiHost,
          source.fromTenantId,
          created.id,
          created.token,
          endpointExternalIds
        );
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: `Sophos migration trigger failed (source tenant may need "Allow device migration" enabled): ${errorMessage(err)}`
        });
      }

      const [row] = await ctx.db
        .insert(sophosEndpointMigrations)
        .values({
          sophosMigrationId: created.id,
          fromLinkId: source.linkId,
          toLinkId: targetLink.id,
          fromSiteId: source.siteId,
          toSiteId: targetLink.siteId,
          endpointIds: endpointRows.map((r) => r.id),
          status: 'running',
          requestedCount: endpointRows.length,
          initiatedBy: ctx.user.id
        })
        .returning({ id: sophosEndpointMigrations.id });

      return {
        id: row!.id,
        sophosMigrationId: created.id,
        requested: endpointRows.length
      };
    }),

  sophosEndpointMigrationStatus: authProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Read permission required' });
      }

      const [job] = await ctx.db
        .select()
        .from(sophosEndpointMigrations)
        .where(eq(sophosEndpointMigrations.id, input.id))
        .limit(1);

      if (!job) throw new TRPCError({ code: 'NOT_FOUND' });

      const scope = ctx.scopeFor('Vendors.Read');
      if (scope !== 'all') {
        const scopeSet = new Set(scope);
        const okSource = !job.fromSiteId || scopeSet.has(job.fromSiteId);
        const okTarget = !job.toSiteId || scopeSet.has(job.toSiteId);
        if (!okSource && !okTarget) throw new TRPCError({ code: 'NOT_FOUND' });
      }

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'partial') {
        return {
          id: job.id,
          status: job.status,
          requested: job.requestedCount,
          succeeded: job.succeededCount,
          failed: job.failedCount,
          error: job.error
        };
      }

      const [target] = await ctx.db
        .select({
          externalId: integrationLinks.externalId,
          meta: integrationLinks.meta,
          integrationConfig: integrations.config
        })
        .from(integrationLinks)
        .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
        .where(eq(integrationLinks.id, job.toLinkId))
        .limit(1);

      if (!target || !target.externalId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Target Sophos link is no longer available'
        });
      }
      const apiHost =
        target.meta && typeof target.meta === 'object' && !Array.isArray(target.meta)
          ? (target.meta as Record<string, unknown>).apiHost
          : undefined;
      if (typeof apiHost !== 'string' || !apiHost) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Target API host missing' });
      }

      const config = SophosConfigSchema.safeParse(target.integrationConfig);
      if (!config.success || !config.data.clientId || !config.data.clientSecret) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Sophos integration credentials are missing'
        });
      }
      const encryptionKey = ctx.encryptionKey ?? process.env.ENCRYPTION_KEY;
      if (!encryptionKey) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Encryption key is not configured'
        });
      }
      const clientSecret = Encryption.decrypt(config.data.clientSecret, encryptionKey);
      if (!clientSecret) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Sophos client secret could not be decrypted'
        });
      }

      const connector = new SophosConnector(config.data.clientId, clientSecret);

      let items;
      try {
        items = await connector.endpoint.migrations.getEndpoints(
          apiHost,
          target.externalId,
          job.sophosMigrationId
        );
      } catch (err) {
        return {
          id: job.id,
          status: job.status,
          requested: job.requestedCount,
          succeeded: job.succeededCount,
          failed: job.failedCount,
          pending: job.requestedCount - job.succeededCount - job.failedCount,
          error: errorMessage(err)
        };
      }

      const succeededExt = items.filter((i) => i.status === 'succeeded');
      const failedExt = items.filter((i) => i.status === 'failed');
      const pendingCount = items.filter((i) => i.status === 'pending').length;

      // Repoint DB rows for succeeded endpoints that haven't been finalized yet.
      const succeededExtIds = new Set(succeededExt.map((i) => i.id));
      let newlyFinalized: {
        id: string;
        externalId: string;
        hostname: string;
        newExternalId: string;
      }[] = [];
      if (succeededExtIds.size > 0) {
        const candidateRows = await ctx.db
          .select({
            id: sophosEndpoints.id,
            externalId: sophosEndpoints.externalId,
            hostname: sophosEndpoints.hostname,
            linkId: sophosEndpoints.linkId
          })
          .from(sophosEndpoints)
          .where(inArray(sophosEndpoints.id, job.endpointIds));

        const stillOnSource = candidateRows.filter(
          (r) => r.linkId === job.fromLinkId && succeededExtIds.has(r.externalId)
        );
        if (stillOnSource.length > 0) {
          const byExtId = new Map(succeededExt.map((i) => [i.id, i]));
          const now = new Date().toISOString();

          for (const row of stillOnSource) {
            const item = byExtId.get(row.externalId)!;
            const newExternalId = item.newId ?? row.externalId;
            await ctx.db
              .update(sophosEndpoints)
              .set({
                linkId: job.toLinkId,
                siteId: job.toSiteId,
                externalId: newExternalId,
                updatedAt: now
              })
              .where(eq(sophosEndpoints.id, row.id));

            await ctx.db
              .update(sophosTamperProtection)
              .set({ linkId: job.toLinkId, siteId: job.toSiteId })
              .where(eq(sophosTamperProtection.endpointId, row.id));

            await ctx.db.insert(customerLogs).values({
              siteId: job.toSiteId,
              actorType: 'user',
              actorId: job.initiatedBy ?? ctx.user.id,
              actorLabel: ctx.user.name || ctx.user.email,
              action: 'update',
              actionLabel: ActionLabels.SophosEndpointMigrate,
              targetType: 'sophos_endpoint',
              targetId: row.id,
              targetLabel: row.hostname,
              result: 'success',
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
              metadata: {
                migrationJobId: job.id,
                sophosMigrationId: job.sophosMigrationId,
                fromLinkId: job.fromLinkId,
                toLinkId: job.toLinkId,
                fromSiteId: job.fromSiteId,
                toSiteId: job.toSiteId,
                previousExternalId: row.externalId,
                newExternalId
              }
            });

            newlyFinalized.push({
              id: row.id,
              externalId: row.externalId,
              hostname: row.hostname,
              newExternalId
            });
          }
        }
      }

      const succeeded = succeededExt.length;
      const failed = failedExt.length;
      const total = succeeded + failed + pendingCount;
      const nextStatus: 'running' | 'completed' | 'failed' | 'partial' =
        pendingCount > 0
          ? 'running'
          : failed === 0
            ? 'completed'
            : succeeded === 0
              ? 'failed'
              : 'partial';

      const finalizedCount = job.finalizedCount + newlyFinalized.length;

      await ctx.db
        .update(sophosEndpointMigrations)
        .set({
          status: nextStatus,
          succeededCount: succeeded,
          failedCount: failed,
          finalizedCount,
          completedAt:
            nextStatus === 'running' ? null : (job.completedAt ?? new Date().toISOString()),
          updatedAt: new Date().toISOString()
        })
        .where(eq(sophosEndpointMigrations.id, job.id));

      return {
        id: job.id,
        status: nextStatus,
        requested: job.requestedCount,
        succeeded,
        failed,
        pending: pendingCount,
        reported: total,
        error: null as string | null
      };
    }),

  listSophosMigrations: authProcedure
    .input(
      z
        .object({
          status: z.enum(['pending', 'running', 'completed', 'failed', 'partial']).optional(),
          limit: z.number().int().min(1).max(500).default(100)
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Read permission required' });
      }

      const fromSites = alias(sites, 'from_sites');
      const toSites = alias(sites, 'to_sites');

      const conditions = [] as ReturnType<typeof and>[];
      if (input?.status) {
        conditions.push(eq(sophosEndpointMigrations.status, input.status));
      }

      const scope = ctx.scopeFor('Vendors.Read');
      if (scope !== 'all') {
        if (scope.length === 0) return [];
        conditions.push(
          or(
            inArray(sophosEndpointMigrations.fromSiteId, [...scope]),
            inArray(sophosEndpointMigrations.toSiteId, [...scope])
          )!
        );
      }

      const rows = await ctx.db
        .select({
          id: sophosEndpointMigrations.id,
          sophosMigrationId: sophosEndpointMigrations.sophosMigrationId,
          status: sophosEndpointMigrations.status,
          requestedCount: sophosEndpointMigrations.requestedCount,
          succeededCount: sophosEndpointMigrations.succeededCount,
          failedCount: sophosEndpointMigrations.failedCount,
          finalizedCount: sophosEndpointMigrations.finalizedCount,
          fromLinkId: sophosEndpointMigrations.fromLinkId,
          toLinkId: sophosEndpointMigrations.toLinkId,
          fromSiteId: sophosEndpointMigrations.fromSiteId,
          toSiteId: sophosEndpointMigrations.toSiteId,
          fromSiteName: fromSites.name,
          toSiteName: toSites.name,
          initiatedBy: sophosEndpointMigrations.initiatedBy,
          initiatedByName: users.name,
          initiatedByEmail: users.email,
          error: sophosEndpointMigrations.error,
          startedAt: sophosEndpointMigrations.startedAt,
          completedAt: sophosEndpointMigrations.completedAt,
          createdAt: sophosEndpointMigrations.createdAt,
          updatedAt: sophosEndpointMigrations.updatedAt
        })
        .from(sophosEndpointMigrations)
        .leftJoin(fromSites, eq(fromSites.id, sophosEndpointMigrations.fromSiteId))
        .leftJoin(toSites, eq(toSites.id, sophosEndpointMigrations.toSiteId))
        .leftJoin(users, eq(users.id, sophosEndpointMigrations.initiatedBy))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(sophosEndpointMigrations.createdAt))
        .limit(input?.limit ?? 100);

      return rows;
    }),

  getSophosMigration: authProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Read permission required' });
      }

      const fromSites = alias(sites, 'from_sites');
      const toSites = alias(sites, 'to_sites');

      const [row] = await ctx.db
        .select({
          id: sophosEndpointMigrations.id,
          sophosMigrationId: sophosEndpointMigrations.sophosMigrationId,
          status: sophosEndpointMigrations.status,
          requestedCount: sophosEndpointMigrations.requestedCount,
          succeededCount: sophosEndpointMigrations.succeededCount,
          failedCount: sophosEndpointMigrations.failedCount,
          finalizedCount: sophosEndpointMigrations.finalizedCount,
          endpointIds: sophosEndpointMigrations.endpointIds,
          fromLinkId: sophosEndpointMigrations.fromLinkId,
          toLinkId: sophosEndpointMigrations.toLinkId,
          fromSiteId: sophosEndpointMigrations.fromSiteId,
          toSiteId: sophosEndpointMigrations.toSiteId,
          fromSiteName: fromSites.name,
          toSiteName: toSites.name,
          initiatedBy: sophosEndpointMigrations.initiatedBy,
          initiatedByName: users.name,
          initiatedByEmail: users.email,
          error: sophosEndpointMigrations.error,
          startedAt: sophosEndpointMigrations.startedAt,
          completedAt: sophosEndpointMigrations.completedAt,
          createdAt: sophosEndpointMigrations.createdAt,
          updatedAt: sophosEndpointMigrations.updatedAt
        })
        .from(sophosEndpointMigrations)
        .leftJoin(fromSites, eq(fromSites.id, sophosEndpointMigrations.fromSiteId))
        .leftJoin(toSites, eq(toSites.id, sophosEndpointMigrations.toSiteId))
        .leftJoin(users, eq(users.id, sophosEndpointMigrations.initiatedBy))
        .where(eq(sophosEndpointMigrations.id, input.id))
        .limit(1);

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      const scope = ctx.scopeFor('Vendors.Read');
      if (scope !== 'all') {
        const scopeSet = new Set(scope);
        const okFrom = !row.fromSiteId || scopeSet.has(row.fromSiteId);
        const okTo = !row.toSiteId || scopeSet.has(row.toSiteId);
        if (!okFrom && !okTo) throw new TRPCError({ code: 'NOT_FOUND' });
      }

      const endpointRows =
        row.endpointIds.length > 0
          ? await ctx.db
              .select({
                id: sophosEndpoints.id,
                externalId: sophosEndpoints.externalId,
                hostname: sophosEndpoints.hostname,
                linkId: sophosEndpoints.linkId,
                siteId: sophosEndpoints.siteId
              })
              .from(sophosEndpoints)
              .where(inArray(sophosEndpoints.id, row.endpointIds))
          : [];

      return { ...row, endpoints: endpointRows };
    }),

  // Returns the flat list of child partners visible to the configured Cove
  // integration. Used by the run-package dialog to populate the parent partner
  // picker without requiring the user to know Cove internal IDs.
  coveChildPartners: authProcedure.query(async ({ ctx }) => {
    if (!ctx.can('Vendors.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Read permission required' });
    }
    const [integration] = await ctx.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, 'cove'))
      .limit(1);
    if (!integration || integration.deletedAt) return [];

    const config = z.object({
      server: z.string(),
      partnerId: z.number(),
      clientId: z.string(),
      clientSecret: z.string(),
    }).safeParse(integration.config);
    if (!config.success) return [];

    const { server, partnerId, clientId, clientSecret } = config.data;
    const encryptionKey = ctx.encryptionKey ?? process.env.ENCRYPTION_KEY;
    if (!encryptionKey) return [];
    const decrypted = Encryption.decrypt(clientSecret, encryptionKey);
    if (!decrypted) return [];

    const connector = new CoveConnector(server, clientId, decrypted);
    const children = await connector.partner.children.list(partnerId).catch(() => []);
    return children
      .map((c) => ({ id: c.Info.Id, name: c.Info.Name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

  // Halo lookup endpoints — feed the create-ticket capability's priority /
  // ticket-type / category dropdowns without asking authors to know Halo's
  // internal IDs. All three resolve the HaloPSA integration from the
  // `integrations` table (tenant-wide config, not per-site link) and refresh
  // on every dialog open (staleTime: 0 on the client).
  halopsaTicketPriorities: authProcedure.query(async ({ ctx }) => {
    const connector = await loadHaloPSAConnectorForOptions(ctx);
    if (!connector) return [];
    return connector.priorities.list().catch(() => []);
  }),

  halopsaTicketTypes: authProcedure.query(async ({ ctx }) => {
    const connector = await loadHaloPSAConnectorForOptions(ctx);
    if (!connector) return [];
    return connector.ticketTypes.list().catch(() => []);
  }),

  halopsaTicketCategories: authProcedure.query(async ({ ctx }) => {
    const connector = await loadHaloPSAConnectorForOptions(ctx);
    if (!connector) return [];
    return connector.categories.list().catch(() => []);
  }),
});

async function loadHaloPSAConnectorForOptions(
  ctx: Context
): Promise<HaloPSAConnector | null> {
  if (!ctx.can('Vendors.Read')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Read permission required' });
  }
  const [integration] = await ctx.db
    .select()
    .from(integrations)
    .where(eq(integrations.id, 'halopsa'))
    .limit(1);
  if (!integration || integration.deletedAt) return null;

  const config = z.object({
    url: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
  }).safeParse(integration.config);
  if (!config.success) return null;

  const encryptionKey = ctx.encryptionKey ?? process.env.ENCRYPTION_KEY;
  if (!encryptionKey) return null;
  const decrypted = Encryption.decrypt(config.data.clientSecret, encryptionKey);
  if (!decrypted) return null;

  return new HaloPSAConnector(config.data.url, config.data.clientId, decrypted);
}
