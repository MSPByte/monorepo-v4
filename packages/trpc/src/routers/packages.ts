import { z } from 'zod';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  customerLogs,
  integrationLinks,
  m365Groups,
  m365Identities,
  m365Licenses,
  m365Roles,
  packageDependencies,
  packageRuns,
  packageSchedules,
  packages,
  sites,
  sophosEndpoints,
  siteGroupLinkMembers,
  siteProfileFields,
} from '@mspbyte/drizzle';
import { sql } from 'drizzle-orm';
import {
  getCapability,
  getGenerator,
  isCapabilityAvailable,
  listCapabilities,
  listGenerators,
  FAILURE_CONTEXT_PATHS,
  PACKAGE_FIELD_TYPES,
  packageFieldTypeLabel,
  resolveInputFieldType,
  resolveOutputFieldType,
} from '@mspbyte/capabilities';
import {
  ActionLabels,
  fieldTypeLabel,
  resolveSiteFactFieldType,
} from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { capabilityCandidates } from '@mspbyte/drizzle-catalog';
import { t, authProcedure } from '../trpc.js';
import {
  assertTenantScopedIntegrationLinks,
  loadMatchingGroupIds,
  packageMatchesScope,
  readPackageScope,
} from './package-scope.js';
import {
  findUnavailableCapabilities,
  loadCapabilityAvailabilityInventory,
  unavailableCapabilitiesMessage,
} from '../capability-availability.js';

// Bindings are validated shallowly here — the worker's zod.parse on
// capability.inputs is the real gate. The builder UI is trusted to compose
// valid shapes; we still enforce kind + required keys so obvious mistakes
// don't get persisted.
const bindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: z.unknown() }),
  z.object({
    kind: z.literal('runtime'),
    promptKey: z.string().min(1),
    required: z.boolean(),
  }),
  z.object({
    kind: z.literal('failureContext'),
    path: z.enum(FAILURE_CONTEXT_PATHS),
  }),
  z.object({
    kind: z.literal('entity'),
    source: z.enum(['row-context', 'picker']),
    entityType: z.string().min(1),
    pickerConfig: z
      .object({
        multi: z.boolean().optional(),
        filter: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    contextKey: z.string().optional(),
  }),
  z.object({
    kind: z.literal('priorOutput'),
    stepPosition: z.number().int().min(0),
    path: z.string().min(1),
    lane: z.enum(['main', 'onSuccess', 'onFailure']).optional(),
  }),
  z.object({
    kind: z.literal('generated'),
    generator: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal('siteFact'),
    key: z.string().min(1),
    required: z.boolean(),
  }),
]);

// Maximum sub-package nesting depth. A tree of packages A→B→C→D→E is depth 5;
// adding one more level is rejected at save time. Keeps debugging tractable
// and bounds the retryPath length used for leaf replay.
export const MAX_SUBPACKAGE_DEPTH = 5;

const capabilityStepSchema = z.object({
  kind: z.literal('capability').default('capability'),
  capabilityId: z.string().min(1),
  label: z.string().optional(),
  optional: z.boolean().default(false),
  inputBindings: z.record(z.string(), bindingSchema),
  onFailure: z.enum(['halt', 'continue']).default('halt'),
  retryAttempts: z.number().int().min(0).max(5).default(0),
});

const subpackageStepSchema = z.object({
  kind: z.literal('subpackage'),
  packageId: z.uuid(),
  label: z.string().optional(),
  optional: z.boolean().default(false),
  inputBindings: z.record(z.string(), bindingSchema),
  onFailure: z.enum(['halt', 'continue']).default('halt'),
  retryAttempts: z.number().int().min(0).max(5).default(0),
});

// Legacy step rows persisted before the discriminator existed carry no `kind`.
// Preprocess normalizes them to `capability` so the union parses cleanly.
const stepSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === 'object' && !('kind' in (raw as Record<string, unknown>))) {
      return { ...(raw as Record<string, unknown>), kind: 'capability' };
    }
    return raw;
  },
  z.discriminatedUnion('kind', [capabilityStepSchema, subpackageStepSchema]),
);
type ParsedStep = z.infer<typeof stepSchema>;

const exposedOutputSchema = z.object({
  name: z.string().min(1).max(160),
  sourceStepPosition: z.number().int().min(0),
  sourcePath: z.string().min(1),
  outputType: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
});
type ParsedExposedOutput = z.infer<typeof exposedOutputSchema>;

const promptSchema = z.object({
  id: z.string().min(1).max(160),
  label: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  required: z.boolean().default(true),
  section: z.string().max(100).optional(),
  order: z.number().int().min(0).default(0),
});

const outcomeStepsSchema = z.object({
  onSuccess: z.array(stepSchema).default([]),
  onFailure: z.array(stepSchema).default([]),
});

const failureActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('log') }),
  z.object({
    kind: z.literal('email'),
    to: z.array(z.string().email()).min(1),
    subject: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('psa_ticket'),
    boardId: z.string().optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
  }),
]);

const packageInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  steps: z.array(stepSchema).min(1),
  prompts: z.array(promptSchema).default([]),
  outcomeSteps: outcomeStepsSchema.default({ onSuccess: [], onFailure: [] }),
  failureActions: z.array(failureActionSchema).default([]),
  exposedOutputs: z.array(exposedOutputSchema).default([]),
  // Scope: empty arrays => global. Non-empty restricts which sites can run
  // this package (site direct-match, tenant direct-match, or any matching group).
  allowedSites: z.array(z.uuid()).default([]),
  allowedSiteGroups: z.array(z.uuid()).default([]),
  allowedIntegrationLinks: z.array(z.uuid()).default([]),
});

const entityTypeSchema = z.enum([
  'integration_link',
  'm365_identity',
  'm365_group',
  'm365_license',
  'm365_role',
  'sophos_endpoint',
]);
type EntityOption = {
  id: string;
  label: string;
  subLabel?: string;
  // When true, the picker renders the row muted and refuses selection — used
  // for licenses that are fully consumed, disabled sites, etc.
  disabled?: boolean;
};

// Metadata about a sub-package's public contract used to type-check parent
// bindings that reference it. Populated on demand from the DB in `validateSubpackageRefs`.
type SubpackageMeta = {
  packageId: string;
  status: 'draft' | 'active' | 'archived';
  name: string;
  prompts: Array<z.infer<typeof promptSchema>>;
  exposedOutputs: ParsedExposedOutput[];
};

