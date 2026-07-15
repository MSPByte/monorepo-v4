import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import {
  assets,
  assetsWithSites,
  coveEndpoints,
  dattoEndpoints,
  entitySources,
  findings,
  integrationLinks,
  m365Devices,
  m365DomainConfig,
  m365ExchangeConfigs,
  m365Identities,
  m365InboxRules,
  m365Licenses,
  m365MailboxForwarding,
  m365OAuthGrants,
  m365Policies,
  m365RiskyUsers,
  m365TeamsConfig,
  people,
  peopleWithSites,
  policies,
  policyAssignments,
  policySetItems,
  siteGroupMembers,
  sites,
  sophosEndpoints,
  sophosFirewalls,
  sophosLicenses,
  syncRuns,
  syncRunStages
} from '@mspbyte/drizzle';
import { FACET_TABLE_MAP, ProviderFacet } from '@mspbyte/shared';

type Db = any;
type JsonObject = Record<string, unknown>;
type PolicyRow = typeof policies.$inferSelect;
type AssignmentRow = typeof policyAssignments.$inferSelect;
type PolicySetItemRow = typeof policySetItems.$inferSelect;

export type PolicyMetrics = {
  assignmentsEvaluated: number;
  policiesEvaluated: number;
  findingsOpen: number;
  findingsResolved: number;
  failedCt: number;
};

type PolicyContext = {
  assignment: AssignmentRow;
  policy: PolicyRow;
  policySetId: string | null;
  linkId?: string;
  siteId?: string;
  provider: string;
  syncRunId: string;
  scope: JsonObject;
};

type ProducedFinding = {
  policyId: string;
  policySetId: string | null;
  policyAssignmentId: string;
  providerId: string | null;
  linkId: string | null;
  siteId: string | null;
  resourceType: string;
  resourceTable: string | null;
  resourceId: string;
  resourceExternalId: string | null;
  fingerprint: string;
  title: string;
  summary: string | null;
  severity: number;
  evidence: JsonObject;
  impact: JsonObject;
  remediation: JsonObject;
  recommendation: string | null;
};

type TableEntry = {
  table: unknown;
  resourceType: string;
  resourceTable: string;
  sourceTable?: string;
};

const tableRegistry: Record<string, TableEntry> = {
  people: {
    table: peopleWithSites,
    resourceType: 'person',
    resourceTable: 'canonical.people'
  },
  assets: {
    table: assetsWithSites,
    resourceType: 'asset',
    resourceTable: 'canonical.assets'
  },
  m365Identities: {
    table: m365Identities,
    resourceType: 'm365_identity',
    resourceTable: 'vendors.m365_identities',
    sourceTable: 'm365_identities'
  },
  m365Policies: {
    table: m365Policies,
    resourceType: 'm365_policy',
    resourceTable: 'vendors.m365_policies',
    sourceTable: 'm365_policies'
  },
  m365Licenses: {
    table: m365Licenses,
    resourceType: 'm365_license',
    resourceTable: 'vendors.m365_licenses'
  },
  m365ExchangeConfigs: {
    table: m365ExchangeConfigs,
    resourceType: 'm365_exchange_config',
    resourceTable: 'vendors.m365_exchange_configs'
  },
  m365Devices: {
    table: m365Devices,
    resourceType: 'm365_device',
    resourceTable: 'vendors.m365_devices',
    sourceTable: 'm365_devices'
  },
  m365OAuthGrants: {
    table: m365OAuthGrants,
    resourceType: 'm365_oauth_grant',
    resourceTable: 'vendors.m365_oauth_grants'
  },
  m365DomainConfig: {
    table: m365DomainConfig,
    resourceType: 'm365_domain_config',
    resourceTable: 'vendors.m365_domain_config'
  },
  m365TeamsConfig: {
    table: m365TeamsConfig,
    resourceType: 'm365_teams_config',
    resourceTable: 'vendors.m365_teams_config'
  },
  m365RiskyUsers: {
    table: m365RiskyUsers,
    resourceType: 'm365_risky_user',
    resourceTable: 'vendors.m365_risky_users'
  },
  m365MailboxForwarding: {
    table: m365MailboxForwarding,
    resourceType: 'm365_mailbox_forwarding',
    resourceTable: 'vendors.m365_mailbox_forwarding'
  },
  m365InboxRules: {
    table: m365InboxRules,
    resourceType: 'm365_inbox_rule',
    resourceTable: 'vendors.m365_inbox_rules'
  },
  sophosEndpoints: {
    table: sophosEndpoints,
    resourceType: 'sophos_endpoint',
    resourceTable: 'vendors.sophos_endpoints'
  },
  sophosFirewalls: {
    table: sophosFirewalls,
    resourceType: 'sophos_firewall',
    resourceTable: 'vendors.sophos_firewalls'
  },
  sophosLicenses: {
    table: sophosLicenses,
    resourceType: 'sophos_license',
    resourceTable: 'vendors.sophos_licenses'
  },
  dattoEndpoints: {
    table: dattoEndpoints,
    resourceType: 'datto_endpoint',
    resourceTable: 'vendors.datto_endpoints'
  },
  coveEndpoints: {
    table: coveEndpoints,
    resourceType: 'cove_endpoint',
    resourceTable: 'vendors.cove_endpoints'
  }
};

