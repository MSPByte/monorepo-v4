import { eq, inArray } from 'drizzle-orm';
import {
  integrationLinks,
  sites,
  m365Identities,
  m365Groups,
  m365IdentityGroups,
  m365Roles,
  m365IdentityRoles,
  m365Licenses,
  m365Policies,
  m365PolicyIdentities,
  m365PolicyGroups,
  m365PolicyRoles,
  m365Devices,
  sophosEndpoints,
  sophosFirewalls,
  sophosFirewallLicenses,
  sophosLicenses,
  dattoEndpoints,
  coveEndpoints,
  haloPsaRecurringItems
} from '@mspbyte/drizzle';
import type {
  ArrayReferenceJoin,
  ComputedJoin,
  JoinDefinition,
  JunctionJoin,
  LinkScalarJoin,
  PolicyTableShape
} from '@mspbyte/shared';
import type { Context } from '../context.js';

/**
 * String → drizzle table lookup for `JoinDefinition.from` / `.through`. Only
 * tables listed here can be referenced from a join; adding a table means it
 * becomes reachable from every source shape that declares a matching join.
 */
const JOIN_TABLES: Record<string, Record<string, unknown>> = {
  integrationLinks: integrationLinks as unknown as Record<string, unknown>,
  sites: sites as unknown as Record<string, unknown>,
  m365Identities: m365Identities as unknown as Record<string, unknown>,
  m365Groups: m365Groups as unknown as Record<string, unknown>,
  m365IdentityGroups: m365IdentityGroups as unknown as Record<string, unknown>,
  m365Roles: m365Roles as unknown as Record<string, unknown>,
  m365IdentityRoles: m365IdentityRoles as unknown as Record<string, unknown>,
  m365Licenses: m365Licenses as unknown as Record<string, unknown>,
  m365Policies: m365Policies as unknown as Record<string, unknown>,
  m365PolicyIdentities: m365PolicyIdentities as unknown as Record<string, unknown>,
  m365PolicyGroups: m365PolicyGroups as unknown as Record<string, unknown>,
  m365PolicyRoles: m365PolicyRoles as unknown as Record<string, unknown>,
  m365Devices: m365Devices as unknown as Record<string, unknown>,
  sophosEndpoints: sophosEndpoints as unknown as Record<string, unknown>,
  sophosFirewalls: sophosFirewalls as unknown as Record<string, unknown>,
  sophosFirewallLicenses: sophosFirewallLicenses as unknown as Record<string, unknown>,
  sophosLicenses: sophosLicenses as unknown as Record<string, unknown>,
  dattoEndpoints: dattoEndpoints as unknown as Record<string, unknown>,
  coveEndpoints: coveEndpoints as unknown as Record<string, unknown>,
  haloPsaRecurringItems: haloPsaRecurringItems as unknown as Record<string, unknown>
};

/**
 * The join runner treats drizzle's builder as a dynamic chain — the callee
 * shapes vary (with/without .where, with/without .innerJoin), and each column
 * we reference is picked up by string name from the registered table. Rather
 * than fight the strict SelectedFields inference for every branch, we go
 * through this narrow ad-hoc shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicDb = { select: (fields: unknown) => any };

function resolveTable(name: string): Record<string, unknown> {
  const table = JOIN_TABLES[name];
  if (!table) {
    throw new Error(`Reports join references unknown table "${name}". Register it in JOIN_TABLES.`);
  }
  return table;
}

function column(table: Record<string, unknown>, name: string): unknown {
  const col = table[name];
  if (!col) throw new Error(`Reports join references unknown column "${name}"`);
  return col;
}

/**
 * Reference-table cache that survives across page loads within one report run.
 * Small tables like m365Licenses (~a few hundred rows) are fetched at most
 * once per JoinCache lifetime. Junction and link-scalar joins are re-issued
 * per page but with page-bounded IN () lists, so they stay cheap.
 */
export class JoinCache {
  private entries = new Map<string, unknown>();

  async load<T>(key: string, loader: () => Promise<T>): Promise<T> {
    if (!this.entries.has(key)) {
      this.entries.set(key, await loader());
    }
    return this.entries.get(key) as T;
  }
}

/**
 * Apply all joins declared on `shape` to `rows`. Rows are mutated in-place
 * (each output field is written under the join's `key`). Returns the same
 * array reference for convenience.
 */
export async function applyJoins(
  ctx: Context,
  shape: PolicyTableShape,
  rows: Record<string, unknown>[],
  cache: JoinCache = new JoinCache()
): Promise<Record<string, unknown>[]> {
  if (!shape.joins?.length || rows.length === 0) return rows;
  for (const join of shape.joins) {
    switch (join.kind) {
      case 'link_scalar':
        await applyLinkScalar(ctx, join, rows, cache);
        break;
      case 'junction':
        await applyJunction(ctx, join, rows, cache);
        break;
      case 'array_reference':
        await applyArrayReference(ctx, join, rows, cache);
        break;
      case 'computed':
        applyComputed(join, rows);
        break;
    }
  }
  return rows;
}

