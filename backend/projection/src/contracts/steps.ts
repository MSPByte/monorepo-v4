import { and, eq, isNotNull } from "drizzle-orm";
import { syncContext } from "@mspbyte/drizzle";

export type Db = any;
export type ProjectionStepKind = "link" | "enrich";

export type ProjectionStepContext = {
  db: Db;
  orgId: string;
  linkId: string;
  provider: string;
  type: string;
  syncRunId: string;
  rawBatchId: string;
};

export type ProjectionStepDecision =
  | { run: true }
  | { run: false; reason: string };

export type ProjectionStepResult = {
  ran: boolean;
  skippedReason?: string;
  metrics: Record<string, unknown>;
};

export type ProjectionStep = {
  id: string;
  kind: ProjectionStepKind;
  provider: string;
  triggerFacets: ReadonlySet<string>;
  requiredFacets: readonly string[];
  shouldRun?: (
    context: ProjectionStepContext,
  ) => Promise<ProjectionStepDecision>;
  run: (context: ProjectionStepContext) => Promise<Record<string, unknown>>;
};

export type ProjectionStepRunResult = ProjectionStepResult & {
  id: string;
  kind: ProjectionStepKind;
};

export async function shouldRunStep(
  step: ProjectionStep,
  context: ProjectionStepContext,
): Promise<ProjectionStepDecision> {
  if (step.provider !== context.provider) {
    return { run: false, reason: "provider_mismatch" };
  }

  if (!step.triggerFacets.has(context.type)) {
    return { run: false, reason: "facet_not_triggered" };
  }

  const missingFacets = await missingRequiredFacets(
    context,
    step.requiredFacets,
  );
  if (missingFacets.length > 0) {
    return {
      run: false,
      reason: `missing_required_facets:${missingFacets.join(",")}`,
    };
  }

  return step.shouldRun ? step.shouldRun(context) : { run: true };
}

async function missingRequiredFacets(
  context: ProjectionStepContext,
  requiredFacets: readonly string[],
): Promise<string[]> {
  if (requiredFacets.length === 0) return [];

  const rows = (await context.db
    .select({ type: syncContext.type })
    .from(syncContext)
    .where(
      and(
        eq(syncContext.linkId, context.linkId),
        eq(syncContext.integrationId, context.provider),
        isNotNull(syncContext.lastSuccessAt),
      ),
    )) as Array<{ type: string }>;

  const completed = new Set(rows.map((row) => row.type));
  return requiredFacets.filter((facet) => !completed.has(facet));
}