export async function startPolicyStage(
  db: Db,
  params: {
    syncRunId: string;
    provider: string;
    type: string;
    bullmqJobId: string;
  }
): Promise<string> {
  await db.update(syncRuns).set({ status: 'policy' }).where(eq(syncRuns.id, params.syncRunId));

  const [row] = await db
    .insert(syncRunStages)
    .values({
      syncRunId: params.syncRunId,
      integrationId: params.provider,
      bullmqJobId: params.bullmqJobId,
      type: params.type,
      stage: 'policy',
      status: 'running',
      startedAt: new Date().toISOString()
    })
    .returning({ id: syncRunStages.id });

  return row.id;
}

export async function completePolicyStage(
  db: Db,
  stageId: string,
  syncRunId: string,
  metrics: PolicyMetrics
): Promise<void> {
  await db
    .update(syncRunStages)
    .set({
      status: 'completed',
      finishedAt: new Date().toISOString(),
      recordsIn: metrics.policiesEvaluated,
      recordsOut: metrics.findingsOpen,
      createdCt: metrics.findingsOpen,
      updatedCt: metrics.findingsResolved,
      failedCt: metrics.failedCt,
      metrics
    })
    .where(eq(syncRunStages.id, stageId));

  await db
    .update(syncRuns)
    .set({ status: 'completed', finishedAt: new Date().toISOString() })
    .where(eq(syncRuns.id, syncRunId));
}

export async function failPolicyStage(
  db: Db,
  stageId: string,
  syncRunId: string,
  error: unknown
): Promise<void> {
  await db
    .update(syncRunStages)
    .set({
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    })
    .where(eq(syncRunStages.id, stageId));

  await db
    .update(syncRuns)
    .set({ status: 'policy_failed', finishedAt: new Date().toISOString() })
    .where(eq(syncRuns.id, syncRunId));
}

