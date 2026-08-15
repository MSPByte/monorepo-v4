import { Worker } from "bullmq";
import { and, asc, eq } from "drizzle-orm";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import {
  customerLogs,
  integrationLinks,
  integrations,
  m365Groups,
  m365Identities,
  m365Policies,
  packageRuns,
  packageRunSteps,
  siteProfileFacts,
  sites,
  sophosEndpoints,
} from "@mspbyte/drizzle";
import type { PackageJobData } from "@mspbyte/pipeline";
import {
  getCapability,
  getGenerator,
  RETRYABLE_ERROR_CLASSES,
  type AnyCapability,
  type Binding,
  type CapabilityCtx,
  type CapabilityResult,
  type CreateIntegrationLinkOpts,
  type ErrorClass,
  type FailureAction,
  type M365IdentityRow,
  type SophosEndpointRow,
  type StepOnFailure,
  type UpsertM365GroupData,
  type UpsertM365IdentityData,
  type UpsertM365PolicyData,
} from "@mspbyte/capabilities";
import { type M365Connector, SophosConnector, DattoConnector, CoveConnector, HaloPSAConnector } from "@mspbyte/connectors";
import { Encryption } from "@mspbyte/encryption";
import { env, requireEncryptionKey } from "../env.js";
import { serializeError } from "../errors.js";
import { logger } from "../logger.js";
import { buildM365Connector } from "../m365.js";
import type { RedisConnection } from "../redis.js";
import { purgeExpiredSensitiveOutputs } from "./ttl-cleanup.js";

export const TTL_CLEANUP_JOB_NAME = "ttl-cleanup";

type StepDefinition = {
  capabilityId: string;
  label?: string;
  inputBindings: Record<string, Binding>;
  onFailure?: StepOnFailure;
  retryAttempts?: number;
};

type PackageSnapshot = {
  id: string;
  name: string;
  version: number;
  steps: StepDefinition[];
  outcomeSteps?: { onSuccess?: StepDefinition[]; onFailure?: StepDefinition[] };
  failureActions?: FailureAction[];
  skippedStepIndexes?: number[];
};