// Rejects obviously broken bindings: unknown capabilityId, priorOutput
// pointing forward, entity bindings whose entityType the capability doesn't
// declare, etc. Real type-checking of literal values happens at run time via
// zod on capability.inputs.
//
// Sub-package steps validate against the child's `prompts` (for inputBindings)
// and `exposedOutputs` (for downstream priorOutput references). The child
// metadata is provided by the caller after an async DB fetch — see
// `validateSubpackageRefs`.
function validateStepsAgainstRegistry(
  steps: ParsedStep[],
  lane: 'main' | 'onSuccess' | 'onFailure' = 'main',
  subpackageMeta: Map<string, SubpackageMeta> = new Map(),
  catalogCandidateIds: ReadonlySet<string> = new Set(),
): string | null {
  for (let pos = 0; pos < steps.length; pos++) {
    const step = steps[pos]!;

    // ---- Sub-package step branch -------------------------------------------
    if (step.kind === 'subpackage') {
      const child = subpackageMeta.get(step.packageId);
      if (!child) {
        return `Step ${pos + 1}: sub-package ${step.packageId} not found`;
      }
      if (child.status !== 'active') {
        return `Step ${pos + 1}: sub-package "${child.name}" must be active (currently ${child.status})`;
      }
      const promptIds = new Set(child.prompts.map((p) => p.id));
      for (const [inputName, binding] of Object.entries(step.inputBindings)) {
        if (!promptIds.has(inputName)) {
          return `Step ${pos + 1}: sub-package "${child.name}" has no prompt "${inputName}"`;
        }
        if (binding.kind === 'priorOutput') {
          const sourceLane = binding.lane ?? 'main';
          if (lane === 'main' && sourceLane !== 'main') {
            return `Step ${pos + 1} main path cannot read from a terminal lane`;
          }
          if (sourceLane === lane && binding.stepPosition >= pos) {
            return `Step ${pos + 1} priorOutput can only reference an earlier step in the same lane`;
          }
        }
        if (binding.kind === 'failureContext' && lane !== 'onFailure') {
          return `Step ${pos + 1} can only read failure context inside the On failure lane`;
        }
        if (binding.kind === 'generated') {
          const generator = getGenerator(binding.generator);
          if (!generator) {
            return `Step ${pos + 1} input "${inputName}" references unknown generator "${binding.generator}"`;
          }
          const parsed = generator.paramsSchema.safeParse(binding.params);
          if (!parsed.success) {
            return `Step ${pos + 1} input "${inputName}" generator params invalid: ${parsed.error.message}`;
          }
        }
      }
      continue;
    }

    // ---- Capability step branch -------------------------------------------
    const cap = getCapability(step.capabilityId);
    if (!cap) {
      // Catalog candidates (approved/live) are valid but not in the code registry.
      if (catalogCandidateIds.has(step.capabilityId)) continue;
      return `Unknown capability at step ${pos + 1}: ${step.capabilityId}`;
    }
    for (const [inputName, binding] of Object.entries(step.inputBindings)) {
      const meta = cap.inputMeta[inputName];
      if (!meta) return `Step ${pos + 1}: capability has no input "${inputName}"`;
      if (!meta.allowedBindings.includes(binding.kind)) {
        return `Step ${pos + 1} input "${inputName}" does not allow binding kind "${binding.kind}"`;
      }
      if (binding.kind === 'entity' && meta.entityType && binding.entityType !== meta.entityType) {
        return `Step ${pos + 1} input "${inputName}" expects entity type "${meta.entityType}" (got "${binding.entityType}")`;
      }
      if (binding.kind === 'priorOutput') {
        const sourceLane = binding.lane ?? 'main';
        if (lane === 'main' && sourceLane !== 'main') {
          return `Step ${pos + 1} main path cannot read from a terminal lane`;
        }
        if (lane === 'onFailure' && sourceLane === 'main') {
          return `Step ${pos + 1} failure reactions cannot read from the main path because it may have stopped before that output existed`;
        }
        if (sourceLane !== 'main' && sourceLane !== lane) {
          return `Step ${pos + 1} can only read from an earlier reaction in its own lane`;
        }
        if (sourceLane === lane && binding.stepPosition >= pos) {
          return `Step ${pos + 1} priorOutput can only reference an earlier step in the same lane`;
        }
        // If the source step is itself a sub-package, verify the referenced
        // path is a declared exposed output. Downstream capability inputs
        // that don't declare an outputType stay permissive as they do today.
        const sourceStep = steps[binding.stepPosition];
        if (sourceStep && sourceStep.kind === 'subpackage') {
          const child = subpackageMeta.get(sourceStep.packageId);
          if (child) {
            const exposed = child.exposedOutputs.find((o) => o.name === binding.path);
            if (!exposed) {
              return `Step ${pos + 1} input "${inputName}" reads "${binding.path}" from sub-package "${child.name}" but that output is not exposed`;
            }
          }
        }
      }
      if (binding.kind === 'failureContext' && lane !== 'onFailure') {
        return `Step ${pos + 1} can only read failure context inside the On failure lane`;
      }
      if (binding.kind === 'generated') {
        const generator = getGenerator(binding.generator);
        if (!generator) {
          return `Step ${pos + 1} input "${inputName}" references unknown generator "${binding.generator}"`;
        }
        if (meta.typeHint && !generator.appliesToTypeHints.includes(meta.typeHint)) {
          return `Step ${pos + 1} input "${inputName}" (${meta.typeHint}) is not compatible with generator "${binding.generator}"`;
        }
        const parsed = generator.paramsSchema.safeParse(binding.params);
        if (!parsed.success) {
          return `Step ${pos + 1} input "${inputName}" generator params invalid: ${parsed.error.message}`;
        }
      }
    }
  }
  return null;
}

// Validates the `exposedOutputs` contract on a package definition: each entry
// must point at a real step position, and (for capability steps) a real output
// name on that capability. Sub-package-sourced exposed outputs re-export a
// name from the child's own exposed contract.
function validateExposedOutputs(
  exposedOutputs: ParsedExposedOutput[],
  steps: ParsedStep[],
  subpackageMeta: Map<string, SubpackageMeta>,
): string | null {
  const seen = new Set<string>();
  for (const [idx, out] of exposedOutputs.entries()) {
    if (seen.has(out.name)) {
      return `Exposed output #${idx + 1}: duplicate name "${out.name}"`;
    }
    seen.add(out.name);
    if (out.sourceStepPosition < 0 || out.sourceStepPosition >= steps.length) {
      return `Exposed output "${out.name}" references step position ${out.sourceStepPosition + 1} which does not exist`;
    }
    const step = steps[out.sourceStepPosition]!;
    if (step.kind === 'subpackage') {
      const child = subpackageMeta.get(step.packageId);
      if (!child) continue;
      if (!child.exposedOutputs.some((c) => c.name === out.sourcePath)) {
        return `Exposed output "${out.name}" reads "${out.sourcePath}" from sub-package "${child.name}" but that output is not exposed`;
      }
      continue;
    }
    const cap = getCapability(step.capabilityId);
    if (!cap) continue;
    const firstSegment = out.sourcePath.split('.')[0]!;
    if (!(firstSegment in cap.outputMeta)) {
      return `Exposed output "${out.name}" reads "${out.sourcePath}" from step ${out.sourceStepPosition + 1} but capability "${cap.name}" has no output "${firstSegment}"`;
    }
  }
  return null;
}