export async function evaluatePolicies(
  db: Db,
  params: {
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
    syncRunId: string;
  }
): Promise<PolicyMetrics> {
  const metrics: PolicyMetrics = {
    assignmentsEvaluated: 0,
    policiesEvaluated: 0,
    findingsOpen: 0,
    findingsResolved: 0,
    failedCt: 0
  };
  const activeAssignments = await loadAssignmentsForRun(db, params);
  const setItems = (await db.select().from(policySetItems)) as PolicySetItemRow[];
  const policyRows = (await db
    .select()
    .from(policies)
    .where(eq(policies.enabled, true))) as PolicyRow[];
  const policyById = new Map<string, PolicyRow>(
    policyRows.map((policy: PolicyRow) => [policy.id, policy])
  );
  const setPolicyIds = groupSetItems(setItems);
  const scope = await loadScopeContext(db, params.linkId, params.siteId);
  const triggerTable = FACET_TABLE_MAP[params.type as ProviderFacet];

  for (const assignment of activeAssignments) {
    metrics.assignmentsEvaluated++;
    const policyIds =
      assignment.subjectType === 'policy_set' && assignment.policySetId
        ? (setPolicyIds.get(assignment.policySetId) ?? [])
        : assignment.policyId
          ? [assignment.policyId]
          : [];

    for (const policyId of policyIds) {
      const policy = policyById.get(policyId);
      if (!policy) continue;
      if (policy.providerId && policy.providerId !== params.provider) continue;
      if (!policyTargetsFacet(policy, triggerTable)) continue;

      metrics.policiesEvaluated++;
      const context: PolicyContext = {
        assignment,
        policy,
        policySetId: assignment.subjectType === 'policy_set' ? assignment.policySetId : null,
        linkId: params.linkId,
        siteId: params.siteId,
        provider: params.provider,
        syncRunId: params.syncRunId,
        scope
      };
      const produced = await evaluatePolicy(db, context);
      await upsertProducedFindings(db, produced);
      metrics.findingsOpen += produced.length;
      metrics.findingsResolved += await resolveStaleFindings(db, context, produced);
    }
  }

  return metrics;
}

async function loadScopeContext(
  db: Db,
  linkId: string | undefined,
  siteId: string | undefined
): Promise<JsonObject> {
  const scope: JsonObject = {};
  if (linkId) {
    const [link] = await db
      .select({
        id: integrationLinks.id,
        name: integrationLinks.name,
        externalId: integrationLinks.externalId,
        integrationId: integrationLinks.integrationId
      })
      .from(integrationLinks)
      .where(eq(integrationLinks.id, linkId))
      .limit(1);
    if (link) scope.integrationLink = link;
  }
  if (siteId) {
    const [site] = await db
      .select({ id: sites.id, name: sites.name, description: sites.description })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);
    if (site) scope.site = site;
  }
  return scope;
}

async function loadAssignmentsForRun(
  db: Db,
  params: { linkId: string; siteId?: string }
): Promise<AssignmentRow[]> {
  const rows = await db.select().from(policyAssignments).where(eq(policyAssignments.enabled, true));
  const siteIds = params.siteId ? await siteScopeIds(db, params.siteId) : new Set<string>();
  const groupIds = params.siteId ? await siteGroupIdsForSite(db, params.siteId) : new Set<string>();

  return rows.filter((assignment: AssignmentRow) => {
    if (assignment.scopeType === 'global') return true;
    if (assignment.scopeType === 'integration_link') return assignment.linkId === params.linkId;
    if (assignment.scopeType === 'site') {
      if (!params.siteId || !assignment.siteId) return false;
      if (assignment.siteId === params.siteId) return true;
      return assignment.includeChildSites && siteIds.has(assignment.siteId);
    }
    if (assignment.scopeType === 'site_group') {
      return !!assignment.siteGroupId && groupIds.has(assignment.siteGroupId);
    }
    return false;
  });
}

async function siteScopeIds(db: Db, currentSiteId: string): Promise<Set<string>> {
  const allSites = await db.select({ id: sites.id, parentSiteId: sites.parentSiteId }).from(sites);
  const ancestors = new Set<string>([currentSiteId]);
  let cursor: string | null | undefined = currentSiteId;

  while (cursor) {
    const site = allSites.find(
      (row: { id: string; parentSiteId: string | null }) => row.id === cursor
    );
    cursor = site?.parentSiteId;
    if (cursor) ancestors.add(cursor);
  }

  return ancestors;
}

async function siteGroupIdsForSite(db: Db, siteId: string): Promise<Set<string>> {
  const rows = await db
    .select({ siteGroupId: siteGroupMembers.siteGroupId })
    .from(siteGroupMembers)
    .where(eq(siteGroupMembers.siteId, siteId));
  return new Set(rows.map((row: { siteGroupId: string }) => row.siteGroupId));
}

