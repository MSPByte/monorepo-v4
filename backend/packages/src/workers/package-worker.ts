import { Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import {
  customerLogs,
  integrationLinks,
  integrations,
  m365Identities,
  packageRuns,
  packageRunSteps,
} from "@mspbyte/drizzle";
import type { PackageJobData } from "@mspbyte/pipeline";
import {
  getCapability,
  type AnyCapability,
  type Binding,
  type CapabilityCtx,
  type CapabilityResult,
  type M365IdentityRow,
} from "@mspbyte/capabilities";
import type { M365Connector } from "@mspbyte/connectors";
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
};

type PackageSnapshot = {
  id: string;
  name: string;
  version: number;
  steps: StepDefinition[];
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

      // Retry-from-step-N: seed prior step outputs from parent run so
      // downstream steps' priorOutput bindings still resolve.
      if (run.startStepIndex > 0 && run.parentRunId) {
        try {
          await seedPriorOutputs({
            db,
            parentRunId: run.parentRunId,
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

      const ctxBase: Omit<CapabilityCtx, "packageRunStepId"> = {
        encryptionKey,
        user: {
          id: run.triggeredByUserId ?? "system",
          name: null,
          email: null,
        },
        packageRunId,
        loadM365Identity: (id: string) => loadIdentity(db, id),
        getM365Connector: (linkId: string) =>
          getConnector(db, connectorCache, linkId, encryptionKey),
      };

      let halted = false;

      for (let position = run.startStepIndex; position < snapshot.steps.length; position++) {
        const step = snapshot.steps[position]!;
        const capability = getCapability(step.capabilityId);
        if (!capability) {
          await recordStepFailure(db, packageRunId, position, step.capabilityId, {
            errorClass: "CAPABILITY_MISSING",
            message: `Unknown capability ${step.capabilityId}`,
          });
          halted = true;
          break;
        }

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
        );
        if (!resolveResult.ok) {
          await failStep(db, stepRow.id, {
            errorClass: "BINDING_UNRESOLVED",
            message: resolveResult.error,
            resolvedInputs: {},
          });
          halted = true;
          break;
        }

        const parsed = capability.inputs.safeParse(resolveResult.value);
        if (!parsed.success) {
          await failStep(db, stepRow.id, {
            errorClass: "INPUT_VALIDATION",
            message: parsed.error.message,
            resolvedInputs: encryptSensitiveInputs(
              resolveResult.value,
              capability,
              encryptionKey,
            ),
          });
          halted = true;
          break;
        }

        const ctx: CapabilityCtx = { ...ctxBase, packageRunStepId: stepRow.id };
        let result: CapabilityResult<unknown>;
        try {
          result = await capability.handler(ctx, parsed.data);
        } catch (error) {
          result = {
            outcome: "fail",
            errorClass: "HANDLER_THREW",
            message: error instanceof Error ? error.message : String(error),
          };
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
        halted = true;
        break;
      }

      const finalStatus = halted ? "halted" : "completed";
      const totalBillable = await sumBillable(db, packageRunId);
      await db
        .update(packageRuns)
        .set({
          status: finalStatus,
          billingTotal: totalBillable.toFixed(4),
          finishedAt: new Date().toISOString(),
        })
        .where(eq(packageRuns.id, packageRunId));

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

function resolveBindings(
  bindings: Record<string, Binding>,
  runtimeInputs: Record<string, unknown>,
  stepOutputs: Map<number, Record<string, unknown>>,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value: Record<string, unknown> = {};
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
        const prior = stepOutputs.get(binding.stepPosition);
        if (!prior) {
          return {
            ok: false,
            error: `Prior step ${binding.stepPosition} has no outputs`,
          };
        }
        value[name] = getByPath(prior, binding.path);
        break;
      }
    }
  }
  return { ok: true, value };
}

function getByPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
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
    errorClass: string;
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
  args: { errorClass: string; message: string },
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
    .where(eq(packageRunSteps.packageRunId, args.parentRunId));

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
