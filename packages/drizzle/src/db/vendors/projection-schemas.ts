import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { vendorTableRegistry, type VendorTableName } from "./registry.js";

/**
 * Fields the projection pipeline adds *after* the vendor normalizer produces
 * its output, so they should not appear in the normalizer's shape:
 *   - id / createdAt / updatedAt: defaulted by Postgres
 *   - linkId / siteId: set from the job's link
 *   - lastSeenAt: set by projectBatch
 *   - sourceHash: computed from the normalized projection by projectBatch
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

// drizzle-orm 1.0 stores `text().array()` as a PgText column with
// `config.dimensions >= 1` instead of wrapping in PgArray. drizzle-zod 0.8.x
// still detects arrays via the PgArray class, so it types every array column
// as its scalar base (e.g. string). We patch that here by re-wrapping the
// affected shape entries in z.array(...) before returning the schema.
function buildSchema(table: unknown): z.ZodTypeAny {
  const full = createInsertSchema(table as never) as unknown as {
    omit: (mask: Record<string, true>) => z.ZodObject<z.ZodRawShape>;
  };
  const tableShape = (table as Record<string, unknown>) ?? {};
  const mask: Record<string, true> = {};
  for (const key of Object.keys(PROJECTION_OMIT)) {
    if (key in tableShape) mask[key] = true;
  }
  const omitted = full.omit(mask);
  const overrides: Record<string, z.ZodTypeAny> = {};
  for (const [key, entry] of Object.entries(omitted.shape as Record<string, z.ZodTypeAny>)) {
    const column = tableShape[key] as
      | { config?: { dimensions?: number } }
      | undefined;
    const dimensions = column?.config?.dimensions ?? 0;
    if (dimensions >= 1) {
      overrides[key] = wrapArrayDimensions(entry, dimensions);
    }
  }
  return Object.keys(overrides).length
    ? (omitted.extend(overrides as never) as unknown as z.ZodTypeAny)
    : (omitted as unknown as z.ZodTypeAny);
}

function wrapArrayDimensions(
  entry: z.ZodTypeAny,
  dimensions: number,
): z.ZodTypeAny {
  let isOptional = false;
  let isNullable = false;
  let hasDefault = false;
  let defaultValue: unknown = undefined;
  let core: z.ZodTypeAny = entry;
  while (true) {
    if (core instanceof z.ZodOptional) {
      isOptional = true;
      core = core.unwrap() as z.ZodTypeAny;
    } else if (core instanceof z.ZodNullable) {
      isNullable = true;
      core = core.unwrap() as z.ZodTypeAny;
    } else if (core instanceof z.ZodDefault) {
      hasDefault = true;
      const def = core.def as unknown as {
        defaultValue: unknown;
        innerType: z.ZodTypeAny;
      };
      defaultValue = def.defaultValue;
      core = def.innerType;
    } else {
      break;
    }
  }
  let wrapped: z.ZodTypeAny = core;
  for (let d = 0; d < dimensions; d++) wrapped = z.array(wrapped);
  if (isNullable) wrapped = wrapped.nullable();
  if (isOptional) wrapped = wrapped.optional();
  if (hasDefault) wrapped = wrapped.default(defaultValue as never);
  return wrapped;
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
