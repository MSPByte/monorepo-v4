import { PROVIDER_IDS } from "@mspbyte/shared";
import { normalizeCove } from "./cove/normalizer.js";
import { normalizeDatto } from "./datto/normalizer.js";
import { normalizeHaloPsa } from "./halopsa/normalizer.js";
import { normalizeM365 } from "./m365/normalizer.js";
import { normalizeSophos } from "./sophos/normalizer.js";

export function normalizeVendorRecord(
  provider: string,
  type: string,
  payload: unknown,
): Record<string, unknown> {
  switch (provider) {
    case PROVIDER_IDS.M365:
      return normalizeM365(type, payload);
    case PROVIDER_IDS.SOPHOS:
      return normalizeSophos(type, payload);
    case PROVIDER_IDS.COVE:
      return normalizeCove(type, payload);
    case PROVIDER_IDS.DATTO:
      return normalizeDatto(type, payload);
    case PROVIDER_IDS.HALOPSA:
      return normalizeHaloPsa(type, payload);
    default:
      throw new Error(`No normalizer registered for provider ${provider}`);
  }
}
