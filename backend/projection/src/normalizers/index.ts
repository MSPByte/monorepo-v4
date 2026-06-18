import { PROVIDER_IDS } from "@mspbyte/shared";
import { normalizeM365 } from "./m365.js";

export function normalizeVendorRecord(
  provider: string,
  type: string,
  payload: unknown,
): Record<string, unknown> {
  if (provider === PROVIDER_IDS.M365) return normalizeM365(type, payload);

  throw new Error(`No projection normalizer registered for provider ${provider}`);
}
