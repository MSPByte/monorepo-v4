import { z } from 'zod';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import {
  customerLogs,
  integrationLinks,
  packageRuns,
  packageRunSteps,
  packageSchedules,
  packages as packagesTable,
  sites,
  users,
} from '@mspbyte/drizzle';
import { TRPCError } from '@trpc/server';
import { generatePassword, getCapability } from '@mspbyte/capabilities';
import { buildEmbeddedChildren, createPendingPackageRun } from '@mspbyte/pipeline';
import { Encryption } from '@mspbyte/encryption';
import { ActionLabels } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import { loadMatchingGroupIds, packageMatchesScope, readPackageScope } from './package-scope.js';

const runtimeInputsSchema = z.record(z.string(), z.unknown()).default({});
const scheduleRunInputStateSchema = z.object({
  // These are UI choices which alter how runtime values are interpreted. They
  // belong in the schedule snapshot alongside the values themselves.
  siteModes: z.record(z.string(), z.enum(['select', 'create'])).default({}),
  skippedStepIndexes: z.array(z.number().int().min(0)).default([]),
}).default({ siteModes: {}, skippedStepIndexes: [] });

// Client sends this from the run dialog when the operator picks "generate a
// password" mode on a runtime-bound password field. Server swaps it for a
// real generated password before persistence so downstream (worker, Graph,
// audit) never see the sentinel.
const GENERATE_PASSWORD_SENTINEL = '__generate__';

const scheduleLocalTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use a date and time');

function localTimeParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (!year || !month || !day || hour === undefined || minute === undefined) return null;
  return { year, month, day, hour, minute };
}

function formatPartsInZone(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const number = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number('year'), month: number('month'), day: number('day'), hour: number('hour'), minute: number('minute') };
}

// Converts the local wall-clock time the operator chose into one instant.
// The round-trip catches nonexistent times during DST's spring transition;
// ambiguous autumn times resolve to the first valid occurrence.
function scheduledInstant(localTime: string, timeZone: string): string {
  const target = localTimeParts(localTime);
  if (!target) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid scheduled date and time.' });
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a valid IANA time zone.' });
  }
  let guess = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  for (let i = 0; i < 4; i++) {
    const actual = formatPartsInZone(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    if (actualAsUtc === targetAsUtc) break;
    guess += targetAsUtc - actualAsUtc;
  }
  const roundTrip = formatPartsInZone(new Date(guess), timeZone);
  if (
    roundTrip.year !== target.year || roundTrip.month !== target.month || roundTrip.day !== target.day ||
    roundTrip.hour !== target.hour || roundTrip.minute !== target.minute
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'That local time does not exist in the selected time zone. Choose another time.',
    });
  }
  return new Date(guess).toISOString();
}