// Fetches metadata for every sub-package referenced by the given step arrays.
// Returns { ok, meta } for downstream validators. Any missing rows are
// silently absent — the caller (validateStepsAgainstRegistry) treats that as
// "sub-package not found" and rejects.
async function fetchSubpackageMeta(
  db: any,
  stepArrays: ParsedStep[][],
): Promise<Map<string, SubpackageMeta>> {
  const ids = new Set<string>();
  for (const arr of stepArrays) {
    for (const step of arr) {
      if (step.kind === 'subpackage') ids.add(step.packageId);
    }
  }
  if (ids.size === 0) return new Map();
  const rows = await db
    .select({
      id: packages.id,
      status: packages.status,
      name: packages.name,
      prompts: packages.prompts,
      exposedOutputs: packages.exposedOutputs,
    })
    .from(packages)
    .where(inArray(packages.id, [...ids]));
  const out = new Map<string, SubpackageMeta>();
  for (const row of rows as Array<{
    id: string;
    status: 'draft' | 'active' | 'archived';
    name: string;
    prompts: unknown;
    exposedOutputs: unknown;
  }>) {
    out.set(row.id, {
      packageId: row.id,
      status: row.status,
      name: row.name,
      prompts: (row.prompts as Array<z.infer<typeof promptSchema>>) ?? [],
      exposedOutputs: (row.exposedOutputs as ParsedExposedOutput[]) ?? [],
    });
  }
  return out;
}

// Extracts the flat list of sub-package children referenced by the given
// steps (both main and terminal lanes), preserving `stepPosition` for the
// package_dependencies row rewrite.
function collectSubpackageRefs(
  steps: ParsedStep[],
): Array<{ childPackageId: string; stepPosition: number }> {
  const refs: Array<{ childPackageId: string; stepPosition: number }> = [];
  for (const [pos, step] of steps.entries()) {
    if (step.kind === 'subpackage') {
      refs.push({ childPackageId: step.packageId, stepPosition: pos });
    }
  }
  return refs;
}

// Recursive descent from `startIds` through package_dependencies. Returns the
// set of every reachable child (transitive closure). Guarded by a depth cap
// far larger than MAX_SUBPACKAGE_DEPTH so a corrupt row can't spin forever.
async function collectDescendants(
  db: any,
  startIds: string[],
): Promise<Set<string>> {
  if (startIds.length === 0) return new Set();
  const query = sql`
    WITH RECURSIVE d(node) AS (
      SELECT unnest(${sql.raw(`ARRAY['${startIds.join("','")}']::uuid[]`)}) AS node
      UNION
      SELECT pd.child_package_id
        FROM packages.package_dependencies pd
        JOIN d ON pd.parent_package_id = d.node
    )
    SELECT DISTINCT node::text AS node FROM d
  `;
  const res = await db.execute(query);
  const rows = (Array.isArray(res) ? res : (res?.rows ?? [])) as Array<{ node: string }>;
  return new Set(rows.map((r) => r.node));
}

// Height of the subtree rooted at `rootId` using the current package_dependencies
// table. A leaf (no subpackage children) has height 1. Bounded search — returns
// (MAX_SUBPACKAGE_DEPTH + 2) as a sentinel if depth exceeds the cap.
async function subtreeHeight(db: any, rootId: string): Promise<number> {
  const query = sql`
    WITH RECURSIVE d(node, depth) AS (
      SELECT ${rootId}::uuid, 1
      UNION ALL
      SELECT pd.child_package_id, d.depth + 1
        FROM packages.package_dependencies pd
        JOIN d ON pd.parent_package_id = d.node
        WHERE d.depth <= ${MAX_SUBPACKAGE_DEPTH + 1}
    )
    SELECT COALESCE(MAX(depth), 1)::int AS h FROM d
  `;
  const res = await db.execute(query);
  const rows = (Array.isArray(res) ? res : (res?.rows ?? [])) as Array<{ h: number }>;
  return rows[0]?.h ?? 1;
}

// Max hop-distance from any ancestor down to `packageId`. Used to bound the
// height that this package's new subtree can add without pushing any root
// above MAX_SUBPACKAGE_DEPTH.
async function maxAncestorDistance(db: any, packageId: string): Promise<number> {
  const query = sql`
    WITH RECURSIVE a(node, depth) AS (
      SELECT parent_package_id, 1
        FROM packages.package_dependencies
        WHERE child_package_id = ${packageId}::uuid
      UNION
      SELECT pd.parent_package_id, a.depth + 1
        FROM packages.package_dependencies pd
        JOIN a ON pd.child_package_id = a.node
        WHERE a.depth <= ${MAX_SUBPACKAGE_DEPTH + 1}
    )
    SELECT COALESCE(MAX(depth), 0)::int AS d FROM a
  `;
  const res = await db.execute(query);
  const rows = (Array.isArray(res) ? res : (res?.rows ?? [])) as Array<{ d: number }>;
  return rows[0]?.d ?? 0;
}

// Full save-time guard for a package's sub-package references. Runs the cycle
// check + depth cap against the CURRENT state of package_dependencies (which
// the caller must have locked via serializable isolation or FOR UPDATE), then
// rewrites this package's dependency rows.
async function checkAndRewriteDependencies(
  db: any,
  packageId: string,
  refs: Array<{ childPackageId: string; stepPosition: number }>,
): Promise<string | null> {
  // Self-reference is a trivial cycle — reject before hitting the DB.
  for (const ref of refs) {
    if (ref.childPackageId === packageId) {
      return `A package cannot include itself as a sub-package (step ${ref.stepPosition + 1})`;
    }
  }

  // Cycle: if the current package appears anywhere in any new child's descendants,
  // adding that edge would close a loop.
  const childIds = [...new Set(refs.map((r) => r.childPackageId))];
  const descendants = await collectDescendants(db, childIds);
  if (descendants.has(packageId)) {
    return 'Adding this sub-package would create a dependency cycle';
  }

  // Depth check: subtree height rooted at this package with the new refs, plus
  // the deepest ancestor distance, must not exceed MAX_SUBPACKAGE_DEPTH.
  let newSubtreeHeight = 1;
  for (const cid of childIds) {
    const h = await subtreeHeight(db, cid);
    if (1 + h > newSubtreeHeight) newSubtreeHeight = 1 + h;
  }
  const ancestorDistance = await maxAncestorDistance(db, packageId);
  if (ancestorDistance + newSubtreeHeight > MAX_SUBPACKAGE_DEPTH) {
    return `Sub-package nesting exceeds the maximum depth of ${MAX_SUBPACKAGE_DEPTH}`;
  }

  // Rewrite this package's dependency rows atomically. Delete-then-insert is
  // safe inside the caller's transaction.
  await db.delete(packageDependencies).where(eq(packageDependencies.parentPackageId, packageId));
  if (refs.length > 0) {
    await db.insert(packageDependencies).values(
      refs.map((r) => ({
        parentPackageId: packageId,
        childPackageId: r.childPackageId,
        stepPosition: r.stepPosition,
      })),
    );
  }
  return null;
}

