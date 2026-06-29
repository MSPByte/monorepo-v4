import { PROVIDER_IDS } from "@mspbyte/shared";
import { normalizeCove } from "./cove.js";
import { normalizeDatto } from "./datto.js";
import { normalizeHaloPsa } from "./halopsa.js";
import { normalizeM365 } from "./m365.js";
import { normalizeSophos } from "./sophos.js";

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
      throw new Error(
        `No projection normalizer registered for provider ${provider}`,
      );
  }
}
