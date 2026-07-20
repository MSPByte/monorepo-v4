import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { vendorTableRegistry, type VendorTableName } from "./registry.js";

/**
 * Fields the projection pipeline adds *after* the vendor normalizer produces
 * its output, so they should not appear in the normalizer's shape:
 *   - id / createdAt / updatedAt: defaulted by Postgres
 *   - linkId / siteId: set from the job's link
 *   - lastSeenAt: set by projectBatch
 *   - sourceHash: computed from the raw payload by projectBatch
 */
const PROJECTION_OMIT = {
  id: true,
  linkId: true,
  siteId: true,
  lastSeenAt: true,
  sourceHash: true,
  createdAt: true,
  updatedAt: true,
} as const;

function buildSchema(table: unknown): z.ZodTypeAny {
  const full = createInsertSchema(table as never) as unknown as {
    omit: (mask: Record<string, true>) => z.ZodTypeAny;
    shape?: Record<string, unknown>;
  };
  const tableShape = (table as Record<string, unknown>) ?? {};
  const mask: Record<string, true> = {};
  for (const key of Object.keys(PROJECTION_OMIT)) {
    if (key in tableShape) mask[key] = true;
  }
  return full.omit(mask);
}

/**
 * Zod schema for the shape a vendor normalizer must produce, derived from the
 * vendor table via drizzle-zod. Runs at the projection boundary to surface
 * silent normalizer bugs (missing/mistyped fields) before they hit Postgres.
 * Failed validation is treated like a normalize exception: the record goes to
 * the dead-letter store with the zod error.
 */
export const projectionSchemas: Record<VendorTableName, z.ZodTypeAny> =
  Object.fromEntries(
    (Object.entries(vendorTableRegistry) as Array<
      [VendorTableName, (typeof vendorTableRegistry)[VendorTableName]]
    >).map(([name, entry]) => [name, buildSchema(entry.table)]),
  ) as Record<VendorTableName, z.ZodTypeAny>;

export function getProjectionSchema(
  tableName: VendorTableName,
): z.ZodTypeAny | undefined {
  return projectionSchemas[tableName];
}