function policyTargetsFacet(policy: PolicyRow, triggerTable: string | undefined): boolean {
  if (!triggerTable) return true;
  const definition = policy.definition;
  if (!isObject(definition)) return true;
  const target = definition.table;
  if (typeof target !== 'string') return true;
  return target === triggerTable;
}

function groupSetItems(rows: PolicySetItemRow[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const current = grouped.get(row.policySetId) ?? [];
    current.push(row.policyId);
    grouped.set(row.policySetId, current);
  }
  return grouped;
}

async function evaluatePolicy(db: Db, context: PolicyContext): Promise<ProducedFinding[]> {
  const definition = mergeParameters(context.policy.definition, context.assignment.parameters);
  if (!isObject(definition)) return [];

  switch (definition.kind) {
    case 'tableThreshold':
      return evaluateTableThreshold(db, context, definition);
    case 'rowExpectation':
      return evaluateRowExpectation(db, context, definition);
    default:
      return [];
  }
}

async function evaluateTableThreshold(
  db: Db,
  context: PolicyContext,
  definition: JsonObject
): Promise<ProducedFinding[]> {
  const tableName = String(definition.table ?? '');
  const entry = tableRegistry[tableName];
  if (!entry) return [];

  const rows = await scopedRows(db, entry, context, definition);
  const scoped = rows.filter((row) => matchesFilter(row, definition.filter));
  const expectations = Array.isArray(definition.expectations)
    ? definition.expectations
    : definition.expectation
      ? [definition.expectation]
      : [];
  const matching =
    expectations.length === 0
      ? scoped
      : scoped.filter((row) =>
          expectations.every((expectation) => matchesCondition(row, expectation))
        );
  const threshold = numberValue(definition.threshold, 1);
  if (matching.length >= threshold) return [];

  return [
    buildFinding(context, {
      resourceType: String(definition.resourceType ?? 'integration_link'),
      resourceTable: entry.resourceTable,
      resourceId: context.linkId ?? context.siteId ?? context.assignment.id,
      resourceExternalId: null,
      title:
        renderTemplate(stringValue(definition.title, context.policy.name), context.scope) ??
        context.policy.name,
      summary: renderTemplate(stringValue(definition.summary, null), context.scope),
      recommendation: renderTemplate(context.policy.recommendation, context.scope),
      evidence: {
        kind: 'tableThreshold',
        table: tableName,
        threshold,
        scoped: scoped.length,
        matched: matching.length,
        filter: definition.filter ?? null,
        expectations: expectations.length ? expectations : null,
        sample: matching.slice(0, 10).map(compactRow)
      }
    })
  ];
}

async function evaluateRowExpectation(
  db: Db,
  context: PolicyContext,
  definition: JsonObject
): Promise<ProducedFinding[]> {
  const tableName = String(definition.table ?? '');
  const entry = tableRegistry[tableName];
  if (!entry) return [];

  const rows = await scopedRows(db, entry, context, definition);
  const candidates = rows.filter((row) => matchesFilter(row, definition.filter));
  const expectations = Array.isArray(definition.expectations)
    ? definition.expectations
    : definition.expectation
      ? [definition.expectation]
      : [];

  const findingsForRows = await Promise.all(
    candidates.map(async (row) => {
      const failed = expectations.filter((expectation) => !matchesCondition(row, expectation));
      if (!failed.length) return null;
      const resource = await findingResourceForRow(db, entry, row, definition);
      const renderCtx = { ...row, ...context.scope };
      return buildFinding(context, {
        resourceType: resource.resourceType,
        resourceTable: resource.resourceTable,
        resourceId: resource.resourceId,
        resourceExternalId: resource.resourceExternalId,
        title:
          renderTemplate(stringValue(definition.title, context.policy.name), renderCtx) ??
          context.policy.name,
        summary: renderTemplate(stringValue(definition.summary, null), renderCtx),
        recommendation: renderTemplate(context.policy.recommendation, renderCtx),
        evidence: {
          kind: 'rowExpectation',
          table: tableName,
          failed,
          row: compactRow(row)
        }
      });
    })
  );

  return findingsForRows.filter((finding): finding is ProducedFinding => finding !== null);
}