function validateSkippedScheduleSteps(
  steps: Array<{ inputBindings?: Record<string, { kind?: string; stepPosition?: number }>; optional?: boolean }>,
  skippedStepIndexes: number[],
) {
  const wiredPositions = new Set<number>();
  for (const step of steps) {
    for (const binding of Object.values(step.inputBindings ?? {})) {
      if (binding.kind === 'priorOutput' && typeof binding.stepPosition === 'number') {
        wiredPositions.add(binding.stepPosition);
      }
    }
  }
  for (const index of skippedStepIndexes) {
    if (index >= steps.length) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Skipped step index ${index} is out of range.` });
    }
    const step = steps[index]!;
    if (!step.optional) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Step ${index + 1} is not optional and cannot be skipped.` });
    }
    if (wiredPositions.has(index)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Step ${index + 1} has downstream dependencies and cannot be skipped.` });
    }
  }
}

export const packageRunsRouter = t.router({
  schedules: authProcedure
    .input(z.object({ packageId: z.uuid().optional(), limit: z.number().int().min(1).max(200).default(100) }).default({ limit: 100 }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
      }
      const filters = input.packageId ? [eq(packageSchedules.packageId, input.packageId)] : [];
      const schedules = await ctx.db
        .select({
          id: packageSchedules.id,
          packageId: packageSchedules.packageId,
          packageName: packagesTable.name,
          packageRunId: packageRuns.id,
          packageVersion: packageSchedules.packageVersion,
          packageSnapshot: packageSchedules.packageSnapshot,
          runtimeInputs: packageSchedules.runtimeInputs,
          siteId: packageSchedules.siteId,
          siteName: sites.name,
          linkId: packageSchedules.linkId,
          linkName: integrationLinks.name,
          scheduledFor: packageSchedules.scheduledFor,
          scheduledLocalTime: packageSchedules.scheduledLocalTime,
          timeZone: packageSchedules.timeZone,
          status: packageSchedules.status,
          createdByUserId: packageSchedules.createdByUserId,
          createdAt: packageSchedules.createdAt,
        })
        .from(packageSchedules)
        .leftJoin(packagesTable, eq(packageSchedules.packageId, packagesTable.id))
        .leftJoin(packageRuns, eq(packageRuns.scheduleId, packageSchedules.id))
        .leftJoin(sites, eq(packageSchedules.siteId, sites.id))
        .leftJoin(integrationLinks, eq(packageSchedules.linkId, integrationLinks.id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(packageSchedules.scheduledFor))
        .limit(input.limit);
      const creatorIds = [...new Set(schedules.map((schedule) => schedule.createdByUserId))];
      const creators = creatorIds.length
        ? await ctx.db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, creatorIds))
        : [];
      const creatorLabels = new Map(
        creators.map((creator) => [creator.id, creator.name || creator.email]),
      );
      return schedules.map((schedule) => ({
        ...schedule,
        scheduledBy: creatorLabels.get(schedule.createdByUserId) ?? null,
      }));
    }),

  schedule: authProcedure
    .input(z.object({
      packageId: z.uuid(),
      siteId: z.uuid().nullable().optional(),
      linkId: z.uuid().nullable().optional(),
      runtimeInputs: runtimeInputsSchema,
      runInputState: scheduleRunInputStateSchema,
      scheduledLocalTime: scheduleLocalTimeSchema,
      timeZone: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Run')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Run required' });
      }
      const [pkg] = await ctx.db.select().from(packagesTable).where(eq(packagesTable.id, input.packageId)).limit(1);
      if (!pkg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });
      if (pkg.status !== 'active') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only active packages can be scheduled.' });
      }
      const target = { siteId: input.siteId ?? undefined, linkId: input.linkId ?? undefined };
      const scope = readPackageScope(pkg);
      if (!target.siteId && !target.linkId && !packageMatchesScope(scope, target, new Set())) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a target permitted by this package scope.' });
      }
      if (target.siteId || target.linkId) {
        const matchingGroupIds = await loadMatchingGroupIds(ctx.db, target);
        if (!packageMatchesScope(scope, target, matchingGroupIds)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'This package is not permitted for the selected target.' });
        }
      }

      const scheduledFor = scheduledInstant(input.scheduledLocalTime, input.timeZone);
      if (new Date(scheduledFor).getTime() <= Date.now()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a time in the future.' });
      }
      const steps = (pkg.steps as Array<{ capabilityId: string; inputBindings?: Record<string, unknown> }> | null) ?? [];
      validateSkippedScheduleSteps(steps as Array<{ inputBindings?: Record<string, { kind?: string; stepPosition?: number }>; optional?: boolean }>, input.runInputState.skippedStepIndexes);
      const outcomeSteps = (pkg.outcomeSteps as {
        onSuccess?: Array<{ capabilityId: string; inputBindings?: Record<string, unknown> }>;
        onFailure?: Array<{ capabilityId: string; inputBindings?: Record<string, unknown> }>;
      } | null) ?? {};
      // A schedule is a launch snapshot. Generate password choices now, when
      // the operator approves the snapshot, instead of leaving a sentinel for
      // the future worker to interpret.
      const runtimeInputs = materializeGeneratedRuntimeInputs(input.runtimeInputs, [
        ...steps,
        ...(outcomeSteps.onSuccess ?? []),
        ...(outcomeSteps.onFailure ?? []),
      ]);
      const billingSnapshot = {
        currency: 'USD',
        steps: steps.map((step, position) => ({
          position,
          capabilityId: step.capabilityId,
          unitPrice: getCapability(step.capabilityId)?.defaultUnitPrice ?? 0,
          billable: true,
          priceSource: 'default',
        })),
        capturedAt: new Date().toISOString(),
      };
      const children = await buildEmbeddedChildren(
        ctx.db,
        (pkg.steps as unknown[]) ?? [],
        (pkg.outcomeSteps as { onSuccess?: unknown[]; onFailure?: unknown[] } | null) ?? undefined,
      );
      const packageSnapshot = {
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        steps: pkg.steps,
        prompts: pkg.prompts ?? [],
        outcomeSteps: pkg.outcomeSteps ?? { onSuccess: [], onFailure: [] },
        failureActions: pkg.failureActions ?? [],
        exposedOutputs: pkg.exposedOutputs ?? [],
        children,
        skippedStepIndexes: input.runInputState.skippedStepIndexes,
        runInputState: input.runInputState,
        scheduledBy: ctx.user.name || ctx.user.email || ctx.user.id,
      };
      const [schedule] = await ctx.db
        .insert(packageSchedules)
        .values({
          packageId: pkg.id,
          packageVersion: pkg.version,
          packageSnapshot,
          siteId: input.siteId ?? null,
          linkId: input.linkId ?? null,
          runtimeInputs,
          billingSnapshot,
          scheduledLocalTime: input.scheduledLocalTime,
          timeZone: input.timeZone,
          scheduledFor,
          createdByUserId: ctx.user.id,
        })
        .returning({ id: packageSchedules.id, scheduledFor: packageSchedules.scheduledFor });

      await ctx.db.insert(customerLogs).values({
        siteId: input.siteId ?? null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'create',
        actionLabel: ActionLabels.PackageScheduleCreate,
        targetType: 'package_schedule',
        targetId: schedule!.id,
        targetLabel: pkg.name,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { packageId: pkg.id, packageVersion: pkg.version, scheduledFor, timeZone: input.timeZone },
      });
      return schedule!;
    }),

  updateSchedule: authProcedure
    .input(z.object({
      id: z.uuid(),
      siteId: z.uuid().nullable().optional(),
      linkId: z.uuid().nullable().optional(),
      runtimeInputs: runtimeInputsSchema,
      runInputState: scheduleRunInputStateSchema,
      scheduledLocalTime: scheduleLocalTimeSchema,
      timeZone: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Run')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Run required' });
      }
      const [schedule] = await ctx.db.select().from(packageSchedules).where(eq(packageSchedules.id, input.id)).limit(1);
      if (!schedule) throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      if (schedule.status !== 'scheduled') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Schedule is ${schedule.status} and can no longer be changed.` });
      }
      const [pkg] = await ctx.db.select().from(packagesTable).where(eq(packagesTable.id, schedule.packageId)).limit(1);
      if (pkg) {
        const target = { siteId: input.siteId ?? undefined, linkId: input.linkId ?? undefined };
        const scope = readPackageScope(pkg);
        if (!target.siteId && !target.linkId && !packageMatchesScope(scope, target, new Set())) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a target permitted by this package scope.' });
        }
        if (target.siteId || target.linkId) {
          const matchingGroupIds = await loadMatchingGroupIds(ctx.db, target);
          if (!packageMatchesScope(scope, target, matchingGroupIds)) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'This package is not permitted for the selected target.' });
          }
        }
      }
      const scheduledFor = scheduledInstant(input.scheduledLocalTime, input.timeZone);
      if (new Date(scheduledFor).getTime() <= Date.now()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose a time in the future.' });
      }
      const snapshotSteps = [
        ...(((schedule.packageSnapshot as { steps?: Array<{ capabilityId: string; inputBindings?: Record<string, unknown> }> })?.steps) ?? []),
        ...(((schedule.packageSnapshot as { outcomeSteps?: { onSuccess?: Array<{ capabilityId: string; inputBindings?: Record<string, unknown> }> } })?.outcomeSteps?.onSuccess) ?? []),
        ...(((schedule.packageSnapshot as { outcomeSteps?: { onFailure?: Array<{ capabilityId: string; inputBindings?: Record<string, unknown> }> } })?.outcomeSteps?.onFailure) ?? []),
      ];
      validateSkippedScheduleSteps(
        ((schedule.packageSnapshot as { steps?: Array<{ inputBindings?: Record<string, { kind?: string; stepPosition?: number }>; optional?: boolean }> })?.steps) ?? [],
        input.runInputState.skippedStepIndexes,
      );
      const runtimeInputs = materializeGeneratedRuntimeInputs(input.runtimeInputs, snapshotSteps);
      const packageSnapshot = {
        ...(schedule.packageSnapshot as Record<string, unknown>),
        skippedStepIndexes: input.runInputState.skippedStepIndexes,
        runInputState: input.runInputState,
      };
      const [updated] = await ctx.db
        .update(packageSchedules)
        .set({
          siteId: input.siteId ?? null,
          linkId: input.linkId ?? null,
          runtimeInputs,
          packageSnapshot,
          scheduledLocalTime: input.scheduledLocalTime,
          timeZone: input.timeZone,
          scheduledFor,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(packageSchedules.id, input.id), eq(packageSchedules.status, 'scheduled')))
        .returning({ id: packageSchedules.id });
      if (!updated) throw new TRPCError({ code: 'CONFLICT', message: 'This schedule is being dispatched.' });
      await ctx.db.insert(customerLogs).values({
        siteId: input.siteId ?? null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'update',
        actionLabel: ActionLabels.PackageScheduleUpdate,
        targetType: 'package_schedule',
        targetId: schedule.id,
        targetLabel: pkg?.name ?? String(schedule.packageId),
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { scheduledFor, timeZone: input.timeZone },
      });
      return updated;
    }),

  cancelSchedule: authProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Run')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Run required' });
      }
      const [schedule] = await ctx.db.select().from(packageSchedules).where(eq(packageSchedules.id, input.id)).limit(1);
      if (!schedule) throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      if (schedule.status !== 'scheduled') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Schedule is ${schedule.status} and can no longer be canceled.` });
      }
      const [canceled] = await ctx.db
        .update(packageSchedules)
        .set({ status: 'canceled', canceledByUserId: ctx.user.id, canceledAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .where(and(eq(packageSchedules.id, input.id), eq(packageSchedules.status, 'scheduled')))
        .returning({ id: packageSchedules.id });
      if (!canceled) throw new TRPCError({ code: 'CONFLICT', message: 'This schedule is being dispatched.' });

      await ctx.db.insert(customerLogs).values({
        siteId: schedule.siteId,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'update',
        actionLabel: ActionLabels.PackageScheduleCancel,
        targetType: 'package_schedule',
        targetId: schedule.id,
        targetLabel: String(schedule.packageId),
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return canceled;
    }),

  deleteSchedule: authProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Run')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Run required' });
      }
      const [schedule] = await ctx.db.select().from(packageSchedules).where(eq(packageSchedules.id, input.id)).limit(1);
      if (!schedule) throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      if (schedule.status !== 'scheduled' && schedule.status !== 'canceled') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only schedules that have not dispatched can be deleted. Dispatched schedules remain with their run history.',
        });
      }
      const [deleted] = await ctx.db
        .delete(packageSchedules)
        .where(and(eq(packageSchedules.id, input.id), eq(packageSchedules.status, schedule.status)))
        .returning({ id: packageSchedules.id });
      if (!deleted) throw new TRPCError({ code: 'CONFLICT', message: 'This schedule is being dispatched.' });

      await ctx.db.insert(customerLogs).values({
        siteId: schedule.siteId,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'delete',
        actionLabel: ActionLabels.PackageScheduleDelete,
        targetType: 'package_schedule',
        targetId: schedule.id,
        targetLabel: String(schedule.packageId),
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return deleted;
    }),

  list: authProcedure
    .input(
      z
        .object({
          packageId: z.uuid().optional(),
          siteId: z.uuid().optional(),
          status: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50)
        })
        .default({ limit: 50 })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
      }
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
          triggerSourceLabel: packageRuns.triggerSourceLabel,
          executionAttempt: packageRuns.executionAttempt,
          startedAt: packageRuns.startedAt,
          finishedAt: packageRuns.finishedAt,
          createdAt: packageRuns.createdAt,
          billingTotal: packageRuns.billingTotal
        })
        .from(packageRuns)
        .leftJoin(packagesTable, eq(packageRuns.packageId, packagesTable.id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(packageRuns.createdAt))
        .limit(input.limit);
    }),

  // Direct children of a run — used by the run detail view to render an
  // "expand into sub-run" link for each sub-package step (which carries its
  // parent position in triggerRef).
  listChildren: authProcedure
    .input(z.object({ parentRunId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
      }
      return ctx.db
        .select({
          id: packageRuns.id,
          packageId: packageRuns.packageId,
          packageName: packagesTable.name,
          status: packageRuns.status,
          triggerRef: packageRuns.triggerRef,
          startedAt: packageRuns.startedAt,
          finishedAt: packageRuns.finishedAt,
          executionAttempt: packageRuns.executionAttempt,
        })
        .from(packageRuns)
        .leftJoin(packagesTable, eq(packageRuns.packageId, packagesTable.id))
        .where(eq(packageRuns.parentRunId, input.parentRunId))
        .orderBy(desc(packageRuns.createdAt));
    }),

  get: authProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    if (!ctx.can('Packages.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
    }
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

    const laneRank: Record<string, number> = { main: 0, on_success: 1, on_failure: 2 };
    steps.sort(
      (a: (typeof steps)[number], b: (typeof steps)[number]) =>
        (laneRank[a.lane] ?? 0) - (laneRank[b.lane] ?? 0) || a.position - b.position,
    );

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
        // Operator-chosen steps to skip at runtime. Each index must refer to a
        // step marked optional:true and must not be depended upon by any other
        // step via a priorOutput binding.
        skippedStepIndexes: z.array(z.number().int().min(0)).default([])
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Run')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Run required' });
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

      const scope = readPackageScope(pkg);
      if (!input.siteId && !input.linkId && !packageMatchesScope(scope, input, new Set())) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This package is scoped to specific sites, groups, or tenant links.'
        });
      }
      if (input.siteId || input.linkId) {
        const matchingGroupIds = await loadMatchingGroupIds(ctx.db, input);
        const allowed = packageMatchesScope(scope, input, matchingGroupIds);
        if (!allowed) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'This package is not permitted to run against the selected target.'
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
                }'s output — start from step ${binding.stepPosition + 1} or earlier, or retry from an existing run.`
              });
            }
          }
        }
      }

      // Guard: validate each operator-skipped step.
      if (input.skippedStepIndexes.length > 0) {
        // Build a set of positions that are depended upon via priorOutput.
        const wiredPositions = new Set<number>();
        for (const step of steps) {
          for (const binding of Object.values(step.inputBindings)) {
            if (binding.kind === 'priorOutput') wiredPositions.add(binding.stepPosition);
          }
        }
        for (const idx of input.skippedStepIndexes) {
          if (idx >= steps.length) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Skipped step index ${idx} is out of range` });
          }
          const step = steps[idx]!;
          if (!(step as any).optional) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Step ${idx + 1} is not marked optional and cannot be skipped`
            });
          }
          if (wiredPositions.has(idx)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Step ${idx + 1} has downstream dependencies and cannot be skipped`
            });
          }
        }
      }

      const materializedInputs = materializeGeneratedRuntimeInputs(input.runtimeInputs, steps);

      // Encrypt sensitive runtime inputs before persisting, using each
      // referenced capability's inputMeta to know which fields are sensitive.
      const runtimeInputs = encryptRuntimeInputs(
        materializedInputs,
        steps,
        ctx.encryptionKey ?? ''
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
            priceSource: 'default'
          };
        }),
        capturedAt: new Date().toISOString()
      };

      const children = await buildEmbeddedChildren(
        ctx.db,
        (pkg.steps as unknown[]) ?? [],
        (pkg.outcomeSteps as { onSuccess?: unknown[]; onFailure?: unknown[] } | null) ?? undefined,
      );
      const packageSnapshot = {
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        steps: pkg.steps,
        prompts: pkg.prompts ?? [],
        outcomeSteps: pkg.outcomeSteps ?? { onSuccess: [], onFailure: [] },
        failureActions: pkg.failureActions ?? [],
        exposedOutputs: pkg.exposedOutputs ?? [],
        children,
        skippedStepIndexes: input.skippedStepIndexes
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
        triggerSourceLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        runtimeInputs,
        billingSnapshot,
        startStepIndex: input.startStepIndex
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
          packageVersion: pkg.version
        }
      });

      return result;
    }),

  delete: authProcedure.input(z.object({ runId: z.uuid() })).mutation(async ({ ctx, input }) => {
    if (!ctx.can('Packages.Delete')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Delete required' });
    }
    const [current] = await ctx.db
      .select({
        id: packageRuns.id,
        status: packageRuns.status,
        siteId: packageRuns.siteId,
        packageId: packageRuns.packageId,
      })
      .from(packageRuns)
      .where(eq(packageRuns.id, input.runId))
      .limit(1);
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

    // Only terminal-state runs are safe to remove — an in-flight worker
    // still expects its row to exist to persist step results.
    const terminalStatuses = new Set(['succeeded', 'failed', 'halted', 'partial', 'canceled']);
    if (!terminalStatuses.has(current.status)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Run is ${current.status} — cancel it first, then delete once it settles.`,
      });
    }

    // package_run_steps cascade via FK.
    await ctx.db.delete(packageRuns).where(eq(packageRuns.id, input.runId));

    await ctx.db.insert(customerLogs).values({
      siteId: current.siteId,
      actorType: 'user',
      actorId: ctx.user.id,
      actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
      action: 'delete',
      actionLabel: ActionLabels.PackageRunDelete,
      targetType: 'package_run',
      targetId: input.runId,
      targetLabel: current.status,
      result: 'success',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { packageId: current.packageId, previousStatus: current.status },
    });

    return { id: input.runId };
  }),

  cancel: authProcedure.input(z.object({ runId: z.uuid() })).mutation(async ({ ctx, input }) => {
    if (!ctx.can('Packages.Run')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Run required' });
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
        message: `Run is ${current.status} — cannot cancel`
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
      metadata: { previousStatus: current.status }
    });

    return { id: input.runId };
  }),

  retryFromStep: authProcedure
    .input(
      z.object({
        runId: z.uuid(),
        stepPosition: z.number().int().min(0),
        overrideRuntimeInputs: z.record(z.string(), z.unknown()).default({})
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Run')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Run required' });
      }

      const [target] = await ctx.db
        .select()
        .from(packageRuns)
        .where(eq(packageRuns.id, input.runId))
        .limit(1);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

      const terminalStatuses = new Set(['completed', 'failed', 'halted', 'partial']);
      if (!terminalStatuses.has(target.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot retry a run in status ${target.status}`
        });
      }

      const targetSnapshot = target.packageSnapshot as {
        steps: Array<{
          capabilityId: string;
          inputBindings?: Record<string, { kind: string; promptKey?: string }>;
        }>;
      };
      if (input.stepPosition >= targetSnapshot.steps.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Step position out of range' });
      }

      // Cascading leaf-replay: walk up the parentRunId chain to the root run.
      // At each level we collect the parent-step position that spawned this
      // sub-run (from triggerRef.parentPosition). The resulting retryPath
      // starts at the root and ends at the leaf position the user picked.
      const chain: Array<{ run: typeof target; parentPosition: number | null }> = [
        { run: target, parentPosition: null },
      ];
      let cursor = target;
      const MAX_WALK = 8;
      let walked = 0;
      while (cursor.parentRunId && walked < MAX_WALK) {
        const [parent] = await ctx.db
          .select()
          .from(packageRuns)
          .where(eq(packageRuns.id, cursor.parentRunId))
          .limit(1);
        if (!parent) break;
        const trigger = (cursor.triggerRef ?? {}) as { parentPosition?: number };
        chain.push({
          run: parent,
          parentPosition: typeof trigger.parentPosition === 'number' ? trigger.parentPosition : null,
        });
        cursor = parent;
        walked++;
      }
      // chain[0] = leaf (target), chain[last] = root. Reverse to walk root→leaf.
      chain.reverse();
      const root = chain[0]!.run;

      // Build retryPath: root's own position (chain[1].parentPosition), then
      // each intermediate parentPosition, ending with the leaf's stepPosition.
      const retryPath: number[] = [];
      for (let i = 1; i < chain.length; i++) {
        const pos = chain[i]!.parentPosition;
        if (pos === null || pos === undefined) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Could not resolve retry path — parent linkage is incomplete',
          });
        }
        retryPath.push(pos);
      }
      retryPath.push(input.stepPosition);

      // Sensitive-outputs purge check applies at the root — the whole cascade
      // needs to be able to seed prior outputs during replay.
      if ((retryPath[0]! > 0 || retryPath.length > 1) && root.sensitiveOutputsPurgedAt) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Original run outputs have been purged and cannot be replayed'
        });
      }

      const rootSnapshot = root.packageSnapshot as {
        steps: Array<{
          capabilityId: string;
          inputBindings?: Record<string, { kind: string; promptKey?: string }>;
        }>;
      };
      const rootStartStepIndex = retryPath[0]!;

      const originalRuntimeInputs = (root.runtimeInputs ?? {}) as Record<string, unknown>;
      const materializedOverrides = materializeGeneratedRuntimeInputs(
        input.overrideRuntimeInputs,
        rootSnapshot.steps as Array<{ capabilityId: string; inputBindings?: Record<string, unknown> }>
      );
      const encryptedOverrides = encryptRuntimeInputs(
        materializedOverrides,
        rootSnapshot.steps,
        ctx.encryptionKey ?? ''
      );
      const mergedRuntimeInputs = { ...originalRuntimeInputs, ...encryptedOverrides };

      const executionAttempt = root.executionAttempt + 1;
      // A retry is a new execution attempt of the ROOT run — even for a leaf
      // deep in a sub-package. The worker cascades the retryPath through
      // sub-package children, mutating each prior child run in place at the
      // matching position (see executeSubpackageStep). Only the root row's
      // stale steps are cleared here; nested cleanup happens inline in the
      // worker so we don't need to know the entire descendant graph upfront.
      await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(packageRuns)
          .set({
            status: 'pending',
            startStepIndex: rootStartStepIndex,
            runtimeInputs: mergedRuntimeInputs,
            triggerRef: {
              ...(typeof root.triggerRef === 'object' && root.triggerRef !== null
                ? root.triggerRef
                : {}),
              retryPath,
              retriedFromStep: input.stepPosition,
              retriedFromRunId: input.runId,
              retriedBy: ctx.user.id,
              retriedAt: new Date().toISOString()
            },
            executionAttempt,
            bullmqJobId: null,
            startedAt: null,
            finishedAt: null,
            billingTotal: '0',
            outputsExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1_000).toISOString(),
            sensitiveOutputsPurgedAt: null
          })
          .where(and(eq(packageRuns.id, root.id), eq(packageRuns.status, root.status)))
          .returning({ id: packageRuns.id });
        if (!updated) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This run changed before it could be retried. Refresh and try again.'
          });
        }

        await tx
          .delete(packageRunSteps)
          .where(
            and(
              eq(packageRunSteps.packageRunId, root.id),
              gte(packageRunSteps.position, rootStartStepIndex)
            )
          );

        await tx.insert(customerLogs).values({
          siteId: root.siteId,
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
          action: 'update',
          actionLabel: ActionLabels.PackageRunStart,
          targetType: 'package_run',
          targetId: root.id,
          targetLabel: 'retry',
          result: 'success',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: {
            retryFromStep: input.stepPosition,
            retryPath,
            retriedFromRunId: input.runId,
            executionAttempt,
          }
        });
      });

      return { packageRunId: root.id, executionAttempt };
    }),

  revealOutput: authProcedure
    .input(
      z.object({
        runStepId: z.uuid(),
        outputPath: z.string()
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Run')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Run required' });
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
          sensitiveOutputsPurgedAt: packageRuns.sensitiveOutputsPurgedAt
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
        metadata: { packageRunId: run.id, outputPath: input.outputPath }
      });

      return { value: JSON.parse(decrypted) as unknown };
    })
});

// Walks the referenced steps to find password-typeHint inputs that were left
// as runtime bindings. If the operator sent the "__generate__" sentinel for
// such a promptKey, replace it with a real generated password using the
// same defaults as the builder's generator widget.
function materializeGeneratedRuntimeInputs(
  inputs: Record<string, unknown>,
  steps: Array<{ capabilityId: string; inputBindings?: Record<string, unknown> }>
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
  encryptionKey: string
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
