import { z } from 'zod';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  customerLogs,
  integrationLinks,
  m365Groups,
  m365Identities,
  m365Licenses,
  m365Roles,
  packageRuns,
  packages,
  siteGroupLinkMembers,
  siteProfileFields,
} from '@mspbyte/drizzle';
import { sql } from 'drizzle-orm';
import {
  getCapability,
  getGenerator,
  listCapabilities,
  listGenerators,
} from '@mspbyte/capabilities';
import { ActionLabels } from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import {
  assertTenantScopedIntegrationLinks,
  loadMatchingGroupIds,
  packageMatchesScope,
  readPackageScope,
} from './package-scope.js';

// Bindings are validated shallowly here — the worker's zod.parse on
// capability.inputs is the real gate. The builder UI is trusted to compose
// valid shapes; we still enforce kind + required keys so obvious mistakes
// don't get persisted.
const bindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: z.unknown() }),
  z.object({
    kind: z.literal('runtime'),
    promptKey: z.string().min(1),
    required: z.boolean(),
  }),
  z.object({
    kind: z.literal('entity'),
    source: z.enum(['row-context', 'picker']),
    entityType: z.string().min(1),
    pickerConfig: z
      .object({
        multi: z.boolean().optional(),
        filter: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    contextKey: z.string().optional(),
  }),
  z.object({
    kind: z.literal('priorOutput'),
    stepPosition: z.number().int().min(0),
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal('generated'),
    generator: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal('siteFact'),
    key: z.string().min(1),
    required: z.boolean(),
  }),
]);

const stepSchema = z.object({
  capabilityId: z.string().min(1),
  label: z.string().optional(),
  optional: z.boolean().default(false),
  inputBindings: z.record(z.string(), bindingSchema),
  onFailure: z.enum(['halt', 'continue']).default('halt'),
  retryAttempts: z.number().int().min(0).max(5).default(0),
});
type ParsedStep = z.infer<typeof stepSchema>;

const failureActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('log') }),
  z.object({
    kind: z.literal('email'),
    to: z.array(z.string().email()).min(1),
    subject: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('psa_ticket'),
    boardId: z.string().optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
  }),
]);

const packageInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  steps: z.array(stepSchema).min(1),
  failureActions: z.array(failureActionSchema).default([]),
  // Scope: empty arrays => global. Non-empty restricts which sites can run
  // this package (site direct-match, tenant direct-match, or any matching group).
  allowedSites: z.array(z.uuid()).default([]),
  allowedSiteGroups: z.array(z.uuid()).default([]),
  allowedIntegrationLinks: z.array(z.uuid()).default([]),
});

const entityTypeSchema = z.enum([
  'integration_link',
  'm365_identity',
  'm365_group',
  'm365_license',
  'm365_role',
]);
type EntityOption = {
  id: string;
  label: string;
  subLabel?: string;
  // When true, the picker renders the row muted and refuses selection — used
  // for licenses that are fully consumed, disabled sites, etc.
  disabled?: boolean;
};

// Rejects obviously broken bindings: unknown capabilityId, priorOutput
// pointing forward, entity bindings whose entityType the capability doesn't
// declare, etc. Real type-checking of literal values happens at run time via
// zod on capability.inputs.
function validateStepsAgainstRegistry(steps: ParsedStep[]): string | null {
  for (let pos = 0; pos < steps.length; pos++) {
    const step = steps[pos]!;
    const cap = getCapability(step.capabilityId);
    if (!cap) return `Unknown capability at step ${pos + 1}: ${step.capabilityId}`;
    for (const [inputName, binding] of Object.entries(step.inputBindings)) {
      const meta = cap.inputMeta[inputName];
      if (!meta) return `Step ${pos + 1}: capability has no input "${inputName}"`;
      if (!meta.allowedBindings.includes(binding.kind)) {
        return `Step ${pos + 1} input "${inputName}" does not allow binding kind "${binding.kind}"`;
      }
      if (binding.kind === 'entity' && meta.entityType && binding.entityType !== meta.entityType) {
        return `Step ${pos + 1} input "${inputName}" expects entity type "${meta.entityType}" (got "${binding.entityType}")`;
      }
      if (binding.kind === 'priorOutput' && binding.stepPosition >= pos) {
        return `Step ${pos + 1} priorOutput can only reference earlier steps`;
      }
      if (binding.kind === 'generated') {
        const generator = getGenerator(binding.generator);
        if (!generator) {
          return `Step ${pos + 1} input "${inputName}" references unknown generator "${binding.generator}"`;
        }
        if (meta.typeHint && !generator.appliesToTypeHints.includes(meta.typeHint)) {
          return `Step ${pos + 1} input "${inputName}" (${meta.typeHint}) is not compatible with generator "${binding.generator}"`;
        }
        const parsed = generator.paramsSchema.safeParse(binding.params);
        if (!parsed.success) {
          return `Step ${pos + 1} input "${inputName}" generator params invalid: ${parsed.error.message}`;
        }
      }
    }
  }
  return null;
}