export function createPackageWorker(
  redis: RedisConnection,
  orgId: string,
  queueName: string,
): Worker {
  return new Worker<PackageJobData, void, string>(
    queueName,
    async (job) => {
      const encryptionKey = requireEncryptionKey();
      const tenant = await getTenantServiceDbByOrgId(
        job.data.orgId,
        encryptionKey,
        env.CATALOG_DATABASE_URL,
      );
      const db = tenant.db;

      // TTL cleanup jobs share the queue but have their own name + payload
      // shape. Dispatch here so both stay on the org-sharded queue.
      if (job.name === TTL_CLEANUP_JOB_NAME) {
        const summary = await purgeExpiredSensitiveOutputs(db, orgId);
        if (summary.runsPurged > 0) {
          logger.info("Purged expired sensitive outputs", {
            orgId,
            ...summary,
          });
        }
        return;
      }

      const packageRunId = job.data.packageRunId;

      const [run] = await db
        .select()
        .from(packageRuns)
        .where(eq(packageRuns.id, packageRunId))
        .limit(1);

      if (!run) {
        logger.warn("Package run not found", { orgId, packageRunId });
        return;
      }
      if (run.status !== "queued" && run.status !== "pending") {
        logger.warn("Package run not in queued state, skipping", {
          orgId,
          packageRunId,
          status: run.status,
        });
        return;
      }

      const snapshot = run.packageSnapshot as PackageSnapshot;
      const runtimeInputs = (run.runtimeInputs ?? {}) as Record<string, unknown>;

      await db
        .update(packageRuns)
        .set({ status: "running", startedAt: new Date().toISOString() })
        .where(eq(packageRuns.id, packageRunId));

      // Per-linkId connector cache — one M365Connector per link for the run.
      const connectorCache = new Map<string, M365Connector>();
      const stepOutputs = new Map<number, Record<string, unknown>>();

      // Retry-from-step-N keeps the same job. Seed its retained prior step
      // outputs so downstream priorOutput bindings retain full context. The
      // parent fallback preserves compatibility with historic retry records.
      if (run.startStepIndex > 0) {
        try {
          await seedPriorOutputs({
            db,
            parentRunId: run.parentRunId ?? packageRunId,
            upToPosition: run.startStepIndex,
            snapshot,
            encryptionKey,
            stepOutputs,
          });
        } catch (err) {
          logger.error("Failed to seed prior outputs for retry", {
            orgId,
            packageRunId,
            parentRunId: run.parentRunId,
            error: serializeError(err),
          });
          await db
            .update(packageRuns)
            .set({
              status: "failed",
              finishedAt: new Date().toISOString(),
            })
            .where(eq(packageRuns.id, packageRunId));
          return;
        }
      }

      // Load site facts once per run — packages with several `siteFact`
      // bindings then read from an in-memory map. Empty map if the run has
      // no siteId (siteFact bindings will fail resolution with a clear error).
      const siteFacts = new Map<string, unknown>();
      if (run.siteId) {
        const factRows = await db
          .select({
            key: siteProfileFacts.key,
            value: siteProfileFacts.value,
            applicable: siteProfileFacts.applicable,
          })
          .from(siteProfileFacts)
          .where(eq(siteProfileFacts.siteId, run.siteId));
        for (const row of factRows) {
          // Facts explicitly marked not_applicable are treated as absent.
          if (row.applicable === "not_applicable") continue;
          siteFacts.set(row.key, row.value);
        }
      }

      // Per-link Sophos connector cache for site-level endpoint operations.
      const sophosConnectorCache = new Map<string, SophosConnector>();
      // Integration-level singletons — loaded once per run, no linkId required.
      let sophosPartnerConnector: SophosConnector | null = null;
      let dattoConnectorSingleton: DattoConnector | null = null;
      let coveConnectorSingleton: { connector: CoveConnector; rootPartnerId: number } | null = null;
      let haloConnectorSingleton: { connector: HaloPSAConnector; haloSiteId: number } | null = null;

      const ctxBase: Omit<CapabilityCtx, "packageRunStepId" | "generatedInputs"> = {
        encryptionKey,
        user: {
          id: run.triggeredByUserId ?? "system",
          name: null,
          email: null,
        },
        packageRunId,
        siteFacts,
        loadM365Identity: (id: string) => loadIdentity(db, id),
        getM365Connector: (linkId: string) =>
          getConnector(db, connectorCache, linkId, encryptionKey),
        loadSophosEndpoint: (endpointId: string) =>
          loadSophosEndpoint(db, endpointId),
        getSophosConnector: (linkId: string) =>
          getSophosConnector(db, sophosConnectorCache, linkId, encryptionKey),
        getSophosPartnerConnector: async () => {
          if (!sophosPartnerConnector) {
            sophosPartnerConnector = await getSophosPartnerConnector(db, encryptionKey);
          }
          return sophosPartnerConnector;
        },
        getDattoConnector: async () => {
          if (!dattoConnectorSingleton) {
            dattoConnectorSingleton = await getDattoConnector(db, encryptionKey);
          }
          return dattoConnectorSingleton;
        },
        getCoveConnector: async () => {
          if (!coveConnectorSingleton) {
            coveConnectorSingleton = await getCoveConnector(db, encryptionKey);
          }
          return coveConnectorSingleton;
        },
        getHaloPSAConnector: async () => {
          if (!haloConnectorSingleton) {
            if (!run.siteId) throw new Error("HaloPSA ticket creation requires a site-scoped package run");
            haloConnectorSingleton = await getHaloPSAConnector(db, run.siteId, encryptionKey);
          }
          return haloConnectorSingleton;
        },
        lookupSite: (siteId: string) =>
          lookupSite(db, siteId),
        createSite: (name: string, description?: string) =>
          createSite(db, name, description),
        createIntegrationLink: (opts: CreateIntegrationLinkOpts) =>
          createIntegrationLink(db, opts),
        upsertM365Group: (data: UpsertM365GroupData) => upsertM365Group(db, data),
        upsertM365Identity: (data: UpsertM365IdentityData) => upsertM365Identity(db, data),
        upsertM365Policy: (data: UpsertM365PolicyData) => upsertM365Policy(db, data),
      };

      let halted = false;
      let canceled = false;
      let anyStepFailed = false;

      const operatorSkippedPositions = new Set(snapshot.skippedStepIndexes ?? []);

      for (let position = run.startStepIndex; position < snapshot.steps.length; position++) {
        // Cancellation window: re-read the run's status between steps so an
        // in-flight cancel from tRPC takes effect at the next boundary. We
        // deliberately don't interrupt an in-progress capability handler —
        // that would leave vendor state half-committed.
        const [current] = await db
          .select({ status: packageRuns.status })
          .from(packageRuns)
          .where(eq(packageRuns.id, packageRunId))
          .limit(1);
        if (current?.status === "canceled") {
          canceled = true;
          break;
        }

        const step = snapshot.steps[position]!;

        // Operator chose to skip this step at run time.
        if (operatorSkippedPositions.has(position)) {
          await db.insert(packageRunSteps).values({
            packageRunId,
            position,
            capabilityId: step.capabilityId,
            status: "skip",
            skipReason: "operator_skipped",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          });
          continue;
        }
        const capability = getCapability(step.capabilityId);
        if (!capability) {
          await recordStepFailure(db, packageRunId, position, step.capabilityId, {
            errorClass: "capability_missing",
            message: `Unknown capability ${step.capabilityId}`,
          });
          halted = true;
          anyStepFailed = true;
          break;
        }

        const stepOnFailure: StepOnFailure = step.onFailure ?? "halt";
        const maxAttempts = 1 + Math.min(Math.max(step.retryAttempts ?? 0, 0), 5);

        const inserted = await db
          .insert(packageRunSteps)
          .values({
            packageRunId,
            position,
            capabilityId: step.capabilityId,
            status: "running",
            startedAt: new Date().toISOString(),
          })
          .returning({ id: packageRunSteps.id });
        const stepRow = inserted[0]!;

        const resolveResult = resolveBindings(
          step.inputBindings,
          runtimeInputs,
          stepOutputs,
          { siteId: run.siteId, siteFacts },
        );
        if (!resolveResult.ok) {
          await failStep(db, stepRow.id, {
            errorClass: "binding_unresolved",
            message: resolveResult.error,
            resolvedInputs: {},
          });
          anyStepFailed = true;
          if (stepOnFailure === "halt") {
            halted = true;
            break;
          }
          continue;
        }

        // Optional/undefined inputs — drop them before zod so `.optional()`
        // fields that were bound to runtime but not supplied pass validation.
        const cleaned = stripUndefined(resolveResult.value);

        const parsed = capability.inputs.safeParse(cleaned);
        if (!parsed.success) {
          await failStep(db, stepRow.id, {
            errorClass: "input_validation",
            message: parsed.error.message,
            resolvedInputs: encryptSensitiveInputs(
              cleaned,
              capability,
              encryptionKey,
            ),
          });
          anyStepFailed = true;
          if (stepOnFailure === "halt") {
            halted = true;
            break;
          }
          continue;
        }

        const ctx: CapabilityCtx = {
          ...ctxBase,
          packageRunStepId: stepRow.id,
          generatedInputs: resolveResult.generatedInputs,
        };
        let result: CapabilityResult<unknown> = {
          outcome: "fail",
          errorClass: "handler_threw",
          message: "not run",
        };
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            result = await capability.handler(ctx, parsed.data);
          } catch (error) {
            result = {
              outcome: "fail",
              errorClass: "handler_threw",
              message: error instanceof Error ? error.message : String(error),
            };
          }
          if (result.outcome !== "fail") break;
          const cls = result.errorClass as ErrorClass;
          const retryable =
            result.retryable === true && RETRYABLE_ERROR_CLASSES.includes(cls);
          if (!retryable || attempt === maxAttempts - 1) break;
          // Simple exponential backoff between attempts: 250ms, 500ms, 1s, ...
          await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        }

        const auditRow = await writeAuditLog(db, {
          run,
          capability,
          position,
          resolvedInputs: parsed.data as Record<string, unknown>,
          result,
        });

        const encryptedInputs = encryptSensitiveInputs(
          parsed.data as Record<string, unknown>,
          capability,
          encryptionKey,
        );

        if (result.outcome === "success") {
          const encryptedOutputs = encryptSensitiveOutputs(
            result.outputs as Record<string, unknown>,
            capability,
            encryptionKey,
          );
          await db
            .update(packageRunSteps)
            .set({
              status: "success",
              resolvedInputs: encryptedInputs,
              outputs: encryptedOutputs,
              billable: true,
              unitPrice: String(capability.defaultUnitPrice),
              finishedAt: new Date().toISOString(),
              auditLogIds: auditRow ? [auditRow] : [],
            })
            .where(eq(packageRunSteps.id, stepRow.id));
          stepOutputs.set(position, result.outputs as Record<string, unknown>);
          continue;
        }

        if (result.outcome === "skip") {
          await db
            .update(packageRunSteps)
            .set({
              status: "skip",
              skipReason: result.reason,
              resolvedInputs: encryptedInputs,
              finishedAt: new Date().toISOString(),
              auditLogIds: auditRow ? [auditRow] : [],
            })
            .where(eq(packageRunSteps.id, stepRow.id));
          continue;
        }

        await db
          .update(packageRunSteps)
          .set({
            status: "fail",
            resolvedInputs: encryptedInputs,
            errorClass: result.errorClass,
            errorMessage: result.message,
            finishedAt: new Date().toISOString(),
            auditLogIds: auditRow ? [auditRow] : [],
          })
          .where(eq(packageRunSteps.id, stepRow.id));
        anyStepFailed = true;
        if (stepOnFailure === "halt") {
          halted = true;
          break;
        }
        // stepOnFailure === 'continue' — proceed to the next step. The run's
        // final status will be 'partial' if we reach the end this way.
      }

      // Derive final status:
      //   canceled: user asked us to stop
      //   halted: a step failed with onFailure='halt' before the end
      //   partial: ran to the end but at least one step failed on continue
      //   completed: every step succeeded (or was benignly skipped)
      const finalStatus: 'canceled' | 'halted' | 'partial' | 'completed' = canceled
        ? "canceled"
        : halted
          ? "halted"
          : anyStepFailed
            ? "partial"
            : "completed";
      // Terminal lanes are deliberately one-way reactions. They run only
      // after the main path settles and cannot alter its terminal status.
      const outcomeLane = finalStatus === 'completed'
        ? 'on_success' as const
        : finalStatus === 'halted' || finalStatus === 'partial'
          ? 'on_failure' as const
          : null;
      const outcomeSteps = outcomeLane === 'on_success'
        ? snapshot.outcomeSteps?.onSuccess ?? []
        : outcomeLane === 'on_failure'
          ? snapshot.outcomeSteps?.onFailure ?? []
          : [];
      const failureContext = finalStatus === 'halted' || finalStatus === 'partial'
        ? await loadFailureContext(db, packageRunId, finalStatus, run.siteId)
        : undefined;
      if (outcomeLane && outcomeSteps.length > 0) {
        await executeOutcomeLane({
          db,
          run,
          runId: packageRunId,
          lane: outcomeLane,
          steps: outcomeSteps,
          runtimeInputs,
          siteFacts,
          ctxBase,
          encryptionKey,
          // A failed main path cannot provide a dependable output contract.
          // Failure reactions may only consume earlier failure-reaction outputs.
          mainOutputs: outcomeLane === 'on_success' ? stepOutputs : new Map(),
          failureContext,
        });
      }

      const totalBillable = await sumBillable(db, packageRunId);
      await db
        .update(packageRuns)
        .set({
          status: finalStatus,
          billingTotal: totalBillable.toFixed(4),
          finishedAt: new Date().toISOString(),
        })
        .where(eq(packageRuns.id, packageRunId));

      // Package-level failure notifications fire on any terminal non-success
      // state. Actions are described declaratively; the worker just logs the
      // intent today — email + PSA senders land in a follow-up.
      if (finalStatus === "halted" || finalStatus === "partial") {
        await executeFailureActions({
          actions: snapshot.failureActions ?? [],
          orgId,
          packageRunId,
          finalStatus,
        });
      }

      logger.info("Package run completed", {
        orgId,
        packageRunId,
        status: finalStatus,
        totalBillable,
      });
    },
    {
      connection: redis as never,
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: env.WORKER_LOCK_DURATION_MS,
    },
  ).on("failed", (job, error) => {
    logger.error("Package job failed", {
      orgId,
      jobId: job?.id,
      error: serializeError(error),
    });
  });
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function executeFailureActions(args: {
  actions: FailureAction[];
  orgId: string;
  packageRunId: string;
  finalStatus: "halted" | "partial";
}): Promise<void> {
  if (args.actions.length === 0) return;
  for (const action of args.actions) {
    // These are declared package-level responses. Real senders (email, PSA
    // integrations) plug in here; for now we log the intent so the wiring is
    // observable end-to-end and never silently no-ops.
    logger.info("Failure action fired", {
      orgId: args.orgId,
      packageRunId: args.packageRunId,
      finalStatus: args.finalStatus,
      action: action.kind,
      details: action,
    });
  }
}