async function findingResourceForRow(
  db: Db,
  entry: TableEntry,
  row: JsonObject,
  definition: JsonObject
): Promise<{
  resourceType: string;
  resourceTable: string | null;
  resourceId: string;
  resourceExternalId: string | null;
}> {
  const canonicalResource = isObject(definition.canonicalResource)
    ? definition.canonicalResource
    : null;
  const canonicalType = String(canonicalResource?.type ?? '');
  const rowId = String(readPath(row, 'id') ?? '');

  if (entry.sourceTable && rowId && (canonicalType === 'person' || canonicalType === 'asset')) {
    const [source] = await db
      .select({
        canonicalId: entitySources.canonicalId,
        externalId: entitySources.externalId
      })
      .from(entitySources)
      .where(
        and(
          eq(entitySources.vendorTable, entry.sourceTable),
          eq(entitySources.vendorRecordId, rowId),
          eq(entitySources.canonicalType, canonicalType),
          eq(entitySources.status, 'confirmed')
        )
      )
      .limit(1)
      .catch(() => []);

    if (source?.canonicalId) {
      return {
        resourceType: canonicalType,
        resourceTable: canonicalType === 'person' ? 'canonical.people' : 'canonical.assets',
        resourceId: String(source.canonicalId),
        resourceExternalId: source.externalId ?? stringValue(readPath(row, 'externalId'), null)
      };
    }
  }

  return {
    resourceType: String(definition.resourceType ?? entry.resourceType),
    resourceTable: entry.resourceTable,
    resourceId: String(readPath(row, 'id') ?? readPath(row, 'externalId') ?? 'unknown'),
    resourceExternalId: stringValue(readPath(row, 'externalId'), null)
  };
}

async function scopedRows(
  db: Db,
  entry: TableEntry,
  context: PolicyContext,
  definition: JsonObject
): Promise<JsonObject[]> {
  const table = entry.table as Record<string, unknown>;
  const conditions: unknown[] = [];
  const linkColumn = table.linkId;
  const siteColumn = table.siteId;

  if (linkColumn && context.linkId) {
    conditions.push(eq(linkColumn as never, context.linkId));
  }
  const scope = isObject(definition.scope) ? definition.scope : {};
  if (scope.siteId && siteColumn) {
    conditions.push(eq(siteColumn as never, scope.siteId));
  }

  const filterSql = buildSqlFilter(table, definition.filter);
  if (filterSql) conditions.push(filterSql);

  const query = db.select().from(entry.table);
  const rows = (
    conditions.length > 0 ? await query.where(and(...(conditions as never[]))) : await query
  ) as JsonObject[];

  return rows.filter((row) => {
    if (
      !linkColumn &&
      readPath(row, 'linkId') &&
      context.linkId &&
      readPath(row, 'linkId') !== context.linkId
    ) {
      return false;
    }
    if (!siteColumn && scope.siteId && readPath(row, 'siteId') !== scope.siteId) return false;
    return true;
  });
}

function buildSqlFilter(table: Record<string, unknown>, filter: unknown): unknown | null {
  if (!isObject(filter)) return null;
  const logic = String(filter.logic ?? 'AND').toUpperCase();
  if (logic !== 'AND') return null;
  const conditions = Array.isArray(filter.conditions) ? filter.conditions : [];
  const pushed: unknown[] = [];
  for (const condition of conditions) {
    if (!isObject(condition)) continue;
    const field = String(condition.field ?? '');
    if (!field || field.includes('.')) continue;
    const column = table[field];
    if (!column) continue;
    const op = String(condition.op ?? 'eq');
    switch (op) {
      case 'eq':
        pushed.push(eq(column as never, condition.value as never));
        break;
      case 'ne':
        pushed.push(ne(column as never, condition.value as never));
        break;
      case 'exists':
        pushed.push(sql`${column} is not null`);
        break;
      case 'missing':
        pushed.push(sql`${column} is null`);
        break;
      default:
        continue;
    }
  }
  if (pushed.length === 0) return null;
  return and(...(pushed as never[]));
}

