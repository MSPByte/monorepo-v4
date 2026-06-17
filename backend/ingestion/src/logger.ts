import { createLogger } from "@mspbyte/logging";
import { env } from "./env.js";

export const logger = createLogger("backend-ingestion", env.LOG_LEVEL);
