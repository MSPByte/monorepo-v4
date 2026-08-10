import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import {
  customerLogs,
  packageRuns,
  packageRunSteps,
  packages as packagesTable,
  siteGroupMembers,
} from '@mspbyte/drizzle';
import { TRPCError } from '@trpc/server';
import { generatePassword, getCapability } from '@mspbyte/capabilities';
import { createPendingPackageRun } from '@mspbyte/pipeline';
import { Encryption } from '@mspbyte/encryption';
import { ActionLabels } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';

const runtimeInputsSchema = z.record(z.string(), z.unknown()).default({});

// Client sends this from the run dialog when the operator picks "generate a
// password" mode on a runtime-bound password field. Server swaps it for a
// real generated password before persistence so downstream (worker, Graph,
// audit) never see the sentinel.
const GENERATE_PASSWORD_SENTINEL = '__generate__';

export const packageRunsRouter = t.router({
  list: authProcedure
    .input(
      z
        .object({
          packageId: z.uuid().optional(),
          siteId: z.uuid().optional(),
          status: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .default({ limit: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [];
      if (input.packageId) filters.push(eq(packageRuns.packageId, input.packageId));
      if (input.siteId) filters.push(eq(packageRuns.siteId, input.siteId));
      if (input.status) filters.push(eq(packageRuns.status, input.status as any));

      return ctx.db
        .select({
          id: packageRuns.id,
          packageId: packageRuns.packageId,
          packageName: packagesTable.name,
          packageVersion: packageRuns.packageVersion,
          status: packageRuns.status,
          siteId: packageRuns.siteId,
          linkId: packageRuns.linkId,
          triggerType: packageRuns.triggerType,
          triggeredByUserId: packageRuns.triggeredByUserId,
          startedAt: packageRuns.startedAt,
          finishedAt: packageRuns.finishedAt,
          createdAt: packageRuns.createdAt,
          billingTotal: packageRuns.billingTotal,
        })
        .from(packageRuns)
        .leftJoin(packagesTable, eq(packageRuns.packageId, packagesTable.id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(packageRuns.createdAt))
        .limit(input.limit);
    }),

  get: authProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const [run] = await ctx.db
        .select()
        .from(packageRuns)
        .where(eq(packageRuns.id, input.id))
        .limit(1);
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

      const steps = await ctx.db
        .select()
        .from(packageRunSteps)
        .where(eq(packageRunSteps.packageRunId, input.id));

      steps.sort((a: typeof steps[number], b: typeof steps[number]) => a.position - b.position);

      return { run, steps };
    }),

  start: authProcedure
    .input(
      z.object({
        packageId: z.uuid(),
        linkId: z.uuid().optional().nullable(),
        siteId: z.uuid().optional().nullable(),
        runtimeInputs: runtimeInputsSchema,
        // Optional partial-execution entry point. Refused if any step >= N has
        // a priorOutput binding referencing step < N (nothing to seed from).
        startStepIndex: z.number().int().min(0).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Execution reuses Vendors.Write since capabilities wrap direct vendor
      // actions that already require it — Packages don't lower the security bar.
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write required' });
      }

      const [pkg] = await ctx.db
        .select()
        .from(packagesTable)
        .where(eq(packagesTable.id, input.packageId))
        .limit(1);
      if (!pkg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });
      if (pkg.status !== 'active') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Package is not active' });
      }

      // Scope enforcement: if the package restricts sites/groups, the run's
      // siteId must satisfy one of them. Global packages (both empty) skip
      // this check entirely.
      const allowedSites = (pkg.allowedSites ?? []) as string[];
      const allowedGroups = (pkg.allowedSiteGroups ?? []) as string[];
      const isScoped = allowedSites.length > 0 || allowedGroups.length > 0;
      if (isScoped) {
        if (!input.siteId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This package is scoped to specific sites — pick a site to run against.',
          });
        }
        let allowed = allowedSites.includes(input.siteId);
        if (!allowed && allowedGroups.length > 0) {
          const groupRows = await ctx.db
            .select({ groupId: siteGroupMembers.siteGroupId })
            .from(siteGroupMembers)
            .where(eq(siteGroupMembers.siteId, input.siteId));
          const memberOf = new Set(groupRows.map((r) => r.groupId));
          allowed = allowedGroups.some((g) => memberOf.has(g));
        }
        if (!allowed) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'This package is not permitted to run against the selected site.',
          });
        }
      }

      type Binding =
        | { kind: 'literal'; value: unknown }
        | { kind: 'runtime'; promptKey: string; required: boolean }
        | { kind: 'entity'; source: string; entityType: string }
        | { kind: 'priorOutput'; stepPosition: number; path: string };
      type StoredStep = {
        capabilityId: string;
        inputBindings: Record<string, Binding>;
      };
      const steps = (pkg.steps as StoredStep[]) ?? [];
      if (steps.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Package has no steps' });
      }
      if (input.startStepIndex >= steps.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Start step index out of range' });
      }

      // Guard: starting mid-package without a parent run means priorOutput
      // bindings that reference skipped steps have nowhere to read from.
      if (input.startStepIndex > 0) {
        for (let pos = input.startStepIndex; pos < steps.length; pos++) {
          const step = steps[pos]!;
          for (const [name, binding] of Object.entries(step.inputBindings)) {
            if (binding.kind === 'priorOutput' && binding.stepPosition < input.startStepIndex) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Step ${pos + 1} input "${name}" needs step ${
                  binding.stepPosition + 1
                }'s output — start from step ${binding.stepPosition + 1} or earlier, or retry from an existing run.`,
              });
            }
          }
        }
      }

      const materializedInputs = materializeGeneratedRuntimeInputs(
        input.runtimeInputs,
        steps,
      );

      // Encrypt sensitive runtime inputs before persisting, using each
      // referenced capability's inputMeta to know which fields are sensitive.
      const runtimeInputs = encryptRuntimeInputs(
        materializedInputs,
        steps,
        ctx.encryptionKey ?? '',
      );

      const billingSnapshot = {
        currency: 'USD',
        steps: steps.map((step, position) => {
          const capability = getCapability(step.capabilityId);
          return {
            position,
            capabilityId: step.capabilityId,
            unitPrice: capability?.defaultUnitPrice ?? 0,
            billable: true,
            priceSource: 'default',
          };
        }),
        capturedAt: new Date().toISOString(),
      };

      const packageSnapshot = {
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        steps: pkg.steps,
        failureActions: pkg.failureActions ?? [],
      };

      // The tRPC caller only creates the pending row — no Redis contact.
      // backend/packages polls pending rows per-org and pushes to BullMQ.
      const result = await createPendingPackageRun(ctx.db, {
        packageId: pkg.id,
        packageVersion: pkg.version,
        packageSnapshot,
        linkId: input.linkId ?? null,
        siteId: input.siteId ?? null,
        triggerType: 'manual',
        triggeredByUserId: ctx.user.id,
        runtimeInputs,
        billingSnapshot,
        startStepIndex: input.startStepIndex,
      });

      await ctx.db.insert(customerLogs).values({
        siteId: input.siteId ?? null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'create',
        actionLabel: ActionLabels.PackageRunStart,
        targetType: 'package_run',
        targetId: result.packageRunId,
        targetLabel: pkg.name,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          packageId: pkg.id,
          packageVersion: pkg.version,
        },
      });

      return result;
    }),

  cancel: authProcedure
    .input(z.object({ runId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write required' });
      }
      const [current] = await ctx.db
        .select({ id: packageRuns.id, status: packageRuns.status, siteId: packageRuns.siteId })
        .from(packageRuns)
        .where(eq(packageRuns.id, input.runId))
        .limit(1);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

      const cancelableStatuses = new Set(['pending', 'queued', 'running']);
      if (!cancelableStatuses.has(current.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Run is ${current.status} — cannot cancel`,
        });
      }

      // Worker polls status between steps and bails cleanly. The queued
      // BullMQ job is not removed — the worker sees the canceled status and
      // exits without executing further steps.
      await ctx.db
        .update(packageRuns)
        .set({ status: 'canceled', finishedAt: new Date().toISOString() })
        .where(eq(packageRuns.id, input.runId));

      await ctx.db.insert(customerLogs).values({
        siteId: current.siteId,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'update',
        actionLabel: ActionLabels.PackageRunStart,
        targetType: 'package_run',
        targetId: input.runId,
        targetLabel: 'cancel',
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { previousStatus: current.status },
      });

      return { id: input.runId };
    }),

  retryFromStep: authProcedure
    .input(
      z.object({
        runId: z.uuid(),
        stepPosition: z.number().int().min(0),
        overrideRuntimeInputs: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write required' });
      }

      const [original] = await ctx.db
        .select()
        .from(packageRuns)
        .where(eq(packageRuns.id, input.runId))
        .limit(1);
      if (!original) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

      const terminalStatuses = new Set(['completed', 'failed', 'halted', 'partial']);
      if (!terminalStatuses.has(original.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot retry a run in status ${original.status}`,
        });
      }
      // Retry-from-step-N > 0 needs sensitive fields on prior steps to still be
      // decryptable. Refuse rather than silently fail deep in the worker.
      if (input.stepPosition > 0 && original.sensitiveOutputsPurgedAt) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Original run outputs have been purged and cannot be replayed',
        });
      }

      const snapshot = original.packageSnapshot as {
        steps: Array<{ capabilityId: string; inputBindings?: Record<string, { kind: string; promptKey?: string }> }>;
      };
      if (input.stepPosition >= snapshot.steps.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Step position out of range' });
      }

      const originalRuntimeInputs = (original.runtimeInputs ?? {}) as Record<string, unknown>;
      const materializedOverrides = materializeGeneratedRuntimeInputs(
        input.overrideRuntimeInputs,
        snapshot.steps as Array<{ capabilityId: string; inputBindings?: Record<string, unknown> }>,
      );
      // Runtime inputs are already encrypted-at-rest for sensitive fields;
      // encrypt any newly overridden sensitive ones the same way.
      const encryptedOverrides = encryptRuntimeInputs(
        materializedOverrides,
        snapshot.steps,
        ctx.encryptionKey ?? '',
      );
      const mergedRuntimeInputs = { ...originalRuntimeInputs, ...encryptedOverrides };

      const billingSnapshot = original.billingSnapshot;

      const result = await createPendingPackageRun(ctx.db, {
        packageId: original.packageId,
        packageVersion: original.packageVersion,
        packageSnapshot: original.packageSnapshot,
        linkId: original.linkId,
        siteId: original.siteId,
        triggerType: 'manual',
        triggerRef: { retryOf: original.id, retryFromStep: input.stepPosition },
        triggeredByUserId: ctx.user.id,
        runtimeInputs: mergedRuntimeInputs,
        billingSnapshot,
        parentRunId: original.id,
        startStepIndex: input.stepPosition,
      });

      return result;
    }),

  revealOutput: authProcedure
    .input(
      z.object({
        runStepId: z.uuid(),
        outputPath: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Vendors.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Vendors.Write required' });
      }
      const [step] = await ctx.db
        .select()
        .from(packageRunSteps)
        .where(eq(packageRunSteps.id, input.runStepId))
        .limit(1);
      if (!step) throw new TRPCError({ code: 'NOT_FOUND', message: 'Step not found' });

      const [run] = await ctx.db
        .select({
          id: packageRuns.id,
          siteId: packageRuns.siteId,
          sensitiveOutputsPurgedAt: packageRuns.sensitiveOutputsPurgedAt,
        })
        .from(packageRuns)
        .where(eq(packageRuns.id, step.packageRunId))
        .limit(1);
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      if (run.sensitiveOutputsPurgedAt) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Sensitive outputs have expired' });
      }

      const outputs = (step.outputs ?? {}) as Record<string, unknown>;
      const encryptedValue = outputs[input.outputPath];
      if (typeof encryptedValue !== 'string') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Output not found' });
      }
      const decrypted = Encryption.decrypt(encryptedValue, ctx.encryptionKey ?? '');
      if (decrypted === undefined) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to decrypt' });
      }

      // Every reveal is audited — compliance surface for "who saw the temp
      // password".
      await ctx.db.insert(customerLogs).values({
        siteId: run.siteId,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'update',
        actionLabel: ActionLabels.PackageRunRevealOutput,
        targetType: 'package_run_step',
        targetId: step.id,
        targetLabel: input.outputPath,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { packageRunId: run.id, outputPath: input.outputPath },
      });

      return { value: JSON.parse(decrypted) as unknown };
    }),
});

