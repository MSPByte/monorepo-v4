import { inArray, eq } from 'drizzle-orm';
import { packages as packagesTable } from '@mspbyte/drizzle';
import { capabilityCandidates, getCatalogDb } from '@mspbyte/drizzle-catalog';
import {
  collectPackageRuntimeInputs,
  type PackageRuntimeInput,
  type ResolvedInputMeta,
  type AgentFormPackageBindings,
  type AgentFormSystemSourceKey,
} from '@mspbyte/shared';
import { getCapability } from '@mspbyte/capabilities';
import {
  buildEmbeddedChildren,
  createPendingPackageRun,
  loadMatchingGroupIds,
  packageMatchesScope,
  readPackageScope,
} from '@mspbyte/pipeline';
import { getTenantDbForOrg } from './db.js';
import { logger } from './logger.js';

type Db = Awaited<ReturnType<typeof getTenantDbForOrg>>;

export type FormAutomationSkipReason =
  | 'package_missing'
  | 'package_inactive'
  | 'site_not_allowed'
  | 'no_verified_identity'
  | 'missing_inputs';

type PackageRow = typeof packagesTable.$inferSelect;

export type PreparedFormAutomation =
  | { willRun: false; reason: FormAutomationSkipReason }
  | {
      willRun: true;
      pkg: PackageRow;
      // Fully resolved except ticket-bound keys, which are filled at launch.
      runtimeInputs: Record<string, unknown>;
      ticketBoundKeys: string[];
    };

// Values are strings coming out of the agent form renderer; coerce them to
// what the capability's zod schema expects. Empty strings count as unset so
// the required check below catches them.
function coerceAnswer(raw: unknown, input: PackageRuntimeInput): unknown {
  if (raw === undefined || raw === null || raw === '') return undefined;
  switch (input.typeHint) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean':
      return raw === true || ['true', '1', 'on', 'yes'].includes(String(raw).toLowerCase());
    default:
      return String(raw);
  }
}