async function executeOutcomeLane(args: {
  db: any;
  run: any;
  runId: string;
  lane: 'on_success' | 'on_failure';
  steps: StepDefinition[];
  runtimeInputs: Record<string, unknown>;
  siteFacts: ReadonlyMap<string, unknown>;
  ctxBase: Omit<CapabilityCtx, 'packageRunStepId' | 'generatedInputs'>;
  encryptionKey: string;
  mainOutputs: Map<number, Record<string, unknown>>;
  failureContext?: Record<string, unknown>;
}): Promise<void> {
  const outputs = new Map<number, Record<string, unknown>>();

  for (const [position, step] of args.steps.entries()) {
    const capability = getCapability(step.capabilityId);
    if (!capability) {
      await dbInsertOutcomeFailure(args, position, step.capabilityId, {
        errorClass: 'capability_missing',
        message: `Unknown capability ${step.capabilityId}`,
      });
      continue;
    }

    const [stepRow] = await args.db
      .insert(packageRunSteps)
      .values({
        packageRunId: args.runId,
        lane: args.lane,
        position,
        capabilityId: step.capabilityId,
        status: 'running',
        startedAt: new Date().toISOString(),
      })
      .returning({ id: packageRunSteps.id });

    const resolved = resolveBindings(step.inputBindings, args.runtimeInputs, outputs, {
      siteId: args.run.siteId,
      siteFacts: args.siteFacts,
    }, {
      main: args.mainOutputs,
      [args.lane === 'on_success' ? 'onSuccess' : 'onFailure']: outputs,
    }, args.failureContext);
    if (!resolved.ok) {
      await failStep(args.db, stepRow!.id, {
        errorClass: 'binding_unresolved',
        message: resolved.error,
        resolvedInputs: {},
      });
      continue;
    }

    const cleaned = stripUndefined(resolved.value);
    const parsed = capability.inputs.safeParse(cleaned);
    if (!parsed.success) {
      await failStep(args.db, stepRow!.id, {
        errorClass: 'input_validation',
        message: parsed.error.message,
        resolvedInputs: encryptSensitiveInputs(cleaned, capability, args.encryptionKey),
      });
      continue;
    }

    const ctx: CapabilityCtx = {
      ...args.ctxBase,
      packageRunStepId: stepRow!.id,
      generatedInputs: resolved.generatedInputs,
    };
    let result: CapabilityResult<unknown>;
    try {
      result = await capability.handler(ctx, parsed.data);
    } catch (error) {
      result = {
        outcome: 'fail',
        errorClass: 'handler_threw',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const auditRow = await writeAuditLog(args.db, {
      run: args.run,
      capability,
      position,
      resolvedInputs: parsed.data as Record<string, unknown>,
      result,
    });
    const encryptedInputs = encryptSensitiveInputs(
      parsed.data as Record<string, unknown>,
      capability,
      args.encryptionKey,
    );

    if (result.outcome === 'success') {
      await args.db
        .update(packageRunSteps)
        .set({
          status: 'success',
          resolvedInputs: encryptedInputs,
          outputs: encryptSensitiveOutputs(result.outputs as Record<string, unknown>, capability, args.encryptionKey),
          billable: true,
          unitPrice: String(capability.defaultUnitPrice),
          finishedAt: new Date().toISOString(),
          auditLogIds: auditRow ? [auditRow] : [],
        })
        .where(eq(packageRunSteps.id, stepRow!.id));
      outputs.set(position, result.outputs as Record<string, unknown>);
      continue;
    }

    if (result.outcome === 'skip') {
      await args.db
        .update(packageRunSteps)
        .set({
          status: 'skip',
          skipReason: result.reason,
          resolvedInputs: encryptedInputs,
          finishedAt: new Date().toISOString(),
          auditLogIds: auditRow ? [auditRow] : [],
        })
        .where(eq(packageRunSteps.id, stepRow!.id));
      continue;
    }

    await args.db
      .update(packageRunSteps)
      .set({
        status: 'fail',
        resolvedInputs: encryptedInputs,
        errorClass: result.errorClass,
        errorMessage: result.message,
        finishedAt: new Date().toISOString(),
        auditLogIds: auditRow ? [auditRow] : [],
      })
      .where(eq(packageRunSteps.id, stepRow!.id));
  }
}

async function dbInsertOutcomeFailure(
  args: { db: any; runId: string; lane: 'on_success' | 'on_failure' },
  position: number,
  capabilityId: string,
  failure: { errorClass: ErrorClass; message: string },
): Promise<void> {
  await args.db.insert(packageRunSteps).values({
    packageRunId: args.runId,
    lane: args.lane,
    position,
    capabilityId,
    status: 'fail',
    errorClass: failure.errorClass,
    errorMessage: failure.message,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });
}

function resolveBindings(
  bindings: Record<string, Binding>,
  runtimeInputs: Record<string, unknown>,
  stepOutputs: Map<number, Record<string, unknown>>,
  runContext: { siteId: string | null; siteFacts: ReadonlyMap<string, unknown> },
  outputLanes?: Partial<Record<'main' | 'onSuccess' | 'onFailure', Map<number, Record<string, unknown>>>>,
  failureContext?: Record<string, unknown>,
):
  | { ok: true; value: Record<string, unknown>; generatedInputs: Set<string> }
  | { ok: false; error: string } {
  const value: Record<string, unknown> = {};
  const generatedInputs = new Set<string>();
  for (const [name, binding] of Object.entries(bindings)) {
    switch (binding.kind) {
      case "literal":
        value[name] = binding.value;
        break;
      case "runtime": {
        const provided = runtimeInputs[binding.promptKey];
        if (provided === undefined && binding.required) {
          return { ok: false, error: `Runtime input '${binding.promptKey}' missing` };
        }
        value[name] = provided;
        break;
      }
      case "entity": {
        // Phase 1: picker-selected entities are captured in runtimeInputs.
        // row-context bindings are a Phase 3 fan-out feature.
        if (binding.source === "row-context") {
          return { ok: false, error: "row-context bindings not supported yet" };
        }
        const key = binding.contextKey ?? name;
        value[name] = runtimeInputs[key];
        break;
      }
      case "priorOutput": {
        const sourceLane = binding.lane ?? 'main';
        const prior = outputLanes?.[sourceLane]?.get(binding.stepPosition) ??
          (sourceLane === 'main' ? stepOutputs.get(binding.stepPosition) : undefined);
        if (!prior) {
          return {
            ok: false,
            error: `Prior ${sourceLane} step ${binding.stepPosition} has no outputs`,
          };
        }
        value[name] = getByPath(prior, binding.path);
        break;
      }
      case "failureContext": {
        if (!failureContext) {
          return { ok: false, error: `Input '${name}' reads failure context outside an On failure reaction` };
        }
        const contextValue = getByPath(failureContext, binding.path);
        if (contextValue === undefined) {
          return { ok: false, error: `Failure context '${binding.path}' is unavailable` };
        }
        value[name] = contextValue;
        break;
      }
      case "generated": {
        const generator = getGenerator(binding.generator);
        if (!generator) {
          return {
            ok: false,
            error: `Unknown generator '${binding.generator}'`,
          };
        }
        const parsed = generator.paramsSchema.safeParse(binding.params);
        if (!parsed.success) {
          return {
            ok: false,
            error: `Invalid params for generator '${binding.generator}': ${parsed.error.message}`,
          };
        }
        value[name] = generator.generate(parsed.data);
        generatedInputs.add(name);
        break;
      }
      case "siteFact": {
        if (!runContext.siteId) {
          return {
            ok: false,
            error: `Input '${name}' reads site fact '${binding.key}' but this run has no site`,
          };
        }
        const factValue = runContext.siteFacts.get(binding.key);
        if (factValue === undefined && binding.required) {
          return {
            ok: false,
            error: `Required site fact '${binding.key}' is not set on this site`,
          };
        }
        value[name] = factValue;
        break;
      }
    }
  }
  return { ok: true, value, generatedInputs };
}

function getByPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

async function loadFailureContext(
  db: any,
  packageRunId: string,
  status: 'halted' | 'partial',
  siteId: string | null,
): Promise<Record<string, unknown>> {
  const [failedStep] = await db
    .select({
      position: packageRunSteps.position,
      capabilityId: packageRunSteps.capabilityId,
      errorClass: packageRunSteps.errorClass,
      errorMessage: packageRunSteps.errorMessage,
    })
    .from(packageRunSteps)
    .where(and(
      eq(packageRunSteps.packageRunId, packageRunId),
      eq(packageRunSteps.lane, 'main'),
      eq(packageRunSteps.status, 'fail'),
    ))
    .orderBy(asc(packageRunSteps.position))
    .limit(1);
  const capability = failedStep ? getCapability(failedStep.capabilityId) : undefined;
  return {
    runId: packageRunId,
    status,
    siteId,
    stepPosition: failedStep ? failedStep.position + 1 : 0,
    capabilityId: failedStep?.capabilityId ?? 'unknown',
    capabilityName: capability?.name ?? failedStep?.capabilityId ?? 'Unknown capability',
    errorClass: failedStep?.errorClass ?? 'unknown',
    message: failedStep?.errorMessage ?? 'Package run did not complete successfully',
  };
}

function encryptSensitiveInputs(
  values: Record<string, unknown>,
  capability: AnyCapability,
  encryptionKey: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const [name, meta] of Object.entries(capability.inputMeta)) {
    if (!meta.sensitive) continue;
    const value = out[name];
    if (value === undefined || value === null) continue;
    out[name] = Encryption.encrypt(JSON.stringify(value), encryptionKey);
  }
  return out;
}

function encryptSensitiveOutputs(
  values: Record<string, unknown>,
  capability: AnyCapability,
  encryptionKey: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const [name, meta] of Object.entries(capability.outputMeta)) {
    if (!meta.sensitive) continue;
    const value = out[name];
    if (value === undefined || value === null) continue;
    out[name] = Encryption.encrypt(JSON.stringify(value), encryptionKey);
  }
  return out;
}