// Walks the referenced steps to find password-typeHint inputs that were left
// as runtime bindings. If the operator sent the "__generate__" sentinel for
// such a promptKey, replace it with a real generated password using the
// same defaults as the builder's generator widget.
function materializeGeneratedRuntimeInputs(
  inputs: Record<string, unknown>,
  steps: Array<{ capabilityId: string; inputBindings?: Record<string, unknown> }>,
): Record<string, unknown> {
  const passwordPromptKeys = new Set<string>();
  for (const step of steps) {
    const capability = getCapability(step.capabilityId);
    if (!capability) continue;
    const bindings = (step.inputBindings ?? {}) as Record<
      string,
      { kind?: string; promptKey?: string }
    >;
    for (const [inputName, binding] of Object.entries(bindings)) {
      if (binding.kind !== 'runtime') continue;
      const meta = capability.inputMeta[inputName];
      if (meta?.typeHint !== 'password') continue;
      passwordPromptKeys.add(binding.promptKey ?? inputName);
    }
  }
  if (passwordPromptKeys.size === 0) return inputs;
  const out: Record<string, unknown> = { ...inputs };
  for (const key of passwordPromptKeys) {
    if (out[key] === GENERATE_PASSWORD_SENTINEL) {
      out[key] = generatePassword({ length: 20, symbols: true, excludeAmbiguous: false });
    }
  }
  return out;
}

function encryptRuntimeInputs(
  inputs: Record<string, unknown>,
  steps: Array<{ capabilityId: string }>,
  encryptionKey: string,
): Record<string, unknown> {
  const sensitiveKeys = new Set<string>();
  for (const step of steps) {
    const capability = getCapability(step.capabilityId);
    if (!capability) continue;
    for (const [name, meta] of Object.entries(capability.inputMeta)) {
      if (meta.sensitive) sensitiveKeys.add(name);
    }
  }
  const out: Record<string, unknown> = { ...inputs };
  for (const key of sensitiveKeys) {
    if (out[key] === undefined || out[key] === null) continue;
    out[key] = Encryption.encrypt(JSON.stringify(out[key]), encryptionKey);
  }
  return out;
}
