import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  assetsWithSites,
  coveEndpoints,
  dattoEndpoints,
  factRules,
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
  siteProfileFacts,
  sophosEndpoints,
  sophosFirewalls,
  sophosLicenses,
  sophosTamperProtection
} from '@mspbyte/drizzle';
import { FACET_TABLE_MAP, type ProviderFacet } from '@mspbyte/shared';

type Db = any;
type JsonObject = Record<string, unknown>;

type TableEntry = {
  table: unknown;
};

const tableRegistry: Record<string, TableEntry> = {
  assets: { table: assetsWithSites },
  m365Identities: { table: m365Identities },
  m365Policies: { table: m365Policies },
  m365Licenses: { table: m365Licenses },
  m365ExchangeConfigs: { table: m365ExchangeConfigs },
  m365Devices: { table: m365Devices },
  m365OAuthGrants: { table: m365OAuthGrants },
  m365DomainConfig: { table: m365DomainConfig },
  m365TeamsConfig: { table: m365TeamsConfig },
  m365RiskyUsers: { table: m365RiskyUsers },
  m365MailboxForwarding: { table: m365MailboxForwarding },
  m365InboxRules: { table: m365InboxRules },
  sophosEndpoints: { table: sophosEndpoints },
  sophosFirewalls: { table: sophosFirewalls },
  sophosLicenses: { table: sophosLicenses },
  sophosTamperProtection: { table: sophosTamperProtection },
  dattoEndpoints: { table: dattoEndpoints },
  coveEndpoints: { table: coveEndpoints }
};

export type FactRuleMetrics = {
  rulesEvaluated: number;
  factsWritten: number;
};

export async function evaluateFactRules(
  db: Db,
  params: {
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
  }
): Promise<FactRuleMetrics> {
  const metrics: FactRuleMetrics = { rulesEvaluated: 0, factsWritten: 0 };

  if (!params.siteId) return metrics;

  const rules = await db
    .select()
    .from(factRules)
    .where(eq(factRules.enabled, true))
    .orderBy(asc(factRules.priority));

  const triggerTable = FACET_TABLE_MAP[params.type as ProviderFacet];

  for (const rule of rules) {
    const definition = rule.definition;
    if (!isObject(definition)) continue;
    const tableKey = stringValue(definition.table, '');
    if (!tableKey) continue;
    if (triggerTable && tableKey !== triggerTable) continue;

    const entry = tableRegistry[tableKey];
    if (!entry) continue;

    metrics.rulesEvaluated++;

    const rows = await scopedRowsForFact(db, entry, params.linkId, params.siteId, definition);
    const candidates = rows.filter((row) => matchesFilter(row, definition.filter));

    const value = aggregate(candidates, definition);
    if (value === undefined) continue;

    const now = new Date().toISOString();
    await db
      .insert(siteProfileFacts)
      .values({
        siteId: params.siteId,
        key: rule.factKey,
        source: 'generated',
        origin: `rule:${rule.id}`,
        value,
        applicable: 'applies',
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [siteProfileFacts.siteId, siteProfileFacts.key],
        set: {
          value,
          source: 'generated',
          origin: `rule:${rule.id}`,
          applicable: 'applies',
          updatedAt: now
        }
      });

    metrics.factsWritten++;
  }

  return metrics;
}

// Value transforms applied to individual field values before aggregating.
const TRANSFORMS: Record<string, (v: unknown) => unknown> = {
  none: (v) => v,
  afterAt: (v) => (typeof v === 'string' ? (v.split('@')[1] ?? null) : v),
  beforeAt: (v) => (typeof v === 'string' ? (v.split('@')[0] ?? v) : v),
  afterLastDot: (v) => {
    if (typeof v !== 'string') return v;
    const idx = v.lastIndexOf('.');
    return idx >= 0 ? v.slice(idx + 1) : v;
  },
  beforeLastDot: (v) => {
    if (typeof v !== 'string') return v;
    const idx = v.lastIndexOf('.');
    return idx >= 0 ? v.slice(0, idx) : v;
  },
  lowercase: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
  uppercase: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
  trim: (v) => (typeof v === 'string' ? v.trim() : v),
};