function validatePromptBindings(
  steps: ParsedStep[],
  prompts: Array<z.infer<typeof promptSchema>>,
): string | null {
  const promptIds = new Set(prompts.map((prompt) => prompt.id));
  for (const [position, step] of steps.entries()) {
    // Sub-package steps target the child's prompts (validated separately in
    // validateStepsAgainstRegistry). Skip them here to avoid false positives.
    if (step.kind === 'subpackage') continue;
    for (const [inputName, binding] of Object.entries(step.inputBindings)) {
      if (binding.kind !== 'runtime') continue;
      // Legacy packages predate authored prompts. Keep them runnable and only
      // require a definition once the package begins publishing prompts.
      if (prompts.length > 0 && !promptIds.has(binding.promptKey)) {
        return `Step ${position + 1} input "${inputName}" references unknown prompt "${binding.promptKey}"`;
      }
    }
  }
  return null;
}

function allPackageSteps(input: {
  steps: ParsedStep[];
  outcomeSteps: z.infer<typeof outcomeStepsSchema>;
}): ParsedStep[] {
  return [...input.steps, ...input.outcomeSteps.onSuccess, ...input.outcomeSteps.onFailure];
}

export const packagesRouter = t.router({
  list: authProcedure
    .input(
      z
        .object({
          // When provided, filters to packages runnable at this site: global
          // packages (empty allow-lists) or scoped packages that include the
          // current site/link directly or via one of its groups.
          siteId: z.uuid().optional(),
          linkId: z.uuid().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
      }
      const rows = await ctx.db
        .select({
          id: packages.id,
          name: packages.name,
          description: packages.description,
          status: packages.status,
          version: packages.version,
          steps: packages.steps,
          prompts: packages.prompts,
          outcomeSteps: packages.outcomeSteps,
          allowedSites: packages.allowedSites,
          allowedSiteGroups: packages.allowedSiteGroups,
          allowedIntegrationLinks: packages.allowedIntegrationLinks,
          createdAt: packages.createdAt,
          updatedAt: packages.updatedAt,
        })
        .from(packages)
        .orderBy(desc(packages.updatedAt));

      if (!input.siteId && !input.linkId) return rows;

      const matchingGroupIds = await loadMatchingGroupIds(ctx.db, {
        siteId: input.siteId,
        linkId: input.linkId,
      });

      return rows.filter((row) => {
        const scope = readPackageScope(row);
        return packageMatchesScope(scope, input, matchingGroupIds);
      });
    }),

  get: authProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
      }
      const [row] = await ctx.db
        .select()
        .from(packages)
        .where(eq(packages.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });
      return row;
    }),

  create: authProcedure
    .input(packageInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Write required' });
      }
      const directLinkScope = await assertTenantScopedIntegrationLinks(
        ctx.db,
        input.allowedIntegrationLinks
      );
      if (!directLinkScope.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: directLinkScope.message });
      }
      const availability = await loadCapabilityAvailabilityInventory(ctx.db);
      const unavailable = findUnavailableCapabilities(
        [...input.steps, ...input.outcomeSteps.onSuccess, ...input.outcomeSteps.onFailure],
        availability,
      );
      if (unavailable.length > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: unavailableCapabilitiesMessage(unavailable) });
      }

      const catalogRows = await ctx.catalogDb
        .select({ id: capabilityCandidates.id })
        .from(capabilityCandidates)
        .where(inArray(capabilityCandidates.lifecycleStatus, ['approved', 'live']));
      const catalogIds = new Set(catalogRows.map((r) => r.id));

      // Serializable txn: the cycle + depth check reads package_dependencies
      // and any concurrent save on any package in the touched subgraph will
      // either serialize behind us or abort with a retryable error.
      const result = await ctx.db.transaction(async (tx: any) => {
        const subMeta = await fetchSubpackageMeta(tx, [
          input.steps,
          input.outcomeSteps.onSuccess,
          input.outcomeSteps.onFailure,
        ]);
        const err = validateStepsAgainstRegistry(input.steps, 'main', subMeta, catalogIds);
        if (err) return { error: err };
        const successOutcomeError = validateStepsAgainstRegistry(
          input.outcomeSteps.onSuccess,
          'onSuccess',
          subMeta,
          catalogIds,
        );
        if (successOutcomeError) return { error: `On success: ${successOutcomeError}` };
        const failureOutcomeError = validateStepsAgainstRegistry(
          input.outcomeSteps.onFailure,
          'onFailure',
          subMeta,
          catalogIds,
        );
        if (failureOutcomeError) return { error: `On failure: ${failureOutcomeError}` };
        const promptError = validatePromptBindings(allPackageSteps(input), input.prompts);
        if (promptError) return { error: promptError };
        const exposedError = validateExposedOutputs(input.exposedOutputs, input.steps, subMeta);
        if (exposedError) return { error: exposedError };

        const inserted = await tx
          .insert(packages)
          .values({
            name: input.name,
            description: input.description ?? null,
            status: input.status,
            version: 1,
            steps: input.steps,
            prompts: input.prompts,
            outcomeSteps: input.outcomeSteps,
            failureActions: input.failureActions,
            exposedOutputs: input.exposedOutputs,
            allowedSites: input.allowedSites,
            allowedSiteGroups: input.allowedSiteGroups,
            allowedIntegrationLinks: input.allowedIntegrationLinks,
            authorUserId: ctx.user.id,
          })
          .returning({ id: packages.id });
        const row = inserted[0]!;

        // Depth / cycle check considers refs across every lane (main + terminal
        // lanes) so a chain hidden inside onFailure still counts.
        const refs = collectSubpackageRefs([
          ...input.steps,
          ...input.outcomeSteps.onSuccess,
          ...input.outcomeSteps.onFailure,
        ]);
        const depErr = await checkAndRewriteDependencies(tx, row.id, refs);
        if (depErr) return { error: depErr };

        return { id: row.id as string };
      }, { isolationLevel: 'serializable' });

      if ('error' in result) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.error });
      }

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'create',
        actionLabel: ActionLabels.PackageCreate,
        targetType: 'package',
        targetId: result.id,
        targetLabel: input.name,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { id: result.id };
    }),

  update: authProcedure
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        status: z.enum(['draft', 'active', 'archived']).optional(),
        steps: z.array(stepSchema).min(1).optional(),
        prompts: z.array(promptSchema).optional(),
        outcomeSteps: outcomeStepsSchema.optional(),
        failureActions: z.array(failureActionSchema).optional(),
        exposedOutputs: z.array(exposedOutputSchema).optional(),
        allowedSites: z.array(z.uuid()).optional(),
        allowedSiteGroups: z.array(z.uuid()).optional(),
        allowedIntegrationLinks: z.array(z.uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Write required' });
      }
      if (input.allowedIntegrationLinks) {
        const directLinkScope = await assertTenantScopedIntegrationLinks(
          ctx.db,
          input.allowedIntegrationLinks
        );
        if (!directLinkScope.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: directLinkScope.message });
        }
      }
      let updateCatalogIds: ReadonlySet<string> = new Set();
      if (input.steps || input.outcomeSteps) {
        const availability = await loadCapabilityAvailabilityInventory(ctx.db);
        const unavailable = findUnavailableCapabilities(
          [...(input.steps ?? []), ...(input.outcomeSteps?.onSuccess ?? []), ...(input.outcomeSteps?.onFailure ?? [])],
          availability,
        );
        if (unavailable.length > 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: unavailableCapabilitiesMessage(unavailable) });
        }
        const updateCatalogRows = await ctx.catalogDb
          .select({ id: capabilityCandidates.id })
          .from(capabilityCandidates)
          .where(inArray(capabilityCandidates.lifecycleStatus, ['approved', 'live']));
        updateCatalogIds = new Set(updateCatalogRows.map((r) => r.id));
      }

      const result = await ctx.db.transaction(async (tx: any) => {
        const [current] = await tx
          .select()
          .from(packages)
          .where(eq(packages.id, input.id))
          .limit(1);
        if (!current) return { notFound: true as const };

        const nextSteps = (input.steps ?? current.steps) as ParsedStep[];
        const nextOutcome = (input.outcomeSteps ??
          current.outcomeSteps) as z.infer<typeof outcomeStepsSchema>;
        const nextPrompts = (input.prompts ??
          current.prompts) as Array<z.infer<typeof promptSchema>>;
        const nextExposed = (input.exposedOutputs ??
          current.exposedOutputs) as ParsedExposedOutput[];

        const subMeta = await fetchSubpackageMeta(tx, [
          nextSteps,
          nextOutcome.onSuccess,
          nextOutcome.onFailure,
        ]);

        if (input.steps) {
          const err = validateStepsAgainstRegistry(input.steps, 'main', subMeta, updateCatalogIds);
          if (err) return { error: err };
        }
        if (input.steps || input.prompts || input.outcomeSteps) {
          const promptError = validatePromptBindings(
            allPackageSteps({ steps: nextSteps, outcomeSteps: nextOutcome }),
            nextPrompts,
          );
          if (promptError) return { error: promptError };
        }
        if (input.outcomeSteps) {
          const successOutcomeError = validateStepsAgainstRegistry(
            input.outcomeSteps.onSuccess,
            'onSuccess',
            subMeta,
            updateCatalogIds,
          );
          if (successOutcomeError) return { error: `On success: ${successOutcomeError}` };
          const failureOutcomeError = validateStepsAgainstRegistry(
            input.outcomeSteps.onFailure,
            'onFailure',
            subMeta,
            updateCatalogIds,
          );
          if (failureOutcomeError) return { error: `On failure: ${failureOutcomeError}` };
        }
        if (input.exposedOutputs !== undefined || input.steps !== undefined) {
          const exposedError = validateExposedOutputs(nextExposed, nextSteps, subMeta);
          if (exposedError) return { error: exposedError };
        }

        // Block removal of any exposed output this package's parents wire to.
        // Conservative: even a rename counts as removal from the parent's view.
        if (input.exposedOutputs !== undefined) {
          const previousNames = new Set(
            ((current.exposedOutputs ?? []) as ParsedExposedOutput[]).map((o) => o.name),
          );
          const nextNames = new Set(nextExposed.map((o) => o.name));
          const removed = [...previousNames].filter((n) => !nextNames.has(n));
          if (removed.length > 0) {
            const parents = await tx
              .select({
                parentPackageId: packageDependencies.parentPackageId,
                parentName: packages.name,
                stepPosition: packageDependencies.stepPosition,
                parentSteps: packages.steps,
              })
              .from(packageDependencies)
              .innerJoin(packages, eq(packageDependencies.parentPackageId, packages.id))
              .where(eq(packageDependencies.childPackageId, input.id));
            for (const parent of parents as Array<{
              parentPackageId: string;
              parentName: string;
              stepPosition: number;
              parentSteps: ParsedStep[];
            }>) {
              for (const s of parent.parentSteps) {
                if (s.kind !== 'capability') continue;
                for (const [inputName, binding] of Object.entries(s.inputBindings)) {
                  if (binding.kind !== 'priorOutput') continue;
                  if (binding.stepPosition !== parent.stepPosition) continue;
                  if (removed.includes(binding.path)) {
                    return {
                      error: `Cannot remove exposed output "${binding.path}" — parent package "${parent.parentName}" wires it into input "${inputName}". Update or remove the parent reference first.`,
                    };
                  }
                }
              }
              const parentExposedRows = await tx
                .select({ exposedOutputs: packages.exposedOutputs })
                .from(packages)
                .where(eq(packages.id, parent.parentPackageId))
                .limit(1);
              const parentExposed = ((parentExposedRows[0]?.exposedOutputs ?? []) as ParsedExposedOutput[]);
              for (const eo of parentExposed) {
                if (eo.sourceStepPosition !== parent.stepPosition) continue;
                if (removed.includes(eo.sourcePath)) {
                  return {
                    error: `Cannot remove exposed output "${eo.sourcePath}" — parent package "${parent.parentName}" re-exports it as "${eo.name}".`,
                  };
                }
              }
            }
          }
        }

        // Block archiving a package that any active parent depends on.
        if (input.status === 'archived' && current.status !== 'archived') {
          const parentRows = await tx
            .select({ parentPackageId: packageDependencies.parentPackageId, parentName: packages.name })
            .from(packageDependencies)
            .innerJoin(packages, eq(packageDependencies.parentPackageId, packages.id))
            .where(eq(packageDependencies.childPackageId, input.id));
          if (parentRows.length > 0) {
            const names = (parentRows as Array<{ parentName: string }>)
              .map((r) => `"${r.parentName}"`)
              .slice(0, 3)
              .join(', ');
            return {
              error: `Cannot archive — referenced by ${parentRows.length} parent package${parentRows.length === 1 ? '' : 's'}: ${names}${parentRows.length > 3 ? ', ...' : ''}`,
            };
          }
        }

        const stepsChanged =
          input.steps !== undefined &&
          JSON.stringify(input.steps) !== JSON.stringify(current.steps);

        await tx
          .update(packages)
          .set({
            name: input.name ?? current.name,
            description: input.description === undefined ? current.description : input.description,
            status: input.status ?? current.status,
            steps: input.steps ?? current.steps,
            prompts: input.prompts ?? current.prompts,
            outcomeSteps: input.outcomeSteps ?? current.outcomeSteps,
            failureActions: input.failureActions ?? current.failureActions,
            exposedOutputs: nextExposed,
            allowedSites: input.allowedSites ?? current.allowedSites,
            allowedSiteGroups: input.allowedSiteGroups ?? current.allowedSiteGroups,
            allowedIntegrationLinks:
              input.allowedIntegrationLinks ?? current.allowedIntegrationLinks,
            version: stepsChanged ? current.version + 1 : current.version,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(packages.id, input.id));

        // Rewrite dependency rows whenever steps changed. `stepsChanged` covers
        // both a subpackage step added/removed and a position shift.
        if (stepsChanged) {
          const refs = collectSubpackageRefs([
            ...nextSteps,
            ...nextOutcome.onSuccess,
            ...nextOutcome.onFailure,
          ]);
          const depErr = await checkAndRewriteDependencies(tx, input.id, refs);
          if (depErr) return { error: depErr };
        }

        return { ok: true as const, stepsChanged, previousVersion: current.version };
      }, { isolationLevel: 'serializable' });

      if ('notFound' in result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });
      }
      if ('error' in result) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.error });
      }

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'update',
        actionLabel: ActionLabels.PackageUpdate,
        targetType: 'package',
        targetId: input.id,
        targetLabel: input.name ?? '',
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { stepsChanged: result.stepsChanged, previousVersion: result.previousVersion },
      });

      const nextVersion = result.stepsChanged ? result.previousVersion + 1 : result.previousVersion;
      return { id: input.id, version: nextVersion };
    }),

  archive: authProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Delete required' });
      }
      const [current] = await ctx.db
        .select({ id: packages.id, name: packages.name, status: packages.status })
        .from(packages)
        .where(eq(packages.id, input.id))
        .limit(1);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });

      // Block if any parent package still references this one as a sub-package.
      const parentRows = await ctx.db
        .select({ parentName: packages.name })
        .from(packageDependencies)
        .innerJoin(packages, eq(packageDependencies.parentPackageId, packages.id))
        .where(eq(packageDependencies.childPackageId, input.id));
      if (parentRows.length > 0) {
        const names = (parentRows as Array<{ parentName: string }>)
          .map((r) => `"${r.parentName}"`)
          .slice(0, 3)
          .join(', ');
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot archive — referenced by ${parentRows.length} parent package${parentRows.length === 1 ? '' : 's'}: ${names}${parentRows.length > 3 ? ', ...' : ''}`,
        });
      }

      await ctx.db
        .update(packages)
        .set({ status: 'archived', updatedAt: new Date().toISOString() })
        .where(eq(packages.id, input.id));

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'delete',
        actionLabel: ActionLabels.PackageDelete,
        targetType: 'package',
        targetId: input.id,
        targetLabel: current.name,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return { id: input.id };
    }),

  delete: authProcedure
    .input(
      z.object({
        id: z.uuid(),
        deleteRunHistory: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Delete required' });
      }
      const [current] = await ctx.db
        .select({ id: packages.id, name: packages.name })
        .from(packages)
        .where(eq(packages.id, input.id))
        .limit(1);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });

      const activeStatuses = ['pending', 'queued', 'running'] as const;
      const [activeRunRow] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(packageRuns)
        .where(
          and(
            eq(packageRuns.packageId, input.id),
            inArray(packageRuns.status, activeStatuses),
          ),
        );
      const activeRunCount = activeRunRow?.count ?? 0;
      if (activeRunCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot delete — this package has ${activeRunCount} active run${activeRunCount === 1 ? '' : 's'}. Wait for it to finish or cancel it first.`,
        });
      }

      const activeScheduleStatuses = ['scheduled', 'dispatching', 'dispatched'] as const;
      const [activeScheduleRow] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(packageSchedules)
        .where(
          and(
            eq(packageSchedules.packageId, input.id),
            inArray(packageSchedules.status, activeScheduleStatuses),
          ),
        );
      const activeScheduleCount = activeScheduleRow?.count ?? 0;
      if (activeScheduleCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot delete — this package has ${activeScheduleCount} scheduled run${activeScheduleCount === 1 ? '' : 's'}. Cancel it first.`,
        });
      }

      // Same rule as archive: block if any parent still references this one.
      // Without this, the ON DELETE RESTRICT on package_dependencies would
      // reject the delete with an unfriendly pg error.
      const parentDependents = await ctx.db
        .select({ parentName: packages.name })
        .from(packageDependencies)
        .innerJoin(packages, eq(packageDependencies.parentPackageId, packages.id))
        .where(eq(packageDependencies.childPackageId, input.id));
      if (parentDependents.length > 0) {
        const names = (parentDependents as Array<{ parentName: string }>)
          .map((r) => `"${r.parentName}"`)
          .slice(0, 3)
          .join(', ');
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot delete — referenced by ${parentDependents.length} parent package${parentDependents.length === 1 ? '' : 's'}: ${names}${parentDependents.length > 3 ? ', ...' : ''}`,
        });
      }

      const [historyRow] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(packageRuns)
        .where(eq(packageRuns.packageId, input.id));
      const historyCount = historyRow?.count ?? 0;
      if (historyCount > 0 && !input.deleteRunHistory) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Confirm deletion of this package’s run history before deleting it.',
        });
      }

      await ctx.db.transaction(async (tx) => {
        // Canceled schedules and terminal runs are historical records. Active
        // records were rejected above; remove the rest before the package so
        // its restrictive foreign keys remain intact.
        await tx
          .delete(packageSchedules)
          .where(
            and(
              eq(packageSchedules.packageId, input.id),
              eq(packageSchedules.status, 'canceled'),
            ),
          );
        await tx.delete(packageRuns).where(eq(packageRuns.packageId, input.id));
        await tx.delete(packages).where(eq(packages.id, input.id));
      });

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'delete',
        actionLabel: ActionLabels.PackageDelete,
        targetType: 'package',
        targetId: input.id,
        targetLabel: current.name,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { hard: true, deletedRunHistory: historyCount },
      });

      return { id: input.id };
    }),

  duplicate: authProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Packages.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Write required' });
      }
      const [source] = await ctx.db
        .select()
        .from(packages)
        .where(eq(packages.id, input.id))
        .limit(1);
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });

      const row = await ctx.db.transaction(async (tx: any) => {
        const inserted = await tx
          .insert(packages)
          .values({
            name: `${source.name} (copy)`,
            description: source.description,
            status: 'draft',
            version: 1,
            steps: source.steps,
            prompts: source.prompts,
            outcomeSteps: source.outcomeSteps,
            failureActions: source.failureActions,
            exposedOutputs: source.exposedOutputs,
            authorUserId: ctx.user.id,
          })
          .returning({ id: packages.id });
        const created = inserted[0]!;

        // Duplicated packages inherit sub-package references. Populate the
        // reverse index so cycle checks and archive blocks see them.
        const outcomeSteps = source.outcomeSteps as z.infer<typeof outcomeStepsSchema>;
        const allSteps = [
          ...(source.steps as ParsedStep[]),
          ...outcomeSteps.onSuccess,
          ...outcomeSteps.onFailure,
        ];
        const refs = collectSubpackageRefs(allSteps);
        if (refs.length > 0) {
          await tx.insert(packageDependencies).values(
            refs.map((r) => ({
              parentPackageId: created.id,
              childPackageId: r.childPackageId,
              stepPosition: r.stepPosition,
            })),
          );
        }
        return created;
      });

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email || ctx.user.id,
        action: 'create',
        actionLabel: ActionLabels.PackageCreate,
        targetType: 'package',
        targetId: row.id,
        targetLabel: `${source.name} (copy)`,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { duplicatedFrom: source.id },
      });

      return { id: row.id };
    }),

  // Options for a Select control keyed to an entityType. Used by the runtime
  // input dialog + the builder's entity binding editor. Filtered by parent
  // link where relevant so downstream pickers cascade from a chosen tenant.
  entityOptions: authProcedure
    .input(
      z.object({
        entityType: entityTypeSchema,
        packageId: z.uuid().optional(),
        integrationLinkId: z.uuid().optional(),
        integrationId: z.string().optional(),
        siteId: z.uuid().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ ctx, input }): Promise<EntityOption[]> => {
      let scopedLinkIds: Set<string> | null = null;
      if (input.packageId) {
        const [pkg] = await ctx.db
          .select({
            allowedSites: packages.allowedSites,
            allowedSiteGroups: packages.allowedSiteGroups,
            allowedIntegrationLinks: packages.allowedIntegrationLinks,
          })
          .from(packages)
          .where(eq(packages.id, input.packageId))
          .limit(1);
        if (!pkg) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });
        }

        const scope = readPackageScope(pkg);
        if (scope.links.length > 0 || scope.groups.length > 0) {
          const groupLinkRows =
            scope.groups.length > 0
              ? await ctx.db
                  .select({ integrationLinkId: siteGroupLinkMembers.integrationLinkId })
                  .from(siteGroupLinkMembers)
                  .where(inArray(siteGroupLinkMembers.siteGroupId, scope.groups))
              : [];
          scopedLinkIds = new Set([
            ...scope.links,
            ...groupLinkRows.map((row) => row.integrationLinkId),
          ]);
        }
      }

      if (input.entityType === 'integration_link') {
        // Only offer links that are actually usable — status='active' means
        // the tenant is connected and healthy. Error/disabled/dispositioned
        // links can't be run against.
        const filters = [eq(integrationLinks.status, 'active')];
        if (input.integrationId) {
          filters.push(eq(integrationLinks.integrationId, input.integrationId));
        }
        const rows = await ctx.db
          .select({
            id: integrationLinks.id,
            name: integrationLinks.name,
            integrationId: integrationLinks.integrationId,
          })
          .from(integrationLinks)
          .where(and(...filters))
          .orderBy(asc(integrationLinks.name))
          .limit(input.limit);
        return rows
          .filter((r) => (scopedLinkIds ? scopedLinkIds.has(r.id) : true))
          .map((r) => ({
          id: r.id,
          label: r.name ?? r.id,
          subLabel: r.integrationId,
          }));
      }

      if (input.entityType === 'm365_identity') {
        const filters = [];
        if (input.integrationLinkId) {
          filters.push(eq(m365Identities.linkId, input.integrationLinkId));
        }
        const rows = await ctx.db
          .select({
            id: m365Identities.id,
            name: m365Identities.name,
            email: m365Identities.email,
          })
          .from(m365Identities)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(asc(m365Identities.email))
          .limit(input.limit);
        return rows.map((r) => ({
          id: r.id,
          label: r.email || r.name || r.id,
          subLabel: r.email ? r.name : undefined,
        }));
      }

      if (input.entityType === 'm365_group') {
        const filters = [];
        if (input.integrationLinkId) {
          filters.push(eq(m365Groups.linkId, input.integrationLinkId));
        }
        const rows = await ctx.db
          .select({ externalId: m365Groups.externalId, name: m365Groups.name })
          .from(m365Groups)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(asc(m365Groups.name))
          .limit(input.limit);
        return rows.map((r) => ({ id: r.externalId, label: r.name ?? r.externalId }));
      }

      if (input.entityType === 'm365_role') {
        // Roles are global (no linkId) — all tenants share the same Azure AD built-in role templates.
        const rows = await ctx.db
          .select({ templateId: m365Roles.templateId, name: m365Roles.name })
          .from(m365Roles)
          .orderBy(asc(m365Roles.name))
          .limit(input.limit);
        return rows.map((r) => ({ id: r.templateId, label: r.name ?? r.templateId }));
      }

      if (input.entityType === 'm365_license') {
        const filters = [];
        filters.push(eq(m365Licenses.isBloat, false));
        if (input.integrationLinkId) {
          filters.push(eq(m365Licenses.linkId, input.integrationLinkId));
        }
        // Return the friendly name (e.g. "Microsoft 365 Business Standard") as
        // the label + a live availability count as subLabel — matches the UX
        // of the "Manage licenses" dialog rather than surfacing raw SKU strings.
        const rows = await ctx.db
          .select({
            skuId: m365Licenses.skuId,
            skuPartNumber: m365Licenses.skuPartNumber,
            friendlyName: m365Licenses.friendlyName,
            totalUnits: m365Licenses.totalUnits,
            consumedUnits: m365Licenses.consumedUnits,
            enabled: m365Licenses.enabled,
          })
          .from(m365Licenses)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(asc(m365Licenses.friendlyName))
          .limit(input.limit);
        return rows
          .filter((r) => r.enabled !== false)
          .map((r) => {
            const available = Math.max(0, r.totalUnits - r.consumedUnits);
            return {
              id: r.skuId,
              label: r.friendlyName || r.skuPartNumber,
              subLabel: `${available} of ${r.totalUnits} available`,
              disabled: available === 0,
            };
          });
      }

      if (input.entityType === 'sophos_endpoint') {
        const filters = [];
        if (input.integrationLinkId) {
          filters.push(eq(sophosEndpoints.linkId, input.integrationLinkId));
        }
        if (input.siteId) {
          filters.push(eq(sophosEndpoints.siteId, input.siteId));
        }
        const rows = await ctx.db
          .select({
            id: sophosEndpoints.id,
            linkId: sophosEndpoints.linkId,
            hostname: sophosEndpoints.hostname,
            osName: sophosEndpoints.osName,
            online: sophosEndpoints.online,
            siteName: sites.name,
          })
          .from(sophosEndpoints)
          .leftJoin(sites, eq(sophosEndpoints.siteId, sites.id))
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(asc(sophosEndpoints.hostname))
          .limit(input.limit);
        return rows
          .filter((row) => (scopedLinkIds ? scopedLinkIds.has(row.linkId) : true))
          .map((row) => ({
            id: row.id,
            label: row.hostname,
            subLabel: [row.osName, row.siteName, row.online ? 'online' : 'offline']
              .filter(Boolean)
              .join(' · '),
          }));
      }

      return [];
    }),

  // Static registry metadata for the builder UI (Phase 2). Exposed now so the
  // frontend can render "which capability does this run" labels without
  // duplicating the registry.
  capabilities: authProcedure.query(async ({ ctx }) => {
      if (!ctx.can('Packages.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
      }
      const availability = await loadCapabilityAvailabilityInventory(ctx.db);

      const codeCaps = listCapabilities()
        .filter((capability) => !capability.hidden && isCapabilityAvailable(capability, availability))
        .map((capability) => ({
          id: capability.id,
          vendor: capability.vendor,
          name: capability.name,
          description: capability.description,
          category: capability.category,
          integration: capability.integration,
          inputMeta: Object.fromEntries(
            Object.entries(capability.inputMeta).map(([name, meta]) => {
              const fieldType = resolveInputFieldType(meta);
              return [name, { ...meta, fieldType, fieldTypeLabel: packageFieldTypeLabel(fieldType) }];
            }),
          ),
          inputGroups: capability.inputGroups,
          fanout: capability.fanout ?? capability.operation?.fanout,
          outputMeta: Object.fromEntries(
            Object.entries(capability.outputMeta).map(([name, meta]) => {
              const fieldType = resolveOutputFieldType(meta);
              return [name, { ...meta, fieldType, fieldTypeLabel: packageFieldTypeLabel(fieldType) }];
            }),
          ),
          defaultUnitPrice: capability.defaultUnitPrice,
        }));

      // Include approved/live catalog-only candidates (dynamic executor).
      // Code-backed capabilities shadow catalog entries with the same ID.
      const codeIds = new Set(codeCaps.map((c) => c.id));
      const catalogRows = await ctx.catalogDb
        .select({
          id: capabilityCandidates.id,
          name: capabilityCandidates.name,
          description: capabilityCandidates.description,
          vendor: capabilityCandidates.vendor,
          category: capabilityCandidates.category,
          integration: capabilityCandidates.integration,
          operation: capabilityCandidates.operation,
          inputMeta: capabilityCandidates.inputMeta,
          outputMeta: capabilityCandidates.outputMeta,
        })
        .from(capabilityCandidates)
        .where(inArray(capabilityCandidates.lifecycleStatus, ['approved', 'live']));

      const catalogCaps = catalogRows
        .filter((c) => !codeIds.has(c.id))
        .filter((c) => {
          const intg = c.integration as { integrationId?: string; connection?: string } | null;
          if (!intg?.integrationId) return true;
          if (!availability.configuredIntegrationIds.has(intg.integrationId)) return false;
          return intg.connection !== 'activeLink' || availability.activeLinkIntegrationIds.has(intg.integrationId);
        })
        .map((c) => {
          const inputMeta = (c.inputMeta ?? {}) as Record<string, Record<string, unknown>>;
          const outputMeta = (c.outputMeta ?? {}) as Record<string, Record<string, unknown>>;

          // Resolve field type from JSONB meta, falling back to 'text' for unrecognised
          // values (e.g. 'object' for raw response body). resolveInputFieldType handles entityType.
          const safeInputFieldType = (meta: Record<string, unknown>): keyof typeof PACKAGE_FIELD_TYPES => {
            const resolved = resolveInputFieldType(meta as Parameters<typeof resolveInputFieldType>[0]);
            return (typeof resolved === 'string' && resolved in PACKAGE_FIELD_TYPES)
              ? (resolved as keyof typeof PACKAGE_FIELD_TYPES)
              : 'text';
          };
          const safeOutputFieldType = (rawType: unknown): keyof typeof PACKAGE_FIELD_TYPES =>
            (typeof rawType === 'string' && rawType in PACKAGE_FIELD_TYPES)
              ? (rawType as keyof typeof PACKAGE_FIELD_TYPES)
              : 'text';

          // Infer allowedBindings from field characteristics when not already stored.
          // Entity inputs get literal picker + runtime hint; text-like inputs also get siteFact.
          const inferAllowedBindings = (meta: Record<string, unknown>): string[] => {
            if (Array.isArray(meta.allowedBindings)) return meta.allowedBindings as string[];
            if (meta.entityType) return ['literal', 'runtime', 'priorOutput'];
            if (meta.valueType === 'boolean') return ['literal', 'runtime'];
            return ['literal', 'runtime', 'siteFact', 'priorOutput'];
          };

          return {
            id: c.id,
            vendor: c.vendor,
            name: c.name,
            description: c.description ?? undefined,
            category: (c.category ?? 'general').toLowerCase() as string,
            integration: (c.integration ?? undefined) as { integrationId: string; connection: 'configured' | 'activeLink' } | undefined,
            fanout: ((c.operation ?? {}) as { fanout?: unknown }).fanout,
            inputMeta: Object.fromEntries(
              Object.entries(inputMeta).map(([name, meta]) => {
                const fieldType = safeInputFieldType(meta);
                const allowedBindings = inferAllowedBindings(meta);
                return [name, { ...meta, fieldType, fieldTypeLabel: packageFieldTypeLabel(fieldType), allowedBindings }];
              }),
            ),
            inputGroups: undefined as Record<string, unknown> | undefined,
            outputMeta: Object.fromEntries(
              Object.entries(outputMeta).map(([name, meta]) => {
                const fieldType = safeOutputFieldType(meta.valueType);
                return [name, { ...meta, fieldType, fieldTypeLabel: packageFieldTypeLabel(fieldType) }];
              }),
            ),
            defaultUnitPrice: undefined as string | null | undefined,
          };
        });

      return [...codeCaps, ...catalogCaps];
  }),

  // Generator registry surfaced to the builder UI so it can render the
  // per-generator params widget (length, symbols, …) without hardcoding it.
  generators: authProcedure.query(() => {
    return listGenerators().map((g) => ({
      id: g.id,
      label: g.label,
      description: g.description,
      appliesToTypeHints: g.appliesToTypeHints,
      defaults: g.defaults,
    }));
  }),

  // Declared site profile fields — the fact-key catalog for the builder's
  // siteFact source picker. Filtered to active only so retired fields don't
  // appear as valid targets.
  siteFactFields: authProcedure.query(async ({ ctx }) => {
    if (!ctx.can('Packages.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Packages.Read required' });
    }
    const fields = await ctx.db
      .select({
        key: siteProfileFields.key,
        label: siteProfileFields.label,
        type: siteProfileFields.type,
        valueMode: siteProfileFields.valueMode,
        valueType: siteProfileFields.valueType,
        section: siteProfileFields.section,
        displayOrder: siteProfileFields.displayOrder,
      })
      .from(siteProfileFields)
      .where(eq(siteProfileFields.active, true))
      .orderBy(siteProfileFields.section, siteProfileFields.displayOrder, siteProfileFields.label);
    return fields.map((field) => {
      const fieldType = resolveSiteFactFieldType(field);
      return { ...field, fieldType, fieldTypeLabel: fieldTypeLabel(fieldType) };
    });
  }),
});
