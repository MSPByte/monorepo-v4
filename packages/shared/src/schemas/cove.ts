import { z } from "zod";
import { ProviderFacet } from "../types/provider.js";

export const CoveAccountStatisticsSchema = z.looseObject({
  AccountId: z.number(),
  PartnerId: z.number(),
  Flags: z.array(z.string()).nullable().optional(),
  Settings: z.record(z.string(), z.string()),
});

export const CoveRawSchemas = {
  [ProviderFacet.CoveEndpoints]: CoveAccountStatisticsSchema,
} as const;

export type CoveRawFacet = keyof typeof CoveRawSchemas;
export type CoveAccountStatistics = z.infer<typeof CoveAccountStatisticsSchema>;

export function getCoveRawSchema(facet: ProviderFacet | string) {
  return CoveRawSchemas[facet as CoveRawFacet];
}
