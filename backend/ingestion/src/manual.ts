import { closeRedis, createRedis } from "./redis.js";
import { registerBuiltInAdapters } from "./adapters/index.js";
import { enqueueManualIngestion } from "./scheduler.js";
import { logger } from "./logger.js";
import type { SyncMode } from "@mspbyte/pipeline";

type Args = {
  orgId?: string;
  linkId?: string;
  type?: string;
  mode?: SyncMode;
  force?: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    const next = argv[index + 1];

    if (item === "--org-id") args.orgId = next;
    if (item === "--link-id") args.linkId = next;
    if (item === "--type") args.type = next;
    if (item === "--mode") args.mode = next as SyncMode;
    if (item === "--force") args.force = true;

    if (item !== "--force") index++;
  }

  return args;
}

function requireArg(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

registerBuiltInAdapters();

const args = parseArgs(process.argv.slice(2));
const redis = createRedis();

try {
  const result = await enqueueManualIngestion(redis, {
    orgId: requireArg(args.orgId, "--org-id"),
    linkId: requireArg(args.linkId, "--link-id"),
    type: requireArg(args.type, "--type"),
    mode: args.mode ?? "full",
    triggerType: "manual",
    force: args.force ?? true,
  });

  logger.info("Manual ingestion job queued", result);
} finally {
  await closeRedis(redis);
}
