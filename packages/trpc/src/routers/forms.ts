import { z } from 'zod';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { agentForms, packages } from '@mspbyte/drizzle';
import { capabilityCandidates } from '@mspbyte/drizzle-catalog';
import {
  collectPackageRuntimeInputs,
  validateFormPackageBindings,
  type ResolvedInputMeta,
  type AgentFieldType,
  type AgentFormPackageBindings,
} from '@mspbyte/shared';
import { getCapability } from '@mspbyte/capabilities';
import { t, authProcedure } from '../trpc.js';
import type { Context } from '../context.js';

const FieldSchema = z.object({
  id: z.string(),
  // 'image' and 'screenshot' kept for backward compat — normalised to 'attachment' on read by the frontend.
  type: z.enum(['spacer', 'title', 'text', 'textarea', 'select', 'email', 'phone', 'checkbox', 'number', 'date', 'attachment', 'image', 'screenshot']),
  label: z.string().default(''),
  required: z.boolean().default(false),
  col_span: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  subtitle: z.string().optional(),
  // hydration: slug referenced as {{hydrationKey}} in ticket templates
  hydrationKey: z.string().optional(),
  // psa: which PSA ticket field this field drives
  psaMetric: z.string().optional(),
  // select: per-option PSA value map { optionValue → psaValue }
  optionMappings: z.record(z.string(), z.string()).optional(),
  // select: manual or PSA-sourced options
  selectOptions: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  psaSource: z.string().optional(),
  // legacy string options (backward compat)
  options: z.array(z.string()).optional(),
  // attachment
  allowUpload: z.boolean().optional(),
  allowScreenshot: z.boolean().optional(),
  maxSizeMb: z.number().optional(),
});

const RowSchema = z.object({
  id: z.string().optional(),
  cols_max: z.union([z.literal(2), z.literal(3)]).default(3),
  cols: z.array(FieldSchema),
});

const PsaMappingEntrySchema = z.object({
  psa_field: z.string(),
});

// promptKey → where the value comes from at submit time.
const InputSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('formField'), fieldId: z.string() }),
  z.object({
    kind: z.literal('system'),
    key: z.enum(['ticket_id', 'entra_upn', 'entra_oid', 'entra_display_name', 'device_hostname', 'os_user', 'site_id']),
  }),
  z.object({ kind: z.literal('literal'), value: z.unknown() }),
]);

const PackageBindingsSchema = z.record(z.string(), InputSourceSchema);

type FormRows = Array<z.infer<typeof RowSchema>>;

// Save-time gate for a form → package link. Rejecting bad links here keeps
// the agent submit path free of guesswork: a stored link is always runnable.
async function assertValidPackageLink(
  ctx: Context,
  packageId: string,
  bindings: AgentFormPackageBindings,
  rows: FormRows,
): Promise<void> {
  if (!ctx.can('Packages.Read')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read permission required to link a package' });
  }

  const [pkg] = await ctx.db
    .select({
      id: packages.id,
      status: packages.status,
      steps: packages.steps,
      outcomeSteps: packages.outcomeSteps,
      prompts: packages.prompts,
    })
    .from(packages)
    .where(eq(packages.id, packageId))
    .limit(1);
  if (!pkg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Linked package not found' });
  if (pkg.status !== 'active') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only active packages can be triggered from a form' });
  }

  // Resolve inputMeta for every referenced capability: code registry first,
  // then approved/live catalog candidates.
  const capabilityIds = new Set<string>();
  const lanes = [
    (pkg.steps as Array<{ kind?: string; capabilityId?: string }>) ?? [],
    ...(Object.values((pkg.outcomeSteps as Record<string, unknown[]>) ?? {}) as Array<
      Array<{ kind?: string; capabilityId?: string }>
    >),
  ];
  for (const lane of lanes) {
    for (const step of lane) {
      if (step?.capabilityId && step.kind !== 'subpackage' && !getCapability(step.capabilityId)) {
        capabilityIds.add(step.capabilityId);
      }
    }
  }
  const catalogMeta = new Map<string, ResolvedInputMeta>();
  if (capabilityIds.size > 0) {
    const rows = await ctx.catalogDb
      .select({ id: capabilityCandidates.id, inputMeta: capabilityCandidates.inputMeta })
      .from(capabilityCandidates)
      .where(
        and(
          inArray(capabilityCandidates.id, [...capabilityIds]),
          inArray(capabilityCandidates.lifecycleStatus, ['approved', 'live']),
        ),
      );
    for (const row of rows) catalogMeta.set(row.id, (row.inputMeta ?? {}) as ResolvedInputMeta);
  }

  const collection = collectPackageRuntimeInputs(pkg, (id) => {
    const code = getCapability(id);
    if (code) return code.inputMeta as ResolvedInputMeta;
    return catalogMeta.get(id) ?? null;
  });

  const formFieldTypes: Record<string, AgentFieldType> = {};
  for (const row of rows) {
    for (const col of row.cols) {
      if (col.type !== 'spacer' && col.type !== 'title' && col.type !== 'attachment') {
        formFieldTypes[col.id] = col.type as AgentFieldType;
      }
    }
  }

  const errors = validateFormPackageBindings({ collection, bindings, formFieldTypes });
  if (errors.length > 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: errors.join('; ') });
  }
}