export const packagesRouter = t.router({
  list: authProcedure
    .input(
      z
        .object({
          // When provided, filters to packages runnable at this site: global
          // packages (empty allow-lists) or scoped packages that include the
          // current site/link directly or via one of its groups.
          siteId: z.uuid().optional(),
          linkId: z.uuid().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
      }
      const rows = await ctx.db
        .select({
          id: packages.id,
          name: packages.name,
          description: packages.description,
          status: packages.status,
          version: packages.version,
          steps: packages.steps,
          allowedSites: packages.allowedSites,
          allowedSiteGroups: packages.allowedSiteGroups,
          allowedIntegrationLinks: packages.allowedIntegrationLinks,
          createdAt: packages.createdAt,
          updatedAt: packages.updatedAt,
        })
        .from(packages)
        .orderBy(desc(packages.updatedAt));

      if (!input.siteId && !input.linkId) return rows;

      const matchingGroupIds = await loadMatchingGroupIds(ctx.db, {
        siteId: input.siteId,
        linkId: input.linkId,
      });

      return rows.filter((row) => {
        const scope = readPackageScope(row);
        return packageMatchesScope(scope, input, matchingGroupIds);
      });
    }),

  get: authProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
      }
      const [row] = await ctx.db
        .select()
        .from(packages)
        .where(eq(packages.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });
      return row;
    }),

  create: authProcedure
    .input(packageInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Write required' });
      }
      const err = validateStepsAgainstRegistry(input.steps);
      if (err) throw new TRPCError({ code: 'BAD_REQUEST', message: err });
      const directLinkScope = await assertTenantScopedIntegrationLinks(
        ctx.db,
        input.allowedIntegrationLinks
      );
      if (!directLinkScope.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: directLinkScope.message });
      }

      const inserted = await ctx.db
        .insert(packages)
        .values({
          name: input.name,
          description: input.description ?? null,
          status: input.status,
          version: 1,
          steps: input.steps,
          failureActions: input.failureActions,
          allowedSites: input.allowedSites,
          allowedSiteGroups: input.allowedSiteGroups,
          allowedIntegrationLinks: input.allowedIntegrationLinks,
          authorUserId: ctx.user.id,
        })
        .returning({ id: packages.id });
      const row = inserted[0]!;

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'create',
        actionLabel: ActionLabels.PackageCreate,
        targetType: 'package',
        targetId: row.id,
        targetLabel: input.name,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { id: row.id };
    }),

  update: authProcedure
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        status: z.enum(['draft', 'active', 'archived']).optional(),
        steps: z.array(stepSchema).min(1).optional(),
        failureActions: z.array(failureActionSchema).optional(),
        allowedSites: z.array(z.uuid()).optional(),
        allowedSiteGroups: z.array(z.uuid()).optional(),
        allowedIntegrationLinks: z.array(z.uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Write required' });
      }
      const [current] = await ctx.db
        .select()
        .from(packages)
        .where(eq(packages.id, input.id))
        .limit(1);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });

      if (input.steps) {
        const err = validateStepsAgainstRegistry(input.steps);
        if (err) throw new TRPCError({ code: 'BAD_REQUEST', message: err });
      }
      if (input.allowedIntegrationLinks) {
        const directLinkScope = await assertTenantScopedIntegrationLinks(
          ctx.db,
          input.allowedIntegrationLinks
        );
        if (!directLinkScope.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: directLinkScope.message });
        }
      }

      const stepsChanged =
        input.steps !== undefined &&
        JSON.stringify(input.steps) !== JSON.stringify(current.steps);

      await ctx.db
        .update(packages)
        .set({
          name: input.name ?? current.name,
          description: input.description === undefined ? current.description : input.description,
          status: input.status ?? current.status,
          steps: input.steps ?? current.steps,
          failureActions: input.failureActions ?? current.failureActions,
          allowedSites: input.allowedSites ?? current.allowedSites,
          allowedSiteGroups: input.allowedSiteGroups ?? current.allowedSiteGroups,
          allowedIntegrationLinks:
            input.allowedIntegrationLinks ?? current.allowedIntegrationLinks,
          version: stepsChanged ? current.version + 1 : current.version,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(packages.id, input.id));

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'update',
        actionLabel: ActionLabels.PackageUpdate,
        targetType: 'package',
        targetId: input.id,
        targetLabel: input.name ?? current.name,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { stepsChanged, previousVersion: current.version },
      });

      return { id: input.id, version: stepsChanged ? current.version + 1 : current.version };
    }),

  archive: authProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Delete required' });
      }
      const [current] = await ctx.db
        .select({ id: packages.id, name: packages.name, status: packages.status })
        .from(packages)
        .where(eq(packages.id, input.id))
        .limit(1);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });

      await ctx.db
        .update(packages)
        .set({ status: 'archived', updatedAt: new Date().toISOString() })
        .where(eq(packages.id, input.id));

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'delete',
        actionLabel: ActionLabels.PackageDelete,
        targetType: 'package',
        targetId: input.id,
        targetLabel: current.name,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { id: input.id };
    }),

  delete: authProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Delete required' });
      }
      const [current] = await ctx.db
        .select({ id: packages.id, name: packages.name })
        .from(packages)
        .where(eq(packages.id, input.id))
        .limit(1);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });

      // Runs are FK-restricted onto packages — blocking here gives a clearer
      // error than a raw pg constraint violation.
      const [row] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(packageRuns)
        .where(eq(packageRuns.packageId, input.id));
      const count = row?.count ?? 0;
      if (count > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot delete — this package has ${count} run${count === 1 ? '' : 's'} in history. Archive it instead.`,
        });
      }

      await ctx.db.delete(packages).where(eq(packages.id, input.id));

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'delete',
        actionLabel: ActionLabels.PackageDelete,
        targetType: 'package',
        targetId: input.id,
        targetLabel: current.name,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { hard: true },
      });

      return { id: input.id };
    }),

  duplicate: authProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Write required' });
      }
      const [source] = await ctx.db
        .select()
        .from(packages)
        .where(eq(packages.id, input.id))
        .limit(1);
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });

      const inserted = await ctx.db
        .insert(packages)
        .values({
          name: `${source.name} (copy)`,
          description: source.description,
          status: 'draft',
          version: 1,
          steps: source.steps,
          failureActions: source.failureActions,
          authorUserId: ctx.user.id,
        })
        .returning({ id: packages.id });
      const row = inserted[0]!;

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'create',
        actionLabel: ActionLabels.PackageCreate,
        targetType: 'package',
        targetId: row.id,
        targetLabel: `${source.name} (copy)`,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { duplicatedFrom: source.id },
      });

      return { id: row.id };
    }),

  // Options for a Select control keyed to an entityType. Used by the runtime
  // input dialog + the builder's entity binding editor. Filtered by parent
  // link where relevant so downstream pickers cascade from a chosen tenant.
  entityOptions: authProcedure
    .input(
      z.object({
        entityType: entityTypeSchema,
        packageId: z.uuid().optional(),
        integrationLinkId: z.uuid().optional(),
        integrationId: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ ctx, input }): Promise<EntityOption[]> => {
      let scopedLinkIds: Set<string> | null = null;
      if (input.packageId) {
        const [pkg] = await ctx.db
          .select({
            allowedSites: packages.allowedSites,
            allowedSiteGroups: packages.allowedSiteGroups,
            allowedIntegrationLinks: packages.allowedIntegrationLinks,
          })
          .from(packages)
          .where(eq(packages.id, input.packageId))
          .limit(1);
        if (!pkg) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });
        }

        const scope = readPackageScope(pkg);
        if (scope.links.length > 0 || scope.groups.length > 0) {
          const groupLinkRows =
            scope.groups.length > 0
              ? await ctx.db
                  .select({ integrationLinkId: siteGroupLinkMembers.integrationLinkId })
                  .from(siteGroupLinkMembers)
                  .where(inArray(siteGroupLinkMembers.siteGroupId, scope.groups))
              : [];
          scopedLinkIds = new Set([
            ...scope.links,
            ...groupLinkRows.map((row) => row.integrationLinkId),
          ]);
        }
      }

      if (input.entityType === 'integration_link') {
        // Only offer links that are actually usable — status='active' means
        // the tenant is connected and healthy. Error/disabled/dispositioned
        // links can't be run against.
        const filters = [eq(integrationLinks.status, 'active')];
        if (input.integrationId) {
          filters.push(eq(integrationLinks.integrationId, input.integrationId));
        }
        const rows = await ctx.db
          .select({
            id: integrationLinks.id,
            name: integrationLinks.name,
            integrationId: integrationLinks.integrationId,
          })
          .from(integrationLinks)
          .where(and(...filters))
          .orderBy(asc(integrationLinks.name))
          .limit(input.limit);
        return rows
          .filter((r) => (scopedLinkIds ? scopedLinkIds.has(r.id) : true))
          .map((r) => ({
          id: r.id,
          label: r.name ?? r.id,
          subLabel: r.integrationId,
          }));
      }

      if (input.entityType === 'm365_identity') {
        const filters = [];
        if (input.integrationLinkId) {
          filters.push(eq(m365Identities.linkId, input.integrationLinkId));
        }
        const rows = await ctx.db
          .select({
            id: m365Identities.id,
            name: m365Identities.name,
            email: m365Identities.email,
          })
          .from(m365Identities)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(asc(m365Identities.email))
          .limit(input.limit);
        return rows.map((r) => ({
          id: r.id,
          label: r.email || r.name || r.id,
          subLabel: r.email ? r.name : undefined,
        }));
      }

      if (input.entityType === 'm365_group') {
        const filters = [];
        if (input.integrationLinkId) {
          filters.push(eq(m365Groups.linkId, input.integrationLinkId));
        }
        const rows = await ctx.db
          .select({ externalId: m365Groups.externalId, name: m365Groups.name })
          .from(m365Groups)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(asc(m365Groups.name))
          .limit(input.limit);
        return rows.map((r) => ({ id: r.externalId, label: r.name ?? r.externalId }));
      }

      if (input.entityType === 'm365_role') {
        // Roles are global (no linkId) — all tenants share the same Azure AD built-in role templates.
        const rows = await ctx.db
          .select({ templateId: m365Roles.templateId, name: m365Roles.name })
          .from(m365Roles)
          .orderBy(asc(m365Roles.name))
          .limit(input.limit);
        return rows.map((r) => ({ id: r.templateId, label: r.name ?? r.templateId }));
      }

      if (input.entityType === 'm365_license') {
        const filters = [];
        if (input.integrationLinkId) {
          filters.push(eq(m365Licenses.linkId, input.integrationLinkId));
        }
        // Return the friendly name (e.g. "Microsoft 365 Business Standard") as
        // the label + a live availability count as subLabel — matches the UX
        // of the "Manage licenses" dialog rather than surfacing raw SKU strings.
        const rows = await ctx.db
          .select({
            skuId: m365Licenses.skuId,
            skuPartNumber: m365Licenses.skuPartNumber,
            friendlyName: m365Licenses.friendlyName,
            totalUnits: m365Licenses.totalUnits,
            consumedUnits: m365Licenses.consumedUnits,
            enabled: m365Licenses.enabled,
          })
          .from(m365Licenses)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(asc(m365Licenses.friendlyName))
          .limit(input.limit);
        return rows
          .filter((r) => r.enabled !== false)
          .map((r) => {
            const available = Math.max(0, r.totalUnits - r.consumedUnits);
            return {
              id: r.skuId,
              label: r.friendlyName || r.skuPartNumber,
              subLabel: `${available} of ${r.totalUnits} available`,
              disabled: available === 0,
            };
          });
      }

      return [];
    }),

  // Static registry metadata for the builder UI (Phase 2). Exposed now so the
  // frontend can render "which capability does this run" labels without
  // duplicating the registry.
  capabilities: authProcedure.query(() => {
    return listCapabilities().map((capability) => ({
      id: capability.id,
      vendor: capability.vendor,
      name: capability.name,
      description: capability.description,
      category: capability.category,
      inputMeta: capability.inputMeta,
      outputMeta: capability.outputMeta,
      defaultUnitPrice: capability.defaultUnitPrice,
    }));
  }),

  // Generator registry surfaced to the builder UI so it can render the
  // per-generator params widget (length, symbols, …) without hardcoding it.
  generators: authProcedure.query(() => {
    return listGenerators().map((g) => ({
      id: g.id,
      label: g.label,
      description: g.description,
      appliesToTypeHints: g.appliesToTypeHints,
      defaults: g.defaults,
    }));
  }),

  // Declared site profile fields — the fact-key catalog for the builder's
  // siteFact source picker. Filtered to active only so retired fields don't
  // appear as valid targets.
  siteFactFields: authProcedure.query(async ({ ctx }) => {
    if (!ctx.can('Packages.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
    }
    return ctx.db
      .select({
        key: siteProfileFields.key,
        label: siteProfileFields.label,
        type: siteProfileFields.type,
        valueMode: siteProfileFields.valueMode,
        section: siteProfileFields.section,
      })
      .from(siteProfileFields)
      .where(eq(siteProfileFields.active, true))
      .orderBy(siteProfileFields.section, siteProfileFields.displayOrder, siteProfileFields.label);
  }),
});