function applyTransform(value: unknown, transform: string): unknown {
  return (TRANSFORMS[transform] ?? TRANSFORMS.none!)(value);
}

function aggregate(candidates: JsonObject[], definition: JsonObject): unknown {
  const mode = stringValue(definition.aggregate, 'exists');
  const transform = stringValue(definition.transform, 'none');

  switch (mode) {
    case 'exists':
      return candidates.length > 0
        ? (definition.outputTrue ?? true)
        : (definition.outputFalse ?? false);

    case 'count':
      return candidates.length;

    case 'value': {
      const field = stringValue(definition.valueField, '');
      if (!field || candidates.length === 0) return definition.outputWhenEmpty ?? null;
      const raw = readPath(candidates[0]!, field);
      if (raw == null) return definition.outputWhenEmpty ?? null;
      return applyTransform(raw, transform);
    }

    case 'collect': {
      const field = stringValue(definition.valueField, '');
      if (!field) return [];
      const seen = new Set<string>();
      const values: unknown[] = [];
      for (const row of candidates) {
        const raw = readPath(row, field);
        if (raw == null) continue;
        const transformed = applyTransform(raw, transform);
        if (transformed == null) continue;
        const key = String(transformed);
        if (!seen.has(key)) {
          seen.add(key);
          values.push(transformed);
        }
      }
      return values;
    }

    case 'conditional': {
      const cases = Array.isArray(definition.cases) ? definition.cases : [];
      for (const c of cases) {
        if (!isObject(c)) continue;
        // Default case — always matches, must be last
        if (c.default === true) return c.output;
        // Regular case — matches if any candidate satisfies the case's filter
        if (candidates.some((row) => matchesFilter(row, c.filter))) return c.output;
      }
      return undefined;
    }

    default:
      return undefined;
  }
}

async function scopedRowsForFact(
  db: Db,
  entry: TableEntry,
  linkId: string,
  siteId: string,
  definition: JsonObject
): Promise<JsonObject[]> {
  const table = entry.table as Record<string, unknown>;
  const conditions: unknown[] = [];

  const linkColumn = table.linkId;
  if (linkColumn) {
    conditions.push(eq(linkColumn as never, linkId));
  }
  // Domain attribution partitions M365 identities between sites. Other M365
  // tables are tenant resources, so a fact rule can intentionally evaluate
  // them for every site assigned to that tenant.
  if (entry.table === m365Identities && table.siteId) {
    conditions.push(eq(table.siteId as never, siteId));
  }

  const filterSql = buildSqlFilter(table, definition.filter);
  if (filterSql) conditions.push(filterSql);

  const query = db.select().from(entry.table);
  const rows = (
    conditions.length > 0
      ? await query.where(and(...(conditions as never[])))
      : await query
  ) as JsonObject[];

  return rows.filter((row) => {
    if (!linkColumn && readPath(row, 'linkId') && readPath(row, 'linkId') !== linkId) return false;
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
      case 'containsAny':
      case 'notContainsAny': {
        const values = toStringArray(condition.value);
        if (values.length === 0) continue;
        const overlap = sql`${column} && ${values}::text[]`;
        pushed.push(op === 'containsAny' ? overlap : sql`not (${overlap})`);
        break;
      }
      default:
        continue;
    }
  }
  if (pushed.length === 0) return null;
  return and(...(pushed as never[]));
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
    case 'containsAny': {
      const values = toStringArray(expected);
      if (!Array.isArray(actual)) return false;
      const rowValues = new Set(actual.map((v) => String(v)));
      return values.some((v) => rowValues.has(v));
    }
    case 'notContainsAny':
      return !matchesCondition(row, { ...condition, op: 'containsAny' });
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
  return path.split('.').reduce<unknown>((current, part) => {
    if (!isObject(current)) return undefined;
    return current[part] ?? current[toCamel(part)];
  }, row);
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

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).filter((e) => e.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}