async function upsertProducedFindings(db: Db, produced: ProducedFinding[]): Promise<void> {
  const now = new Date().toISOString();
  for (const finding of produced) {
    await db
      .insert(findings)
      .values({
        ...finding,
        status: 'open',
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: findings.fingerprint,
        set: {
          policySetId: finding.policySetId,
          policyAssignmentId: finding.policyAssignmentId,
          providerId: finding.providerId,
          linkId: finding.linkId,
          siteId: finding.siteId,
          resourceType: finding.resourceType,
          resourceTable: finding.resourceTable,
          resourceId: finding.resourceId,
          resourceExternalId: finding.resourceExternalId,
          title: finding.title,
          summary: finding.summary,
          severity: finding.severity,
          status: sql`case
            when ${findings.status} = 'resolved' then 'regressed'
            when ${findings.status} = 'suppressed'
              and ${findings.suppressedUntil} is not null
              and ${findings.suppressedUntil} <= now()
              then 'regressed'
            else ${findings.status}
          end`,
          evidence: finding.evidence,
          impact: finding.impact,
          remediation: finding.remediation,
          recommendation: finding.recommendation,
          lastSeenAt: now,
          resolvedAt: null,
          suppressedUntil: sql`case
            when ${findings.status} = 'suppressed'
              and ${findings.suppressedUntil} is not null
              and ${findings.suppressedUntil} <= now()
              then null
            else ${findings.suppressedUntil}
          end`,
          suppressedAt: sql`case
            when ${findings.status} = 'suppressed'
              and ${findings.suppressedUntil} is not null
              and ${findings.suppressedUntil} <= now()
              then null
            else ${findings.suppressedAt}
          end`,
          suppressionReason: sql`case
            when ${findings.status} = 'suppressed'
              and ${findings.suppressedUntil} is not null
              and ${findings.suppressedUntil} <= now()
              then null
            else ${findings.suppressionReason}
          end`,
          suppressedBy: sql`case
            when ${findings.status} = 'suppressed'
              and ${findings.suppressedUntil} is not null
              and ${findings.suppressedUntil} <= now()
              then null
            else ${findings.suppressedBy}
          end`,
          updatedAt: now
        }
      });
  }
}

async function resolveStaleFindings(
  db: Db,
  context: PolicyContext,
  produced: ProducedFinding[]
): Promise<number> {
  const now = new Date().toISOString();
  const fingerprints = produced.map((finding) => finding.fingerprint);
  const scopeFilters = [] as ReturnType<typeof eq>[];
  if (context.linkId) {
    scopeFilters.push(eq(findings.linkId, context.linkId));
  }
  if (context.siteId) {
    scopeFilters.push(eq(findings.siteId, context.siteId));
  }
  const base = and(
    eq(findings.policyId, context.policy.id),
    eq(findings.policyAssignmentId, context.assignment.id),
    ...scopeFilters,
    fingerprints.length > 0 ? notInArray(findings.fingerprint, fingerprints) : sql`true`,
    inArray(findings.status, ['open', 'acknowledged', 'regressed'])
  );

  const resolved = await db
    .update(findings)
    .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
    .where(base)
    .returning({ id: findings.id });

  return resolved.length;
}