async function applyLinkScalar(
  ctx: Context,
  join: LinkScalarJoin,
  rows: Record<string, unknown>[],
  cache: JoinCache
): Promise<void> {
  // link_scalar targets are lookup tables (integration_links, sites, roles).
  // These are small enough that fetching the full display map once per run is
  // cheaper than issuing an `IN (...)` per page — especially during exports
  // where the same cache backs every page.
  const map = await cache.load(
    `link_scalar:${join.from}:${join.match}:${join.display}`,
    async () => {
      const table = resolveTable(join.from);
      const matchCol = column(table, join.match);
      const displayCol = column(table, join.display);
      const db = ctx.db as unknown as DynamicDb;
      const results = await db
        .select({ match: matchCol, display: displayCol })
        .from(table);
      const built = new Map<string, unknown>();
      for (const r of results as Array<{ match: unknown; display: unknown }>) {
        if (r.match != null) built.set(String(r.match), r.display ?? null);
      }
      return built;
    }
  );
  for (const row of rows) {
    const v = row[join.via];
    row[join.key] = v == null ? null : (map.get(String(v)) ?? null);
  }
}

async function applyJunction(
  ctx: Context,
  join: JunctionJoin,
  rows: Record<string, unknown>[],
  cache: JoinCache
): Promise<void> {
  const localKeys = collectKeys(rows, join.localKey);
  if (localKeys.length === 0) {
    for (const row of rows) row[join.key] = [];
    return;
  }
  // Junction results are page-bounded, so caching by keys keeps
  // export loops from re-issuing the same lookup.
  const map = await cache.load(
    `junction:${join.through}:${join.throughLocal}:${join.throughRemote}:${join.from}:${join.match}:${join.display}:${localKeys.sort().join(',')}`,
    async () => {
      const throughTable = resolveTable(join.through);
      const fromTable = resolveTable(join.from);
      const throughLocalCol = column(throughTable, join.throughLocal);
      const throughRemoteCol = column(throughTable, join.throughRemote);
      const fromMatchCol = column(fromTable, join.match);
      const fromDisplayCol = column(fromTable, join.display);
      const db = ctx.db as unknown as DynamicDb;
      const rows = (await db
        .select({ local: throughLocalCol, display: fromDisplayCol })
        .from(throughTable)
        .innerJoin(fromTable, eq(throughRemoteCol as never, fromMatchCol as never))
        .where(inArray(throughLocalCol as never, localKeys))) as Array<{
        local: unknown;
        display: unknown;
      }>;
      const built = new Map<string, unknown[]>();
      for (const r of rows) {
        if (r.local == null) continue;
        const bucket = built.get(String(r.local)) ?? [];
        if (r.display != null) bucket.push(r.display);
        built.set(String(r.local), bucket);
      }
      return built;
    }
  );
  for (const row of rows) {
    const v = row[join.localKey];
    row[join.key] = v == null ? [] : (map.get(String(v)) ?? []);
  }
}

async function applyArrayReference(
  ctx: Context,
  join: ArrayReferenceJoin,
  rows: Record<string, unknown>[],
  cache: JoinCache
): Promise<void> {
  const keys = new Set<string>();
  for (const row of rows) {
    const v = row[join.sourceColumn];
    if (Array.isArray(v)) for (const id of v) if (id != null) keys.add(String(id));
  }
  if (keys.size === 0) {
    for (const row of rows) row[join.key] = [];
    return;
  }
  const map = await cache.load(
    // Reference tables are typically small; cache the entire table once
    // per run so array joins across pages share it.
    `array_reference:${join.from}:${join.match}:${join.display}`,
    async () => {
      const table = resolveTable(join.from);
      const matchCol = column(table, join.match);
      const displayCol = column(table, join.display);
      const db = ctx.db as unknown as DynamicDb;
      const rows = (await db
        .select({ match: matchCol, display: displayCol })
        .from(table)) as Array<{ match: unknown; display: unknown }>;
      const built = new Map<string, unknown>();
      for (const r of rows) {
        if (r.match != null) built.set(String(r.match), r.display ?? null);
      }
      return built;
    }
  );
  for (const row of rows) {
    const v = row[join.sourceColumn];
    row[join.key] = Array.isArray(v) ? v.map((id) => map.get(String(id)) ?? String(id)) : [];
  }
}

function applyComputed(join: ComputedJoin, rows: Record<string, unknown>[]): void {
  for (const row of rows) row[join.key] = join.compute(row);
}

function collectKeys(rows: Record<string, unknown>[], columnName: string): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const v = row[columnName];
    if (v != null) set.add(String(v));
  }
  return [...set];
}

/** UI-facing metadata for joined fields. Emitted from `reports.listSources`. */
export type JoinFieldMeta = {
  key: string;
  label: string;
  type: JoinDefinition['type'];
  modality: JoinDefinition['modality'];
  fromTable: string | null;
  description?: string;
};

export function joinFieldsMeta(shape: PolicyTableShape): JoinFieldMeta[] {
  return (shape.joins ?? []).map((join) => ({
    key: join.key,
    label: join.label,
    type: join.type,
    modality: join.modality,
    fromTable: join.kind === 'computed' ? null : join.from,
    description: join.description
  }));
}
