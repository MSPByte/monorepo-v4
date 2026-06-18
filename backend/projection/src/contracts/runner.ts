import {
  completeProjectionStepStage,
  failProjectionStepStage,
  startProjectionStepStage,
} from "../db/project.js";
import { logger } from "../logger.js";
import {
  type ProjectionStep,
  type ProjectionStepContext,
  type ProjectionStepKind,
  type ProjectionStepRunResult,
  shouldRunStep,
} from "./steps.js";

type StageMetrics = {
  steps: ProjectionStepRunResult[];
};

export async function runProjectionSteps(
  context: ProjectionStepContext,
  steps: readonly ProjectionStep[],
  bullmqJobId: string,
): Promise<Record<ProjectionStepKind, StageMetrics>> {
  const results: Record<ProjectionStepKind, StageMetrics> = {
    link: { steps: [] },
    enrich: { steps: [] },
  };

  for (const kind of ["link", "enrich"] as const) {
    const stageSteps = steps.filter(
      (step) =>
        step.kind === kind &&
        step.provider === context.provider &&
        step.triggerFacets.has(context.type),
    );
    if (stageSteps.length === 0) continue;

    const stageId = await startProjectionStepStage(context.db, {
      syncRunId: context.syncRunId,
      provider: context.provider,
      type: context.type,
      bullmqJobId,
      stage: kind,
    });

    try {
      for (const step of stageSteps) {
        const result = await runStep(context, step);
        results[kind].steps.push(result);
      }

      await completeProjectionStepStage(context.db, stageId, results[kind]);
    } catch (error) {
      await failProjectionStepStage(context.db, stageId, error);
      throw error;
    }
  }

  return results;
}

async function runStep(
  context: ProjectionStepContext,
  step: ProjectionStep,
): Promise<ProjectionStepRunResult> {
  const decision = await shouldRunStep(step, context);
  if (!decision.run) {
    logger.debug("Projection step skipped", {
      orgId: context.orgId,
      linkId: context.linkId,
      provider: context.provider,
      type: context.type,
      stepId: step.id,
      kind: step.kind,
      reason: decision.reason,
    });
    return {
      id: step.id,
      kind: step.kind,
      ran: false,
      skippedReason: decision.reason,
      metrics: {},
    };
  }

  const metrics = await step.run(context);
  logger.info("Projection step completed", {
    orgId: context.orgId,
    linkId: context.linkId,
    provider: context.provider,
    type: context.type,
    stepId: step.id,
    kind: step.kind,
    ...metrics,
  });

  return {
    id: step.id,
    kind: step.kind,
    ran: true,
    metrics,
  };
}