function buildFinding(
  context: PolicyContext,
  input: {
    resourceType: string;
    resourceTable: string | null;
    resourceId: string;
    resourceExternalId: string | null;
    title: string;
    summary: string | null;
    recommendation: string | null;
    evidence: JsonObject;
  }
): ProducedFinding {
  const fingerprint = [
    context.assignment.id,
    context.policy.id,
    input.resourceType,
    input.resourceTable,
    input.resourceId
  ]
    .filter(Boolean)
    .join(':');

  return {
    policyId: context.policy.id,
    policySetId: context.policySetId,
    policyAssignmentId: context.assignment.id,
    providerId: context.policy.providerId ?? context.provider,
    linkId: context.linkId ?? context.assignment.linkId ?? null,
    siteId: context.siteId ?? context.assignment.siteId ?? null,
    resourceType: input.resourceType,
    resourceTable: input.resourceTable,
    resourceId: input.resourceId,
    resourceExternalId: input.resourceExternalId,
    fingerprint,
    title: input.title,
    summary: input.summary,
    severity: context.policy.severity,
    evidence: input.evidence,
    impact: {},
    remediation: {},
    recommendation: input.recommendation
  };
}

function mergeParameters(definition: unknown, parameters: unknown): unknown {
  if (!isObject(definition) || !isObject(parameters)) return definition;
  return { ...definition, parameters };
}

function matchesFilter(row: JsonObject, filter: unknown): boolean {
  if (!filter) return true;
  if (!isObject(filter)) return false;

  const logic = String(filter.logic ?? 'AND').toUpperCase();
  const conditions = Array.isArray(filter.conditions) ? filter.conditions : [];
  const results = conditions.map((condition) => matchesCondition(row, condition));
  return logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

function matchesCondition(row: JsonObject, condition: unknown): boolean {
  if (!isObject(condition)) return false;
  const op = String(condition.op ?? 'eq');
  const field = String(condition.field ?? '');
  const actual = readPath(row, field);
  const expected = condition.value;

  switch (op) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'missing':
      return actual === undefined || actual === null;
    case 'contains':
      return Array.isArray(actual)
        ? actual.includes(expected)
        : typeof actual === 'string' && typeof expected === 'string'
          ? actual.includes(expected)
          : false;
    case 'notContains':
      return !matchesCondition(row, { ...condition, op: 'contains' });
    case 'gt':
      return comparable(actual) > comparable(expected);
    case 'gte':
      return comparable(actual) >= comparable(expected);
    case 'lt':
      return comparable(actual) < comparable(expected);
    case 'lte':
      return comparable(actual) <= comparable(expected);
    case 'olderThanDays':
      return dateAgeDays(actual) > numberValue(expected, 0);
    case 'withinDays':
      return dateAgeDays(actual) <= numberValue(expected, 0);
    default:
      return false;
  }
}

function readPath(row: JsonObject, path: string): unknown {
  const normalizedPath = path === 'state' ? 'policyState' : path;
  return normalizedPath.split('.').reduce<unknown>((current, part) => {
    if (!isObject(current)) return undefined;
    return current[part] ?? current[toCamel(part)];
  }, row);
}

function compactRow(row: JsonObject): JsonObject {
  const compact: JsonObject = {};
  for (const key of [
    'id',
    'externalId',
    'siteId',
    'linkId',
    'name',
    'displayName',
    'email',
    'hostname',
    'policyState',
    'enabled',
    'lastSignInAt',
    'status'
  ]) {
    const value = readPath(row, key);
    if (value !== undefined) compact[key] = value;
  }
  return compact;
}

function renderTemplate(template: string | null, row: JsonObject): string | null {
  if (!template) return null;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) =>
    String(readPath(row, path) ?? '')
  );
}

function comparable(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const date = Date.parse(value);
    if (Number.isFinite(date)) return date;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  if (value instanceof Date) return value.getTime();
  return 0;
}

function dateAgeDays(value: unknown): number {
  const time = comparable(value);
  if (!time) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / 86_400_000;
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }
  return fallback;
}

function stringValue(value: unknown, fallback: string): string;
function stringValue(value: unknown, fallback: string | null): string | null;
function stringValue(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