// Resolves everything decidable before the ticket exists. The submit route
// uses the result to (a) annotate the ticket when automation is skipped and
// (b) launch the run once the ticket ID is known.
export async function prepareFormAutomation(
  db: Db,
  args: {
    packageId: string;
    bindings: AgentFormPackageBindings;
    siteId: string;
    answers: Record<string, unknown>;
    // Verified/system values available pre-ticket. entra_* keys are only
    // present when the submitter's token verified.
    system: Partial<Record<AgentFormSystemSourceKey, string>>;
  },
): Promise<PreparedFormAutomation> {
  const [pkg] = await db
    .select()
    .from(packagesTable)
    .where(eq(packagesTable.id, args.packageId))
    .limit(1);
  if (!pkg) return { willRun: false, reason: 'package_missing' };
  if (pkg.status !== 'active') return { willRun: false, reason: 'package_inactive' };

  const scope = readPackageScope(pkg);
  const groupIds = await loadMatchingGroupIds(db, { siteId: args.siteId });
  if (!packageMatchesScope(scope, { siteId: args.siteId }, groupIds)) {
    return { willRun: false, reason: 'site_not_allowed' };
  }

  // Resolve capability inputMeta: code registry first, catalog candidates for
  // the rest (same recipe as the tRPC save-time validation).
  const unresolvedIds = new Set<string>();
  const lanes = [
    (pkg.steps as Array<{ kind?: string; capabilityId?: string }>) ?? [],
    ...(Object.values((pkg.outcomeSteps as Record<string, unknown[]>) ?? {}) as Array<
      Array<{ kind?: string; capabilityId?: string }>
    >),
  ];
  for (const lane of lanes) {
    for (const step of lane) {
      if (step?.capabilityId && step.kind !== 'subpackage' && !getCapability(step.capabilityId)) {
        unresolvedIds.add(step.capabilityId);
      }
    }
  }
  const catalogMeta = new Map<string, ResolvedInputMeta>();
  if (unresolvedIds.size > 0) {
    const rows = await getCatalogDb()
      .select({ id: capabilityCandidates.id, inputMeta: capabilityCandidates.inputMeta })
      .from(capabilityCandidates)
      .where(inArray(capabilityCandidates.id, [...unresolvedIds]));
    for (const row of rows) catalogMeta.set(row.id, (row.inputMeta ?? {}) as ResolvedInputMeta);
  }

  const collection = collectPackageRuntimeInputs(pkg, (id) => {
    const code = getCapability(id);
    if (code) return code.inputMeta as ResolvedInputMeta;
    return catalogMeta.get(id) ?? null;
  });

  const runtimeInputs: Record<string, unknown> = {};
  const ticketBoundKeys: string[] = [];
  const missingRequired: { key: string; entra: boolean }[] = [];

  // Packages remain editable after a form is linked. Fail closed if the
  // package now contains unresolved capabilities or a form binding now points
  // at a sensitive input; the already-created ticket remains the fallback.
  if (collection.unresolvedCapabilityIds.length > 0) {
    return { willRun: false, reason: 'missing_inputs' };
  }

  for (const input of collection.inputs) {
    const source = args.bindings[input.promptKey];
    if (source && (input.sensitive || input.typeHint === 'password')) {
      return { willRun: false, reason: 'missing_inputs' };
    }
    if (!source) {
      if (input.required) missingRequired.push({ key: input.promptKey, entra: false });
      continue;
    }

    let value: unknown;
    let isEntra = false;
    if (source.kind === 'formField') {
      value = coerceAnswer(args.answers[source.fieldId], input);
    } else if (source.kind === 'literal') {
      value = coerceAnswer(source.value, input);
    } else if (source.key === 'ticket_id') {
      ticketBoundKeys.push(input.promptKey);
      continue;
    } else {
      isEntra = source.key.startsWith('entra_');
      value = args.system[source.key];
    }

    if (value === undefined) {
      if (input.required) missingRequired.push({ key: input.promptKey, entra: isEntra });
      continue;
    }
    runtimeInputs[input.promptKey] = value;
  }

  if (missingRequired.length > 0) {
    const reason = missingRequired.every((m) => m.entra) ? 'no_verified_identity' : 'missing_inputs';
    return { willRun: false, reason };
  }

  return { willRun: true, pkg, runtimeInputs, ticketBoundKeys };
}

// Creates the pending package_runs row; the backend/packages poller picks it
// up and pushes it to BullMQ (frontend/agents never touch Redis queues).
export async function launchFormPackageRun(
  db: Db,
  prepared: Extract<PreparedFormAutomation, { willRun: true }>,
  args: {
    ticketId: string;
    formId: string;
    formName: string;
    agentId: string;
    siteId: string;
    submitterLabel: string;
    entraOid?: string;
  },
): Promise<{ packageRunId: string } | null> {
  const { pkg } = prepared;
  const runtimeInputs = { ...prepared.runtimeInputs };
  for (const key of prepared.ticketBoundKeys) runtimeInputs[key] = args.ticketId;

  try {
    const children = await buildEmbeddedChildren(
      db,
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
      skippedStepIndexes: [],
    };

    const steps = (pkg.steps as Array<{ capabilityId: string }>) ?? [];
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

    return await createPendingPackageRun(db, {
      packageId: pkg.id,
      packageVersion: pkg.version,
      packageSnapshot,
      siteId: args.siteId,
      triggerType: 'form',
      triggerRef: {
        formId: args.formId,
        agentId: args.agentId,
        siteId: args.siteId,
        ticketId: args.ticketId,
        ...(args.entraOid ? { entraOid: args.entraOid } : {}),
      },
      triggerSourceLabel: `${args.formName} — ${args.submitterLabel}`,
      runtimeInputs,
      billingSnapshot,
    });
  } catch (err) {
    logger.error('Failed to trigger form package run', {
      err: String(err),
      packageId: pkg.id,
      formId: args.formId,
    });
    return null;
  }
}