async function upsertM365Group(db: any, data: UpsertM365GroupData): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const rows = await db
    .insert(m365Groups)
    .values({
      linkId: data.linkId,
      externalId: data.externalId,
      name: data.name,
      description: data.description ?? null,
      mailEnabled: data.mailEnabled,
      securityEnabled: data.securityEnabled,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [m365Groups.linkId, m365Groups.externalId],
      set: {
        name: data.name,
        description: data.description ?? null,
        mailEnabled: data.mailEnabled,
        securityEnabled: data.securityEnabled,
        updatedAt: now,
        lastSeenAt: now,
      },
    })
    .returning({ id: m365Groups.id });
  return { id: rows[0]!.id };
}

async function upsertM365Identity(db: any, data: UpsertM365IdentityData): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const rows = await db
    .insert(m365Identities)
    .values({
      linkId: data.linkId,
      externalId: data.externalId,
      name: data.name,
      email: data.email,
      enabled: data.enabled ?? true,
      type: data.type ?? 'member',
      mfaEnforced: false,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [m365Identities.linkId, m365Identities.externalId],
      set: {
        name: data.name,
        email: data.email,
        enabled: data.enabled ?? true,
        updatedAt: now,
        lastSeenAt: now,
      },
    })
    .returning({ id: m365Identities.id });
  return { id: rows[0]!.id };
}

