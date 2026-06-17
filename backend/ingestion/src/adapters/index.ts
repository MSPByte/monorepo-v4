import { env } from "../env.js";
import { logger } from "../logger.js";
import { devAdapter } from "./dev.js";
import { m365Adapter } from "./m365/index.js";
import { registerAdapter } from "./registry.js";

export function registerBuiltInAdapters(): void {
  registerAdapter(m365Adapter);
  logger.info("Registered M365 ingestion adapter", {
    providerId: m365Adapter.providerId,
    types: m365Adapter.types,
  });

  if (env.ENABLE_DEV_ADAPTER) {
    registerAdapter(devAdapter);
    logger.info("Registered development ingestion adapter", { providerId: devAdapter.providerId });
  }
}
