import { z } from 'zod';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  capabilityCandidates,
  capabilitySmokeTests,
  capabilityFlags,
} from '@mspbyte/drizzle-catalog';
import {
  listCapabilities,
  parseOpenApiText,
  listOperations,
  buildCandidates,
  extractBodyFields,
  scaffoldCapability,
  scaffoldFilename,
  WRITE_BACK_ALLOWED_TABLES,
} from '@mspbyte/capabilities';
import { packages, packageRuns, packageRunSteps } from '@mspbyte/drizzle';
import { createPendingPackageRun } from '@mspbyte/pipeline';
import { t, authProcedure } from '../trpc.js';

const capabilityProcedure = authProcedure.use(({ ctx, next }) => {
  if (!ctx.can('Global.Admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Global.Admin permission required' });
  }
  return next();
});

const lifecycleStatusSchema = z.enum(['generated', 'approved', 'live', 'rejected']);

export const capabilitiesRouter = t.router({
  candidates: t.router({
    list: capabilityProcedure
      .input(z.object({ status: lifecycleStatusSchema.optional() }).optional())
      .query(async ({ ctx, input }) => {
        const rows = await ctx.catalogDb
          .select()
          .from(capabilityCandidates)
          .orderBy(capabilityCandidates.createdAt);
        if (input?.status) return rows.filter((r) => r.lifecycleStatus === input.status);
        return rows;
      }),

    counts: capabilityProcedure.query(async ({ ctx }) => {
      const rows = await ctx.catalogDb
        .select({
          status: capabilityCandidates.lifecycleStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(capabilityCandidates)
        .groupBy(capabilityCandidates.lifecycleStatus);
      const map = Object.fromEntries(rows.map((r) => [r.status, r.count]));
      return {
        generated: map.generated ?? 0,
        approved: map.approved ?? 0,
        live: map.live ?? 0,
        rejected: map.rejected ?? 0,
      };
    }),

    get: capabilityProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const [row] = await ctx.catalogDb
          .select()
          .from(capabilityCandidates)
          .where(eq(capabilityCandidates.id, input.id))
          .limit(1);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidate not found' });
        return row;
      }),

    upsert: capabilityProcedure
      .input(
        z.object({
          id: z.string(),
          vendor: z.string(),
          name: z.string(),
          description: z.string().nullish(),
          category: z.string().nullish(),
          integration: z.record(z.string(), z.unknown()),
          operation: z.record(z.string(), z.unknown()),
          inputMeta: z.record(z.string(), z.unknown()),
          outputMeta: z.record(z.string(), z.unknown()),
          sourceUrl: z.string().nullish(),
          notes: z.string().nullish(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const now = new Date().toISOString();
        const existing = await ctx.catalogDb
          .select({ id: capabilityCandidates.id })
          .from(capabilityCandidates)
          .where(eq(capabilityCandidates.id, input.id))
          .limit(1);

        if (existing.length > 0) {
          await ctx.catalogDb
            .update(capabilityCandidates)
            .set({ ...input, updatedAt: now })
            .where(eq(capabilityCandidates.id, input.id));
        } else {
          await ctx.catalogDb.insert(capabilityCandidates).values({
            ...input,
            lifecycleStatus: 'generated',
            integration: input.integration as Record<string, string>,
            operation: input.operation,
            inputMeta: input.inputMeta,
            outputMeta: input.outputMeta,
            createdAt: now,
            updatedAt: now,
          });
        }

        return { id: input.id };
      }),

    setStatus: capabilityProcedure
      .input(
        z.object({
          id: z.string(),
          status: lifecycleStatusSchema,
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.catalogDb
          .select()
          .from(capabilityCandidates)
          .where(eq(capabilityCandidates.id, input.id))
          .limit(1);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidate not found' });

        const now = new Date().toISOString();
        const patch: Partial<typeof capabilityCandidates.$inferInsert> = {
          lifecycleStatus: input.status,
          updatedAt: now,
        };
        if (input.notes !== undefined) patch.notes = input.notes;
        if (input.status === 'approved') {
          patch.approvedBy = ctx.userId;
          patch.approvedAt = now;
        }
        if (input.status === 'rejected') {
          patch.rejectedBy = ctx.userId;
          patch.rejectedAt = now;
        }
        if (input.status === 'live') patch.liveAt = now;

        await ctx.catalogDb
          .update(capabilityCandidates)
          .set(patch)
          .where(eq(capabilityCandidates.id, input.id));

        return { id: input.id, status: input.status };
      }),

    delete: capabilityProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.catalogDb
          .delete(capabilityCandidates)
          .where(eq(capabilityCandidates.id, input.id));
        return { id: input.id };
      }),

    /** Creates a throwaway draft package + pending run so the worker executes
     *  the candidate against real tenant infra. Returns runId for polling. */
    runTest: capabilityProcedure
      .input(
        z.object({
          candidateId: z.string(),
          linkId: z.string().uuid().nullish(),
          inputs: z.record(z.string(), z.unknown()),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.catalogDb
          .select()
          .from(capabilityCandidates)
          .where(eq(capabilityCandidates.id, input.candidateId))
          .limit(1);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidate not found' });

        const inputMeta = (row.inputMeta ?? {}) as Record<string, { required?: boolean }>;
        const inputBindings: Record<string, { kind: 'runtime'; promptKey: string; required?: boolean }> = {};
        for (const [key, meta] of Object.entries(inputMeta)) {
          inputBindings[key] = { kind: 'runtime', promptKey: key, required: meta.required };
        }

        const step = {
          kind: 'capability' as const,
          capabilityId: row.id,
          label: row.name,
          inputBindings,
        };

        const [pkg] = await ctx.db.insert(packages).values({
          name: `[dev-test] ${row.name}`,
          description: 'Throwaway test run created from the capabilities workshop.',
          status: 'draft',
          steps: [step],
          prompts: [],
          outcomeSteps: { onSuccess: [], onFailure: [] },
          failureActions: [],
          exposedOutputs: [],
          allowedSites: [],
          allowedSiteGroups: [],
          allowedIntegrationLinks: [],
          authorUserId: ctx.userId,
        }).returning({ id: packages.id, version: packages.version });

        if (!pkg) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create test package' });

        const packageSnapshot = {
          id: pkg.id,
          name: `[dev-test] ${row.name}`,
          version: pkg.version,
          steps: [step],
          prompts: [],
          outcomeSteps: { onSuccess: [], onFailure: [] },
          failureActions: [],
          exposedOutputs: [],
          children: {},
          testRun: true,
        };

        const { packageRunId } = await createPendingPackageRun(ctx.db, {
          packageId: pkg.id,
          packageVersion: pkg.version,
          packageSnapshot,
          linkId: input.linkId ?? null,
          siteId: null,
          triggerType: 'manual',
          triggeredByUserId: ctx.userId,
          triggerSourceLabel: `dev-test by ${ctx.user.name || ctx.user.email || ctx.userId}`,
          runtimeInputs: input.inputs,
          billingSnapshot: {},
        });

        return { runId: packageRunId, packageId: pkg.id };
      }),

    /** Polls a test run created by runTest. Returns the run status and first
     *  step result once execution completes. */
    getTestResult: capabilityProcedure
      .input(z.object({ runId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [run] = await ctx.db
          .select({ status: packageRuns.status })
          .from(packageRuns)
          .where(eq(packageRuns.id, input.runId))
          .limit(1);
        if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

        if (run.status === 'pending' || run.status === 'queued' || run.status === 'running') {
          return { status: run.status, step: null };
        }

        const [step] = await ctx.db
          .select({
            status: packageRunSteps.status,
            outputs: packageRunSteps.outputs,
            errorClass: packageRunSteps.errorClass,
            errorMessage: packageRunSteps.errorMessage,
            finishedAt: packageRunSteps.finishedAt,
          })
          .from(packageRunSteps)
          .where(and(eq(packageRunSteps.packageRunId, input.runId), eq(packageRunSteps.position, 0)))
          .limit(1);

        return { status: run.status, step: step ?? null };
      }),

    /** Deletes a throwaway [dev-test] package and its run history.
     *  Safety-guarded: only operates on draft packages prefixed with [dev-test]. */
    deleteTestPackage: capabilityProcedure
      .input(z.object({ packageId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [pkg] = await ctx.db
          .select({ name: packages.name, status: packages.status })
          .from(packages)
          .where(eq(packages.id, input.packageId))
          .limit(1);
        if (!pkg || pkg.status !== 'draft' || !pkg.name.startsWith('[dev-test]')) {
          return { deleted: false };
        }
        const runIds = ctx.db
          .select({ id: packageRuns.id })
          .from(packageRuns)
          .where(eq(packageRuns.packageId, input.packageId));
        await ctx.db.delete(packageRunSteps).where(inArray(packageRunSteps.packageRunId, runIds));
        await ctx.db.delete(packageRuns).where(eq(packageRuns.packageId, input.packageId));
        await ctx.db.delete(packages).where(eq(packages.id, input.packageId));
        return { deleted: true };
      }),

    fetchBodyFields: capabilityProcedure
      .input(z.object({ candidateId: z.string() }))
      .query(async ({ ctx, input }) => {
        const [row] = await ctx.catalogDb
          .select({ sourceUrl: capabilityCandidates.sourceUrl, operation: capabilityCandidates.operation })
          .from(capabilityCandidates)
          .where(eq(capabilityCandidates.id, input.candidateId))
          .limit(1);
        if (!row?.sourceUrl) return { fields: [] };

        const op = (row.operation ?? {}) as { operationId?: string };
        if (!op.operationId) return { fields: [] };

        let text: string;
        try {
          const res = await fetch(row.sourceUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          text = await res.text();
        } catch (e) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Could not fetch spec from ${row.sourceUrl}: ${e instanceof Error ? e.message : String(e)}`,
          });
        }

        const doc = parseOpenApiText(text);
        const fields = extractBodyFields(doc, op.operationId);
        return { fields };
      }),
  }),

  smokeTests: t.router({
    list: capabilityProcedure
      .input(z.object({ candidateId: z.string() }))
      .query(async ({ ctx, input }) => {
        return ctx.catalogDb
          .select()
          .from(capabilitySmokeTests)
          .where(eq(capabilitySmokeTests.candidateId, input.candidateId))
          .orderBy(capabilitySmokeTests.testedAt);
      }),

    add: capabilityProcedure
      .input(
        z.object({
          candidateId: z.string(),
          evidence: z.string().min(1),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [candidate] = await ctx.catalogDb
          .select({ id: capabilityCandidates.id })
          .from(capabilityCandidates)
          .where(eq(capabilityCandidates.id, input.candidateId))
          .limit(1);
        if (!candidate) throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidate not found' });

        const [row] = await ctx.catalogDb
          .insert(capabilitySmokeTests)
          .values({
            candidateId: input.candidateId,
            evidence: input.evidence,
            notes: input.notes,
            testedBy: ctx.userId,
            testedAt: new Date().toISOString(),
          })
          .returning();

        return row!;
      }),
  }),

  flags: t.router({
    list: capabilityProcedure
      .input(z.object({ capabilityId: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        if (input?.capabilityId) {
          return ctx.catalogDb
            .select()
            .from(capabilityFlags)
            .where(eq(capabilityFlags.capabilityId, input.capabilityId));
        }
        return ctx.catalogDb.select().from(capabilityFlags);
      }),

    setGlobal: capabilityProcedure
      .input(
        z.object({
          capabilityId: z.string(),
          enabled: z.boolean(),
          reason: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const now = new Date().toISOString();
        const existing = await ctx.catalogDb
          .select({ id: capabilityFlags.id })
          .from(capabilityFlags)
          .where(
            and(
              eq(capabilityFlags.capabilityId, input.capabilityId),
              isNull(capabilityFlags.orgId),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          await ctx.catalogDb
            .update(capabilityFlags)
            .set({ enabled: input.enabled, reason: input.reason, updatedBy: ctx.userId, updatedAt: now })
            .where(
              and(
                eq(capabilityFlags.capabilityId, input.capabilityId),
                isNull(capabilityFlags.orgId),
              ),
            );
        } else {
          await ctx.catalogDb.insert(capabilityFlags).values({
            capabilityId: input.capabilityId,
            orgId: null,
            enabled: input.enabled,
            reason: input.reason,
            updatedBy: ctx.userId,
            updatedAt: now,
          });
        }

        return { capabilityId: input.capabilityId, enabled: input.enabled };
      }),
  }),

  import: t.router({
    /** Parse a spec and return all available operation IDs (preview step, no DB write). */
    preview: capabilityProcedure
      .input(z.object({ specText: z.string().min(10) }))
      .mutation(async ({ input }) => {
        const doc = parseOpenApiText(input.specText);
        return listOperations(doc);
      }),

    /** Parse a spec, build candidates for selected operations, upsert into catalog DB. */
    save: capabilityProcedure
      .input(
        z.object({
          specText: z.string().min(10),
          integration: z.string().min(1),
          vendor: z.string().min(1),
          connection: z.enum(['configured', 'activeLink']),
          operations: z.array(z.string()).min(1),
          source: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const doc = parseOpenApiText(input.specText);
        const candidates = buildCandidates(doc, {
          integration: input.integration,
          vendor: input.vendor,
          connection: input.connection,
          operations: input.operations,
          source: input.source,
        });

        const now = new Date().toISOString();
        const results: string[] = [];

        for (const c of candidates) {
          const existing = await ctx.catalogDb
            .select({ id: capabilityCandidates.id })
            .from(capabilityCandidates)
            .where(eq(capabilityCandidates.id, c.id))
            .limit(1);

          if (existing.length > 0) {
            await ctx.catalogDb
              .update(capabilityCandidates)
              .set({
                vendor: c.vendor,
                name: c.name,
                description: c.description,
                category: c.category,
                integration: c.integration as Record<string, string>,
                operation: c.operation,
                inputMeta: c.inputMeta,
                outputMeta: c.outputMeta,
                updatedAt: now,
              })
              .where(eq(capabilityCandidates.id, c.id));
          } else {
            await ctx.catalogDb.insert(capabilityCandidates).values({
              id: c.id,
              lifecycleStatus: 'generated',
              vendor: c.vendor,
              name: c.name,
              description: c.description,
              category: c.category,
              integration: c.integration as Record<string, string>,
              operation: c.operation,
              inputMeta: c.inputMeta,
              outputMeta: c.outputMeta,
              sourceUrl: input.source,
              createdAt: now,
              updatedAt: now,
            });
          }
          results.push(c.id);
        }

        return { saved: results };
      }),
  }),

  scaffold: t.router({
    /** Generate the TypeScript scaffold for an approved candidate. */
    generate: capabilityProcedure
      .input(z.object({ candidateId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.catalogDb
          .select()
          .from(capabilityCandidates)
          .where(eq(capabilityCandidates.id, input.candidateId))
          .limit(1);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidate not found' });

        const candidate = {
          id: row.id,
          integration: row.integration as { integrationId: string; connection: 'configured' | 'activeLink' },
          vendor: row.vendor,
          name: row.name,
          description: row.description ?? '',
          category: row.category ?? 'admin',
          operation: row.operation as Parameters<typeof scaffoldCapability>[0]['operation'],
          inputMeta: (row.inputMeta ?? {}) as Parameters<typeof scaffoldCapability>[0]['inputMeta'],
          outputMeta: row.outputMeta as Record<string, unknown>,
          lifecycle: { status: row.lifecycleStatus as 'generated' | 'approved' | 'live' | 'rejected' },
        };

        return {
          filename: scaffoldFilename(candidate),
          content: scaffoldCapability(candidate),
        };
      }),
  }),

  /** Exposes WRITE_BACK_ALLOWED_TABLES as a tRPC query so the frontend
   *  uses a single authoritative source rather than a duplicated constant. */
  writeBackSchema: capabilityProcedure.query(() => {
    return Object.fromEntries(
      Object.entries(WRITE_BACK_ALLOWED_TABLES).map(([table, info]) => [
        table,
        {
          integration: info.integration,
          label: info.label,
          allowedKeyColumns: [...info.allowedKeyColumns],
          columns: [...info.columns],
        },
      ]),
    );
  }),

  registry: t.router({
    /** Returns all capabilities: code-registered (type: 'code') and
     *  catalog-only candidates not in the code registry (type: 'catalog'). */
    list: capabilityProcedure.query(async ({ ctx }) => {
      const coded = listCapabilities().map((cap) => ({
        id: cap.id,
        name: cap.name,
        description: cap.description ?? '',
        vendor: cap.vendor,
        category: cap.category ?? null,
        integration: cap.integration ?? null,
        type: 'code' as const,
        catalogStatus: null as string | null,
      }));
      const codeIds = new Set(coded.map((c) => c.id));

      const allCandidates = await ctx.catalogDb
        .select({
          id: capabilityCandidates.id,
          name: capabilityCandidates.name,
          description: capabilityCandidates.description,
          vendor: capabilityCandidates.vendor,
          category: capabilityCandidates.category,
          integration: capabilityCandidates.integration,
          lifecycleStatus: capabilityCandidates.lifecycleStatus,
        })
        .from(capabilityCandidates);

      const catalogMap = new Map(allCandidates.map((c) => [c.id, c]));

      const codeEntries = coded.map((cap) => ({
        ...cap,
        catalogStatus: catalogMap.get(cap.id)?.lifecycleStatus ?? 'live',
      }));

      const catalogOnly = allCandidates
        .filter((c) => !codeIds.has(c.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description ?? '',
          vendor: c.vendor,
          category: c.category ?? null,
          integration: c.integration,
          type: 'catalog' as const,
          catalogStatus: c.lifecycleStatus,
        }));

      return [...codeEntries, ...catalogOnly].sort((a, b) => a.name.localeCompare(b.name));
    }),
  }),
});
