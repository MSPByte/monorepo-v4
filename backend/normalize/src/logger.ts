import { createLogger } from "@mspbyte/logging";
import { env } from "./env.js";

export const logger = createLogger("backend-normalize", env.LOG_LEVEL);
