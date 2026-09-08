import { sophosFirewallLicenses, syncRuns, syncRunStages } from '@mspbyte/drizzle';
import { PROVIDER_IDS, ProviderFacet } from '@mspbyte/shared';
import { and, eq, lt } from 'drizzle-orm';
import type { ProjectionStep, ProjectionStepContext } from '../contracts/steps.js';

export const sophosEnrichers: readonly ProjectionStep[] = [
  {
    id: 'sophos.firewall-license-reconcile',
    kind: 'enrich',
    provider: PROVIDER_IDS.SOPHOS,
    triggerFacets: new Set([ProviderFacet.SophosFirewallLicenses]),
    requiredFacets: [ProviderFacet.SophosFirewallLicenses],
    shouldRun: shouldReconcileFirewallLicenses,
    run: reconcileFirewallLicenses
  }
];

async function shouldReconcileFirewallLicenses(
  context: ProjectionStepContext
): Promise<{ run: true } | { run: false; reason: string }> {
  const [run] = await context.db
    .select({ mode: syncRuns.mode, startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(eq(syncRuns.id, context.syncRunId))
    .limit(1);
  if (!run || run.mode !== 'full' || !run.startedAt) {
    return { run: false, reason: 'not_a_full_sync' };
  }

  const [stage] = await context.db
    .select({ failedCt: syncRunStages.failedCt })
    .from(syncRunStages)
    .where(
      and(
        eq(syncRunStages.syncRunId, context.syncRunId),
        eq(syncRunStages.type, ProviderFacet.SophosFirewallLicenses),
        eq(syncRunStages.stage, 'project')
      )
    )
    .limit(1);
  if ((stage?.failedCt ?? 0) > 0) return { run: false, reason: 'projection_failures' };
  return { run: true };
}

async function reconcileFirewallLicenses(
  context: ProjectionStepContext
): Promise<Record<string, unknown>> {
  const [run] = await context.db
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(eq(syncRuns.id, context.syncRunId))
    .limit(1);
  if (!run?.startedAt) return { deleted: 0 };

  const deleted = await context.db
    .delete(sophosFirewallLicenses)
    .where(
      and(
        eq(sophosFirewallLicenses.linkId, context.linkId),
        lt(sophosFirewallLicenses.lastSeenAt, run.startedAt)
      )
    )
    .returning({ id: sophosFirewallLicenses.id });
  return { deleted: deleted.length };
}
