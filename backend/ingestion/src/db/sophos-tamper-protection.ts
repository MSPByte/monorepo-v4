import { and, eq, getColumns, sql } from "drizzle-orm";
import { sophosTamperProtection } from "@mspbyte/drizzle";
import { ProviderFacet } from "@mspbyte/shared";
import { normalizeVendorRecord } from "../adapters/normalize.js";

type Db = any;

type ProjectionResult = {
  recordsOut: number;
  createdCt: number;
  updatedCt: number;
};

const skipOnUpdate = new Set(["id", "linkId", "endpointId", "createdAt"]);

/**
 * Sophos tamper protection rotates the device "password" (tamper-protection
 * code) periodically. On each ingest we want the new code in `password` and
 * the prior codes appended to `previous` without losing history. We use a
 * dedicated upsert here because:
 *   1. The unique key is `endpoint_id` (one row per endpoint), not
 *      (link_id, external_id) like every other vendor table.
 *   2. The `previous` column must accumulate across runs: prior `previous`
 *      array + the prior `password` + any inbound `previous` array,
 *      deduped and ordered by first-seen, excluding the new password.
 *
 * Ported from monorepo-v2 normalize/project workers.
 */
export async function projectSophosTamperProtection(
  db: Db,
  params: {
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
  },
  payload: unknown,
): Promise<ProjectionResult> {
  const projected = normalizeVendorRecord(
    params.provider,
    params.type,
    payload,
  );
  if (typeof projected.endpointId !== "string") {
    throw new Error(
      "Sophos tamper protection record missing endpointId after normalization",
    );
  }

  const now = new Date().toISOString();
  const insertRow = {
    ...projected,
    linkId: params.linkId,
    siteId: params.siteId,
    lastSeenAt: now,
  };

  const columns = getColumns(sophosTamperProtection as never);
  const setClause: Record<string, unknown> = Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => !skipOnUpdate.has(key))
      .map(([key, column]) => [
        key,
        sql.raw(`excluded.${Object(column).name}`),
      ]),
  );

  // Accumulate prior codes: existing.previous ++ existing.password ++ excluded.previous,
  // deduped and ordered by first appearance, excluding the new (excluded.password).
  setClause.previous = sql`
    (
      select coalesce(array_agg(dedup.password order by dedup.first_seen), '{}'::text[])
      from (
        select incoming.password, min(incoming.ordinality) as first_seen
        from unnest(
          coalesce(${sophosTamperProtection.previous}, '{}'::text[])
          || array[${sophosTamperProtection.password}]
          || coalesce(excluded.previous, '{}'::text[])
        ) with ordinality as incoming(password, ordinality)
        where incoming.password is not null
          and incoming.password <> ''
          and incoming.password <> excluded.password
        group by incoming.password
      ) dedup
    )
  `;

  const returned = await (
    db.insert(sophosTamperProtection as never).values(insertRow) as any
  )
    .onConflictDoUpdate({
      target: [sophosTamperProtection.endpointId],
      set: setClause,
    })
    .returning({ xmax: sql<string>`xmax::text` });

  const wasCreated = returned[0]?.xmax === "0";
  return {
    recordsOut: 1,
    createdCt: wasCreated ? 1 : 0,
    updatedCt: wasCreated ? 0 : 1,
  };
}

export function isSophosTamperProtectionFacet(type: string): boolean {
  return type === ProviderFacet.SophosTamperProtection;
}

export async function softDeleteSophosTamperProtection(
  db: Db,
  params: { linkId: string },
  endpointExternalId: string,
): Promise<number> {
  // Tamper protection rows are tied to sophos_endpoints by endpoint_id (uuid).
  // We don't track an externalId on this table, so a delete envelope keyed by
  // the Sophos endpoint external id has no direct row to clear. Returning 0
  // matches the behavior of the M365 path when no row is found.
  void db;
  void params;
  void endpointExternalId;
  return 0;
}