async function upsertM365Policy(db: any, data: UpsertM365PolicyData): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const rows = await db
    .insert(m365Policies)
    .values({
      linkId: data.linkId,
      externalId: data.externalId,
      name: data.name,
      policyState: data.policyState,
      conditions: data.conditions ?? null,
      grantControls: data.grantControls ?? null,
      sessionControls: data.sessionControls ?? null,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [m365Policies.linkId, m365Policies.externalId],
      set: {
        name: data.name,
        policyState: data.policyState,
        conditions: data.conditions ?? null,
        grantControls: data.grantControls ?? null,
        sessionControls: data.sessionControls ?? null,
        updatedAt: now,
        lastSeenAt: now,
      },
    })
    .returning({ id: m365Policies.id });
  return { id: rows[0]!.id };
}

async function loadIdentity(db: any, id: string): Promise<M365IdentityRow | null> {
  const rows = await db
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
      integrationConfig: integrations.config,
    })
    .from(m365Identities)
    .innerJoin(integrationLinks, eq(m365Identities.linkId, integrationLinks.id))
    .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
    .where(
      and(
        eq(m365Identities.id, id),
        eq(integrationLinks.integrationId, "microsoft-365"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getConnector(
  db: any,
  cache: Map<string, M365Connector>,
  linkId: string,
  encryptionKey: string,
): Promise<M365Connector> {
  const cached = cache.get(linkId);
  if (cached) return cached;
  const [row] = await db
    .select({
      tenantId: integrationLinks.externalId,
      config: integrations.config,
    })
    .from(integrationLinks)
    .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
    .where(eq(integrationLinks.id, linkId))
    .limit(1);
  if (!row?.tenantId) throw new Error(`M365 link ${linkId} missing tenant id`);
  const connector = buildM365Connector(row.config, row.tenantId, encryptionKey);
  cache.set(linkId, connector);
  return connector;
}

async function loadSophosEndpoint(db: any, endpointId: string): Promise<SophosEndpointRow | null> {
  const rows = await db
    .select({
      id: sophosEndpoints.id,
      linkId: sophosEndpoints.linkId,
      siteId: sophosEndpoints.siteId,
      externalId: sophosEndpoints.externalId,
      hostname: sophosEndpoints.hostname,
      tamperProtectionEnabled: sophosEndpoints.tamperProtectionEnabled,
      tenantId: integrationLinks.externalId,
      apiHost: integrationLinks.meta,
    })
    .from(sophosEndpoints)
    .innerJoin(integrationLinks, eq(sophosEndpoints.linkId, integrationLinks.id))
    .where(eq(sophosEndpoints.id, endpointId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // meta is a jsonb object; extract apiHost from it
  const meta = row.apiHost;
  const apiHost =
    meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>).apiHost as string | null
      : null;
  return { ...row, apiHost };
}

async function getSophosConnector(
  db: any,
  cache: Map<string, SophosConnector>,
  linkId: string,
  encryptionKey: string,
): Promise<SophosConnector> {
  const cached = cache.get(linkId);
  if (cached) return cached;
  const [row] = await db
    .select({ config: integrations.config })
    .from(integrationLinks)
    .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
    .where(eq(integrationLinks.id, linkId))
    .limit(1);
  if (!row) throw new Error(`Sophos link ${linkId} not found`);
  const config = row.config as Record<string, unknown>;
  const clientId = config.clientId as string | undefined;
  const encryptedSecret = config.clientSecret as string | undefined;
  if (!clientId || !encryptedSecret) throw new Error(`Sophos link ${linkId} missing credentials`);
  const clientSecret = Encryption.decrypt(encryptedSecret, encryptionKey);
  if (!clientSecret) throw new Error(`Sophos link ${linkId} client secret could not be decrypted`);
  const connector = new SophosConnector(clientId, clientSecret);
  cache.set(linkId, connector);
  return connector;
}

async function getSophosPartnerConnector(
  db: any,
  encryptionKey: string,
): Promise<SophosConnector> {
  const [row] = await db
    .select({ config: integrations.config })
    .from(integrations)
    .where(eq(integrations.id, "sophos-partner"))
    .limit(1);
  if (!row) throw new Error("Sophos Partner integration not configured");
  const config = row.config as Record<string, unknown>;
  const clientId = config.clientId as string | undefined;
  const encryptedSecret = config.clientSecret as string | undefined;
  if (!clientId || !encryptedSecret) throw new Error("Sophos Partner integration missing credentials");
  const clientSecret = Encryption.decrypt(encryptedSecret, encryptionKey);
  if (!clientSecret) throw new Error("Sophos Partner client secret could not be decrypted");
  return new SophosConnector(clientId, clientSecret);
}

async function getDattoConnector(
  db: any,
  encryptionKey: string,
): Promise<DattoConnector> {
  const [row] = await db
    .select({ config: integrations.config })
    .from(integrations)
    .where(eq(integrations.id, "dattormm"))
    .limit(1);
  if (!row) throw new Error("Datto RMM integration not configured");
  const config = row.config as Record<string, unknown>;
  const url = config.url as string | undefined;
  const apiKey = config.apiKey as string | undefined;
  const encryptedSecret = config.apiSecretKey as string | undefined;
  if (!url || !apiKey || !encryptedSecret) throw new Error("Datto RMM integration missing credentials");
  const apiSecretKey = Encryption.decrypt(encryptedSecret, encryptionKey);
  if (!apiSecretKey) throw new Error("Datto RMM apiSecretKey could not be decrypted");
  return new DattoConnector(url, apiKey, apiSecretKey);
}

async function getCoveConnector(
  db: any,
  encryptionKey: string,
): Promise<{ connector: CoveConnector; rootPartnerId: number }> {
  const [row] = await db
    .select({ config: integrations.config })
    .from(integrations)
    .where(eq(integrations.id, "cove"))
    .limit(1);
  if (!row) throw new Error("Cove integration not configured");
  const config = row.config as Record<string, unknown>;
  const server = config.server as string | undefined;
  const clientId = config.clientId as string | undefined;
  const encryptedSecret = config.clientSecret as string | undefined;
  // partnerId is stored directly in the integration config at setup time.
  const rootPartnerId = Number(config.partnerId);
  if (!server || !clientId || !encryptedSecret) throw new Error("Cove integration missing credentials");
  if (!Number.isFinite(rootPartnerId)) throw new Error("Cove integration missing partnerId — re-save the Cove integration to populate it");
  const clientSecret = Encryption.decrypt(encryptedSecret, encryptionKey);
  if (!clientSecret) throw new Error("Cove client secret could not be decrypted");

  return { connector: new CoveConnector(server, clientId, clientSecret), rootPartnerId };
}

async function getHaloPSAConnector(
  db: any,
  siteId: string,
  encryptionKey: string,
): Promise<{ connector: HaloPSAConnector; haloSiteId: number }> {
  const [row] = await db
    .select({
      config: integrations.config,
      haloSiteId: integrationLinks.externalId,
    })
    .from(integrationLinks)
    .innerJoin(integrations, eq(integrationLinks.integrationId, integrations.id))
    .where(and(eq(integrationLinks.integrationId, "halopsa"), eq(integrationLinks.siteId, siteId)))
    .limit(1);
  if (!row?.haloSiteId) throw new Error("HaloPSA is not linked to this site");
  const haloSiteId = Number(row.haloSiteId);
  if (!Number.isInteger(haloSiteId) || haloSiteId < 0) {
    throw new Error("The HaloPSA site link has an invalid external ID");
  }
  const config = row.config as Record<string, unknown>;
  const url = config.url as string | undefined;
  const clientId = config.clientId as string | undefined;
  const encryptedSecret = config.clientSecret as string | undefined;
  if (!url || !clientId || !encryptedSecret) throw new Error("HaloPSA integration missing credentials");
  const clientSecret = Encryption.decrypt(encryptedSecret, encryptionKey);
  if (!clientSecret) throw new Error("HaloPSA client secret could not be decrypted");
  return { connector: new HaloPSAConnector(url, clientId, clientSecret), haloSiteId };
}

async function lookupSite(
  db: any,
  siteId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  return row ?? null;
}

async function createSite(
  db: any,
  name: string,
  description?: string,
): Promise<{ id: string; name: string }> {
  const [site] = await db
    .insert(sites)
    .values({ name, description })
    .returning({ id: sites.id, name: sites.name });
  if (!site) throw new Error(`Failed to create site '${name}'`);
  return site;
}

async function createIntegrationLink(
  db: any,
  opts: CreateIntegrationLinkOpts,
): Promise<{ id: string }> {
  const [link] = await db
    .insert(integrationLinks)
    .values({
      integrationId: opts.integrationId,
      siteId: opts.siteId,
      externalId: opts.externalId,
      name: opts.name,
      status: opts.status ?? "active",
      meta: opts.meta ?? null,
    })
    .returning({ id: integrationLinks.id });
  if (!link) throw new Error(`Failed to create integration link for site ${opts.siteId}`);
  return link;
}

async function writeAuditLog(
  db: any,
  args: {
    run: any;
    capability: AnyCapability;
    position: number;
    resolvedInputs: Record<string, unknown>;
    result: CapabilityResult<unknown>;
  },
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(customerLogs)
      .values({
        siteId: args.run.siteId,
        actorType: "user",
        actorId: args.run.triggeredByUserId ?? "system",
        actorLabel: args.run.triggeredByUserId ?? "system",
        action: args.capability.auditAction,
        actionLabel: args.capability.actionLabel,
        targetType: `capability.${args.capability.id}`,
        targetId: args.run.id,
        targetLabel: args.capability.name,
        result:
          args.result.outcome === "success"
            ? "success"
            : args.result.outcome === "skip"
              ? "success"
              : "failure",
        errorMessage:
          args.result.outcome === "fail" ? args.result.message : null,
        metadata: {
          packageRunId: args.run.id,
          packageStepPosition: args.position,
          skipped: args.result.outcome === "skip",
        },
      })
      .returning({ id: customerLogs.id });
    return row?.id ?? null;
  } catch (error) {
    logger.warn("Failed to write audit log", { error: serializeError(error) });
    return null;
  }
}

async function failStep(
  db: any,
  stepId: string,
  args: {
    errorClass: ErrorClass;
    message: string;
    resolvedInputs: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .update(packageRunSteps)
    .set({
      status: "fail",
      errorClass: args.errorClass,
      errorMessage: args.message,
      resolvedInputs: args.resolvedInputs,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(packageRunSteps.id, stepId));
}

async function recordStepFailure(
  db: any,
  packageRunId: string,
  position: number,
  capabilityId: string,
  args: { errorClass: ErrorClass; message: string },
): Promise<void> {
  await db.insert(packageRunSteps).values({
    packageRunId,
    position,
    capabilityId,
    status: "fail",
    errorClass: args.errorClass,
    errorMessage: args.message,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });
}

async function seedPriorOutputs(args: {
  db: any;
  parentRunId: string;
  upToPosition: number;
  snapshot: PackageSnapshot;
  encryptionKey: string;
  stepOutputs: Map<number, Record<string, unknown>>;
}): Promise<void> {
  const priorSteps = await args.db
    .select()
    .from(packageRunSteps)
    .where(
      and(
        eq(packageRunSteps.packageRunId, args.parentRunId),
        eq(packageRunSteps.lane, 'main'),
      ),
    );

  for (const step of priorSteps as Array<{
    position: number;
    status: string;
    outputs: unknown;
    capabilityId: string;
  }>) {
    if (step.position >= args.upToPosition) continue;
    if (step.status !== "success") continue;
    const capability = getCapability(step.capabilityId);
    if (!capability) continue;
    const encrypted = (step.outputs ?? {}) as Record<string, unknown>;
    const decrypted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(encrypted)) {
      const meta = capability.outputMeta[key];
      if (meta?.sensitive && typeof value === "string") {
        const raw = Encryption.decrypt(value, args.encryptionKey);
        if (raw === undefined) {
          throw new Error(`EXPIRED_OUTPUTS: cannot decrypt ${step.capabilityId}.${key}`);
        }
        decrypted[key] = JSON.parse(raw);
      } else {
        decrypted[key] = value;
      }
    }
    args.stepOutputs.set(step.position, decrypted);
  }
}

async function sumBillable(db: any, packageRunId: string): Promise<number> {
  const rows = await db
    .select({ unitPrice: packageRunSteps.unitPrice, billable: packageRunSteps.billable })
    .from(packageRunSteps)
    .where(
      and(
        eq(packageRunSteps.packageRunId, packageRunId),
        eq(packageRunSteps.status, "success"),
      ),
    );
  return rows.reduce((total: number, row: { unitPrice: string | null; billable: boolean }) => {
    if (!row.billable || !row.unitPrice) return total;
    return total + Number(row.unitPrice);
  }, 0);
}
