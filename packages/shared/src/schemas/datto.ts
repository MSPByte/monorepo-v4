import { z } from "zod";
import { ProviderFacet } from "../types/provider.js";

export const DattoDeviceSchema = z.looseObject({
  id: z.number(),
  uid: z.string(),
  online: z.boolean(),
  hostname: z.string(),
  operatingSystem: z.string().nullable().optional(),
  deviceType: z.looseObject({
    category: z.string(),
    type: z.string(),
  }),
  intIpAddress: z.string(),
  extIpAddress: z.string().nullable().optional(),
  lastSeen: z.number().nullable().optional(),
  lastReboot: z.number().nullable().optional(),
  udf: z.record(z.string(), z.string().nullable().optional()).optional(),
});

export const DattoRawSchemas = {
  [ProviderFacet.DattoEndpoints]: DattoDeviceSchema,
} as const;

export type DattoRawFacet = keyof typeof DattoRawSchemas;
export type DattoDevice = z.infer<typeof DattoDeviceSchema>;

export function getDattoRawSchema(facet: ProviderFacet | string) {
  return DattoRawSchemas[facet as DattoRawFacet];
}
