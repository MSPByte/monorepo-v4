// TODO: Findings Implementation
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  eq,
  and,
  count,
  sql,
  inArray,
  desc
} from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  customerLogs,
  findings,
  findingsWithContext,
  integrations,
  integrationLinks,
  sites,
  m365Identities,
  m365Groups,
  m365Policies,
  m365PolicyIdentities,
  m365PolicyGroups,
  m365PolicyRoles,
  m365Licenses,
  m365ExchangeConfigs,
  m365AuthMethods,
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
  sophosFirewalls,
  sophosLicenses,
  sophosTamperProtection,
  sophosEndpointsWithSite,
  sophosFirewallsWithSite,
  sophosLicensesWithSite,
  coveEndpointsWithSite,
  dattoEndpoints,
  coveEndpoints
} from '@mspbyte/drizzle';
import { Encryption, SophosConnector, hasPermission, ActionLabels } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';

const VENDOR_TABLE_MAP = {
  m365_identities: m365Identities,
  m365_groups: m365Groups,
  m365_policies: m365Policies,
  m365_licenses: m365Licenses,
  m365_exchange_configs: m365ExchangeConfigs,
  m365_auth_methods: m365AuthMethods,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const vendorRouter = t.router({
  tableData: authProcedure
    .input(
      z.object({
        table: z.string(),
        linkId: z.uuid().optional(),
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
      if (!(input.table in VENDOR_TABLE_MAP)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unknown vendor table: ${input.table}`
        });
      }

      const table = VENDOR_TABLE_MAP[input.table as VendorTableKey] as any;
      const offset = (input.page - 1) * input.pageSize;

      // Build base filter: linkId takes priority, else siteId
      const baseConditions: ReturnType<typeof sql>[] = [];
      if (input.linkId) {
        baseConditions.push(sql`${sql.identifier('link_id')} = ${input.linkId}`);
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
      const attrs = (ctx.role.attributes as Record<string, boolean>) ?? null;
      if (!hasPermission(attrs, 'Assets.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Read permission required' });
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

      return row ?? null;
    }),

  deleteSophosEndpoints: authProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const attrs = (ctx.role.attributes as Record<string, boolean>) ?? null;
      if (!hasPermission(attrs, 'Assets.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Delete permission required' });
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

          const clientSecret = Encryption.decrypt(
            config.data.clientSecret,
            process.env.ENCRYPTION_KEY!
          );
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
      const attrs = (ctx.role.attributes as Record<string, boolean>) ?? null;
      if (!hasPermission(attrs, 'Assets.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Write permission required' });
      }

      const uniqueIds = [...new Set(input.ids)];
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

      for (const row of rows) {
        if (row.tamperProtectionEnabled) {
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
          if (typeof apiHost !== 'string' || !apiHost)
            throw new Error('Sophos API host is missing');

          const clientSecret = Encryption.decrypt(
            config.data.clientSecret,
            process.env.ENCRYPTION_KEY!
          );
          if (!clientSecret) throw new Error('Sophos client secret could not be decrypted');

          const connector = new SophosConnector(config.data.clientId, clientSecret);
          await connector.endpoint.tamperProtection.toggle(
            apiHost,
            row.tenantId,
            row.externalId,
            true
          );
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
          actionLabel: ActionLabels.SophosEndpointTamperEnable,
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
            previousValue: false,
            newValue: true,
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
          .set({ tamperProtectionEnabled: true, updatedAt: new Date().toISOString() })
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
    }),

  identityDetails: authProcedure
    .input(z.object({ linkId: z.string().uuid(), identityId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [
        roles,
        groups,
        directAssignments,
        groupAssignments,
        roleAssignments,
        allUsersPolicies
      ] = await Promise.all([
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

      return { roles, groups, policies: Array.from(policyMap.values()) };
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
          .where(eq(m365Licenses.linkId, input.linkId)),
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
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
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
        .where(eq(integrationLinks.integrationId, input.integrationId))
        .orderBy(integrationLinks.name);

      const siteIds = links
        .map((link) => link.siteId)
        .filter((id): id is string => !!id);

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
        findingRows
          .filter((row) => row.linkId)
          .map((row) => [row.linkId as string, row])
      );

      return links.map((link) => {
        const f = findingsByLink.get(link.id);
        const siteName = link.siteId ? siteNameById.get(link.siteId) ?? null : null;
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
        status: z.array(z.enum(['open', 'acknowledged', 'suppressed', 'resolved', 'regressed'])).optional()
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
    })
});
