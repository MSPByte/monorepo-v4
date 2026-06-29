import { z } from "zod";
import { ProviderFacet } from "../types/provider.js";

export const HaloPsaRecurringItemSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  _external_id: z.string(),
  _invoice: z.looseObject({
    id: z.union([z.string(), z.number()]),
  }),
  _line: z.record(z.string(), z.unknown()),
});

export const HaloPsaRawSchemas = {
  [ProviderFacet.HaloPsaRecurringItems]: HaloPsaRecurringItemSchema,
} as const;

export type HaloPsaRawFacet = keyof typeof HaloPsaRawSchemas;
export type HaloPsaRecurringItem = z.infer<typeof HaloPsaRecurringItemSchema>;

export function getHaloPsaRawSchema(facet: ProviderFacet | string) {
  return HaloPsaRawSchemas[facet as HaloPsaRawFacet];
}
