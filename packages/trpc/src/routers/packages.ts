import { z } from 'zod';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  customerLogs,
  integrationLinks,
  m365Groups,
  m365Identities,
  m365Licenses,
  packages,
} from '@mspbyte/drizzle';
import { getCapability, listCapabilities } from '@mspbyte/capabilities';
import { ActionLabels } from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';

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
]);

const stepSchema = z.object({
  capabilityId: z.string().min(1),
  label: z.string().optional(),
  inputBindings: z.record(z.string(), bindingSchema),
});
type ParsedStep = z.infer<typeof stepSchema>;

const packageInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  steps: z.array(stepSchema).min(1),
});

const entityTypeSchema = z.enum([
  'integration_link',
  'm365_identity',
  'm365_group',
  'm365_license',
]);
type EntityOption = { id: string; label: string; subLabel?: string };

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
    }
  }
  return null;
}

export const packagesRouter = t.router({
  list: authProcedure.query(async ({ ctx }) => {
    if (!ctx.can('Packages.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
    }
    return ctx.db
      .select({
        id: packages.id,
        name: packages.name,
        description: packages.description,
        status: packages.status,
        version: packages.version,
        steps: packages.steps,
        createdAt: packages.createdAt,
        updatedAt: packages.updatedAt,
      })
      .from(packages)
      .orderBy(desc(packages.updatedAt));
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

      const inserted = await ctx.db
        .insert(packages)
        .values({
          name: input.name,
          description: input.description ?? null,
          status: input.status,
          version: 1,
          steps: input.steps,
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

  // Options for a Select control keyed to an entityType. Used by the runtime
  // input dialog + the builder's entity binding editor. Filtered by parent
  // link where relevant so downstream pickers cascade from a chosen tenant.
  entityOptions: authProcedure
    .input(
      z.object({
        entityType: entityTypeSchema,
        integrationLinkId: z.uuid().optional(),
        integrationId: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ ctx, input }): Promise<EntityOption[]> => {
      if (input.entityType === 'integration_link') {
        const filters = [];
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
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(asc(integrationLinks.name))
          .limit(input.limit);
        return rows.map((r) => ({
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
          .select({ id: m365Groups.id, name: m365Groups.name })
          .from(m365Groups)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(asc(m365Groups.name))
          .limit(input.limit);
        return rows.map((r) => ({ id: r.id, label: r.name ?? r.id }));
      }

      if (input.entityType === 'm365_license') {
        const filters = [];
        if (input.integrationLinkId) {
          filters.push(eq(m365Licenses.linkId, input.integrationLinkId));
        }
        const rows = await ctx.db
          .select({
            id: m365Licenses.externalId,
            skuPartNumber: m365Licenses.skuPartNumber,
          })
          .from(m365Licenses)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(asc(m365Licenses.skuPartNumber))
          .limit(input.limit);
        // For m365_license the id we return is the skuId (externalId) — that's
        // the value the license.assign capability actually needs.
        return rows.map((r) => ({
          id: r.id,
          label: r.skuPartNumber,
        }));
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
});