export const formsRouter = t.router({
  list: authProcedure.query(async ({ ctx }) => {
    if (!ctx.can('Agents.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
    }

    return ctx.db
      .select({
        id: agentForms.id,
        name: agentForms.name,
        description: agentForms.description,
        packageId: agentForms.packageId,
        packageName: packages.name,
        createdAt: agentForms.createdAt,
        updatedAt: agentForms.updatedAt,
      })
      .from(agentForms)
      .leftJoin(packages, eq(agentForms.packageId, packages.id))
      .where(isNull(agentForms.deletedAt))
      .orderBy(desc(agentForms.updatedAt));
  }),

  get: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
      }

      const [row] = await ctx.db
        .select()
        .from(agentForms)
        .where(and(eq(agentForms.id, input.id), isNull(agentForms.deletedAt)))
        .limit(1);

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  create: authProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      rows: z.array(RowSchema).default([]),
      ticketTitle: z.string().optional(),
      ticketBody: z.string().optional(),
      psaMappings: z.record(z.string(), PsaMappingEntrySchema).default({}),
      packageId: z.string().uuid().nullable().optional(),
      packageBindings: PackageBindingsSchema.default({}),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
      }

      if (input.packageId) {
        await assertValidPackageLink(ctx, input.packageId, input.packageBindings, input.rows);
      }

      const [row] = await ctx.db
        .insert(agentForms)
        .values({
          name: input.name,
          description: input.description ?? null,
          rows: input.rows,
          ticketTitle: input.ticketTitle ?? null,
          ticketBody: input.ticketBody ?? null,
          psaMappings: input.psaMappings,
          packageId: input.packageId ?? null,
          packageBindings: input.packageId ? input.packageBindings : {},
          createdBy: ctx.user.id,
        })
        .returning({ id: agentForms.id });

      return row;
    }),

  update: authProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      rows: z.array(RowSchema).optional(),
      ticketTitle: z.string().nullable().optional(),
      ticketBody: z.string().nullable().optional(),
      psaMappings: z.record(z.string(), PsaMappingEntrySchema).optional(),
      packageId: z.string().uuid().nullable().optional(),
      packageBindings: PackageBindingsSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
      }

      const { id, ...fields } = input;

      // Validate the link against the *effective* post-update state, since
      // any of packageId / bindings / rows may arrive partially.
      if (input.packageId !== undefined || input.packageBindings !== undefined || input.rows !== undefined) {
        const [existing] = await ctx.db
          .select({
            packageId: agentForms.packageId,
            packageBindings: agentForms.packageBindings,
            rows: agentForms.rows,
          })
          .from(agentForms)
          .where(and(eq(agentForms.id, id), isNull(agentForms.deletedAt)))
          .limit(1);
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

        const effectivePackageId = input.packageId !== undefined ? input.packageId : existing.packageId;
        if (effectivePackageId) {
          await assertValidPackageLink(
            ctx,
            effectivePackageId,
            (input.packageBindings ?? existing.packageBindings ?? {}) as AgentFormPackageBindings,
            (input.rows ?? existing.rows ?? []) as FormRows,
          );
        }
      }
      // Unlinking clears the bindings with it.
      if (input.packageId === null) fields.packageBindings = {};

      const now = new Date().toISOString();

      await ctx.db
        .update(agentForms)
        .set({ ...fields, updatedAt: now })
        .where(and(eq(agentForms.id, id), isNull(agentForms.deletedAt)));

      return { ok: true };
    }),

  delete: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Delete permission required' });
      }

      const now = new Date().toISOString();
      await ctx.db
        .update(agentForms)
        .set({ deletedAt: now })
        .where(and(eq(agentForms.id, input.id), isNull(agentForms.deletedAt)));

      return { ok: true };
    }),
});
