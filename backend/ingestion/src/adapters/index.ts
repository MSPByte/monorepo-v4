import { env } from "../env.js";
import { logger } from "../logger.js";
import { coveAdapter } from "./cove/index.js";
import { dattoAdapter } from "./datto/index.js";
import { devAdapter } from "./dev.js";
import { haloPsaAdapter } from "./halopsa/index.js";
import { m365Adapter } from "./m365/index.js";
import { registerAdapter } from "./registry.js";
import { sophosAdapter } from "./sophos/index.js";

export function registerBuiltInAdapters(): void {
  for (const adapter of [m365Adapter, sophosAdapter, coveAdapter, dattoAdapter, haloPsaAdapter]) {
    registerAdapter(adapter);
    logger.info("Registered ingestion adapter", {
      providerId: adapter.providerId,
      types: adapter.types,
    });
  }

  if (env.ENABLE_DEV_ADAPTER) {
    registerAdapter(devAdapter);
    logger.info("Registered development ingestion adapter", { providerId: devAdapter.providerId });
  }
}
